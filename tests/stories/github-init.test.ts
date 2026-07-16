import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensurePrRequirements } from "../../plugins/stories/lib/github.mjs";
import { run } from "../../plugins/stories/lib/util.mjs";
import { fail, makeFakeExec, makePrRepo, ok } from "./gh-helpers.ts";
import { makeRepo, runStory } from "./helpers";

describe("ensurePrRequirements", () => {
  test("all probes green", async () => {
    const root = await makePrRepo();
    const { exec, lines } = makeFakeExec([
      ["gh auth status", ok("Logged in to github.com")],
      ["git remote get-url origin", ok("git@github.com:o/r.git\n")],
      ["gh repo view", ok("WRITE\n")],
    ]);
    expect(await ensurePrRequirements(root, { exec })).toEqual({ ok: true, problems: [] });
    expect(lines()[0]).toBe("gh auth status");
  });

  test("broken gh auth is reported with the fix", async () => {
    const root = await makePrRepo();
    const { exec } = makeFakeExec([
      ["gh auth status", fail(1, "You are not logged into any GitHub hosts")],
      ["gh repo view", ok("WRITE\n")],
    ]);
    const res = await ensurePrRequirements(root, { exec });
    expect(res.ok).toBe(false);
    expect(res.problems.join(" ")).toContain("gh auth login");
  });

  test("missing origin remote is reported", async () => {
    const root = await makePrRepo();
    const { exec, lines } = makeFakeExec([
      ["git remote get-url origin", fail(2, "error: No such remote 'origin'")],
    ]);
    const res = await ensurePrRequirements(root, { exec });
    expect(res.ok).toBe(false);
    expect(res.problems.join(" ")).toContain("origin");
    expect(lines().some((l) => l.startsWith("gh repo view"))).toBe(false); // no point probing permission
  });

  test("read-only access is reported", async () => {
    const root = await makePrRepo();
    const { exec } = makeFakeExec([["gh repo view", ok("READ\n")]]);
    const res = await ensurePrRequirements(root, { exec });
    expect(res.ok).toBe(false);
    expect(res.problems.join(" ")).toContain("push access");
  });
});

describe("story init --merge pr wiring", () => {
  test("failing probes abort init with a CliError-formatted error and write NOTHING", async () => {
    const repo = await makeRepo();
    const { rm } = await import("node:fs/promises");
    await rm(join(repo.root, ".claude/story-workflow.json"));
    // Passthrough exec: real git for rev-parse etc., fake the probe commands.
    const exec = (cmd: string, args: string[] = [], opts: Record<string, unknown> = {}) => {
      const line = [cmd, ...args].join(" ");
      if (line.startsWith("git remote get-url origin")) return { code: 2, stdout: "", stderr: "No such remote 'origin'" };
      if (cmd === "gh") return { code: 0, stdout: "Logged in\n", stderr: "" };
      return run(cmd, args, opts);
    };
    const r = await runStory(repo.root, ["init", "--merge", "pr"], { exec });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).error).toContain("origin");
    expect(existsSync(join(repo.root, ".claude/story-workflow.json"))).toBe(false); // all-or-nothing
    await repo.cleanup();
  });
});
