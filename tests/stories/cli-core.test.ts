import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgv } from "../../shared/stories/lib/cli.mjs";
import { ARCHIVE_DIR, GITIGNORE_BLOCK, configPath } from "../../shared/stories/lib/util.mjs";
import { CONFIG_DEFAULTS } from "../../shared/stories/lib/board.mjs";
import { makeRepo, makeTmpDir, runStory } from "./helpers";

describe("parseArgv", () => {
  test("splits command, positionals, flags", () => {
    expect(parseArgv(["claim", "st-1", "--session", "abc", "--json"])).toEqual({
      cmd: "claim",
      positionals: ["st-1"],
      flags: { session: "abc", json: true },
    });
  });

  test("supports --key=value and comma/repeat list flags", () => {
    const { flags } = parseArgv([
      "create", "--title=t", "--touches", "src/a.ts,src/b.ts", "--touches", "docs/**",
    ]);
    expect(flags.title).toBe("t");
    expect(flags.touches).toEqual(["src/a.ts", "src/b.ts", "docs/**"]);
  });

  test("boolean flags before positionals do not swallow them", () => {
    expect(parseArgv(["list", "--json", "extra"]).positionals).toEqual(["extra"]);
  });
});

describe("error convention", () => {
  test("unknown command → exit 1, {error} JSON on stderr, empty stdout", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, ["frobnicate"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(JSON.parse(r.stderr)).toEqual({ error: expect.stringContaining("unknown command 'frobnicate'") });
    await repo.cleanup();
  });

  test("commands outside a story project fail with guidance", async () => {
    // A dir outside ANY git repo — a subdir of the fixture would inherit
    // its marker config via findRoot's git-common-dir walk.
    const { rm } = await import("node:fs/promises");
    const bare = await makeTmpDir("no-repo-");
    const r = await runStory(bare, ["list"]);
    expect(r.code).toBe(1);
    // Until B23 registers `list`, dispatch rejects it first ("unknown command");
    // once `list` exists, findRoot rejects the bare dir. Both are correct failures here.
    expect(JSON.parse(r.stderr).error).toMatch(/not inside a git repository|config\.json|unknown command/);
    await rm(bare, { recursive: true, force: true });
  });
});

describe("story init", () => {
  test("writes config + scaffold + gitignore entries in a bare git repo", async () => {
    const repo = await makeRepo();
    // makeRepo already wrote the marker — use a fresh repo without it.
    const { rm } = await import("node:fs/promises");
    await rm(configPath(repo.root));
    const r = await runStory(repo.root, ["init", "--merge", "local", "--test-command", "bun test", "--json"]);
    expect(r.code).toBe(0);
    const config = JSON.parse(readFileSync(configPath(repo.root), "utf8"));
    expect(config.merge).toBe("local");
    expect(config.gates.test).toEqual({ kind: "command", run: "bun test" });
    expect(config.gateLock).toBe(true);
    expect(existsSync(join(repo.root, CONFIG_DEFAULTS.storiesDir, ARCHIVE_DIR))).toBe(true);
    // The canonical project-side ignore block (ratified) — byte-identical in
    // cmdInit, the stories:setup skill (D2), the eval fixture (F3), README (F6).
    expect(readFileSync(join(repo.root, ".gitignore"), "utf8")).toContain(GITIGNORE_BLOCK);
    await repo.cleanup();
  });

  test("refuses to overwrite an existing config, rejects bad merge mode", async () => {
    const repo = await makeRepo();
    expect((await runStory(repo.root, ["init"])).code).toBe(1);
    const { rm } = await import("node:fs/promises");
    await rm(configPath(repo.root));
    const bad = await runStory(repo.root, ["init", "--merge", "yolo"]);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stderr).error).toMatch(/merge/);
    await repo.cleanup();
  });
});

describe("story init --config (the stories:setup interview writes answers here)", () => {
  test("writes the answers file verbatim: review gates, type defaults, custom budgets", async () => {
    const repo = await makeRepo();
    const { rm } = await import("node:fs/promises");
    const { writeFileSync } = await import("node:fs");
    await rm(configPath(repo.root));
    const answers = {
      version: 1,
      storiesDir: "stories",
      // merge "local", not "pr": since E13, pr-mode init runs live gh/remote probes,
      // which this verbatim-write test must not depend on (pr init is covered by
      // tests/stories/github-init.test.ts with a fake exec).
      merge: "local",
      baseBranch: "develop",
      gates: {
        test: { kind: "command", run: "bun test" },
        visual: { kind: "review", capture: "bun run screenshot", persona: "visual-reviewer" },
      },
      defaults: { feature: ["test"], bug: ["test"], chore: [], ui: ["test", "visual"] },
      gateLock: false,
      budgets: { maxStalls: 5, maxFixRoundsPerStory: 5 },
    };
    writeFileSync(join(repo.root, "answers.json"), JSON.stringify(answers));
    const r = await runStory(repo.root, ["init", "--config", "answers.json", "--json"]);
    expect(r.code).toBe(0);
    // verbatim: exactly the answers, never merged with the flag-mode defaults
    expect(JSON.parse(readFileSync(configPath(repo.root), "utf8"))).toEqual(answers);
    expect(existsSync(join(repo.root, CONFIG_DEFAULTS.storiesDir, ARCHIVE_DIR))).toBe(true); // scaffold still created
    await repo.cleanup();
  });

  test("scaffolds archive/ under a custom storiesDir, not stories/archive", async () => {
    const repo = await makeRepo();
    const { rm } = await import("node:fs/promises");
    const { writeFileSync } = await import("node:fs");
    await rm(configPath(repo.root));
    const answers = {
      version: 1,
      storiesDir: "docs/tickets",
      merge: "local",
      baseBranch: "main",
      gates: { test: { kind: "command", run: "true" } },
      defaults: { feature: ["test"], bug: ["test"], chore: [] },
      gateLock: true,
      budgets: { maxStalls: 3, maxFixRoundsPerStory: 3 },
    };
    writeFileSync(join(repo.root, "answers.json"), JSON.stringify(answers));
    const r = await runStory(repo.root, ["init", "--config", "answers.json", "--json"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(repo.root, answers.storiesDir, ARCHIVE_DIR))).toBe(true);
    await repo.cleanup();
  });

  test("rejects malformed answers and ambiguous flag combos", async () => {
    const repo = await makeRepo();
    const { rm } = await import("node:fs/promises");
    const { writeFileSync } = await import("node:fs");
    await rm(configPath(repo.root));
    const attempt = async (answers: unknown) => {
      writeFileSync(join(repo.root, "answers.json"), JSON.stringify(answers));
      return runStory(repo.root, ["init", "--config", "answers.json"]);
    };
    const base = { merge: "self", gates: { test: { kind: "command", run: "true" } }, defaults: { feature: ["test"] } };
    expect((await attempt({ ...base, merge: "yolo" })).code).toBe(1);                       // bad merge mode
    expect((await attempt({ ...base, gates: { test: { run: "true" } } })).code).toBe(1);    // gate without kind
    expect((await attempt({ ...base, defaults: { feature: ["nope"] } })).code).toBe(1);     // unknown default gate
    expect((await attempt({ ...base, budgets: { maxStalls: "lots" } })).code).toBe(1);  // non-numeric budget
    expect((await attempt("not an object")).code).toBe(1);
    writeFileSync(join(repo.root, "answers.json"), JSON.stringify(base));
    const combo = await runStory(repo.root, ["init", "--config", "answers.json", "--merge", "self"]);
    expect(combo.code).toBe(1);
    expect(JSON.parse(combo.stderr).error).toMatch(/--config cannot be combined/);
    await repo.cleanup();
  });
});
