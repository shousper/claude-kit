import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadStories } from "../../plugins/stories/lib/board.mjs";
import { makeRepo, runStory, DEFAULT_CONFIG, type Repo } from "./helpers";

const CONFIG = { storiesDir: "stories" };
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};

async function claimedStory(repo: Repo, extra: string[] = []): Promise<string> {
  const created = await runStory(repo.root, ["create", "--title", "story under test", ...extra, "--json"]);
  const { id } = created.json() as { id: string };
  expect((await runStory(repo.root, ["claim", id, "--session", "w1"])).code).toBe(0);
  const wt = join(repo.root, ".worktrees", id);
  writeFileSync(join(wt, "impl.ts"), "code\n");
  git(wt, "add", "impl.ts");
  git(wt, "commit", "-m", "implement");
  return id;
}

describe("story done — self mode", () => {
  test("gates green → evidence written, touches reconciled, merged to main, worktree gone, status done", async () => {
    const repo = await makeRepo(); // DEFAULT_CONFIG: merge self, gate test = `true`
    const id = await claimedStory(repo, ["--touches", "declared/**"]);
    const r = await runStory(repo.root, ["done", id, "--json"]);
    expect(r.code).toBe(0);
    const s = loadStories(repo.root, CONFIG).find((x) => x.id === id)!;
    expect(s.status).toBe("done");
    expect(s.claim).toBeUndefined();
    expect(s.touches).toEqual(["impl.ts"]); // reconciled from the actual diff, not the declared glob
    expect(existsSync(join(repo.root, "impl.ts"))).toBe(true); // merged
    expect(existsSync(join(repo.root, ".worktrees", id))).toBe(false);
    const evidence = readdirSync(join(repo.root, ".claude/story-evidence", id));
    expect(evidence.some((f) => f.endsWith(".json"))).toBe(true);
    await repo.cleanup();
  });

  test("done run from INSIDE the worktree survives the teardown invalidating cwd", async () => {
    const repo = await makeRepo();
    const id = await claimedStory(repo);
    const wt = join(repo.root, ".worktrees", id);
    // integrateSelf tears the worktree down BEFORE the final status write; the
    // command was started from inside it, so every post-teardown step must be
    // independent of cwd or the story strands in-progress after a real merge.
    const r = await runStory(wt, ["done", id, "--json"]);
    expect(r.code).toBe(0);
    const s = loadStories(repo.root, CONFIG).find((x) => x.id === id)!;
    expect(s.status).toBe("done");
    expect(s.claim).toBeUndefined();
    expect(existsSync(join(repo.root, "impl.ts"))).toBe(true); // merged
    expect(existsSync(wt)).toBe(false);
    await repo.cleanup();
  });

  test("self done commits the board — pending story edits stop piling up uncommitted", async () => {
    const repo = await makeRepo();
    const id = await claimedStory(repo);
    // Pre-existing pile-up: an unrelated board write nobody ever committed.
    const pending = await runStory(repo.root, ["create", "--title", "unrelated pending story", "--json"]);
    expect(pending.code).toBe(0);
    expect((await runStory(repo.root, ["done", id])).code).toBe(0);
    expect(git(repo.root, "status", "--porcelain", "--", "stories").trim()).toBe("");
    expect(git(repo.root, "log", "-1", "--format=%s").trim()).toBe(`story ${id}: board update`);
    const tracked = git(repo.root, "ls-files", "stories");
    expect(tracked).toContain("unrelated-pending-story"); // pile-up swept along
    await repo.cleanup();
  });

  test("failing command gate → exit 1, story stays in-progress, no merge", async () => {
    const repo = await makeRepo({
      ...DEFAULT_CONFIG,
      gates: { test: { kind: "command", run: "false" } },
    });
    const id = await claimedStory(repo);
    const r = await runStory(repo.root, ["done", id]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).error).toMatch(/gate.*test.*failed|failed.*test/i);
    expect(loadStories(repo.root, CONFIG).find((x) => x.id === id)!.status).toBe("in-progress");
    expect(existsSync(join(repo.root, "impl.ts"))).toBe(false);
    await repo.cleanup();
  });

  test("review gate without a pass verdict blocks; recording one unblocks; evidence includes the verdict", async () => {
    const repo = await makeRepo();
    const id = await claimedStory(repo, ["--type", "ui"]); // defaults: [test, visual]
    const blocked = await runStory(repo.root, ["done", id]);
    expect(blocked.code).toBe(1);
    expect(JSON.parse(blocked.stderr).error).toContain(`story record ${id} --gate visual`);
    expect((await runStory(repo.root, ["record", id, "--gate", "visual", "--verdict", "pass", "--evidence", "shot.png"])).code).toBe(0);
    expect((await runStory(repo.root, ["done", id])).code).toBe(0);
    const dir = join(repo.root, ".claude/story-evidence", id);
    const evidenceFile = readdirSync(dir).filter((f) => !f.startsWith("verdict-")).sort().at(-1)!;
    const payload = JSON.parse(await Bun.file(join(dir, evidenceFile)).text());
    expect(payload.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "test", kind: "command", pass: true }),
        expect.objectContaining({ name: "visual", kind: "review", verdict: "pass" }),
      ]),
    );
    await repo.cleanup();
  });

  test("merge conflict → story back in-progress with an integration-fix note, worktree kept", async () => {
    const repo = await makeRepo();
    const id = await claimedStory(repo);
    // Create the conflict: main gains a different impl.ts after the claim.
    writeFileSync(join(repo.root, "impl.ts"), "conflicting main version\n");
    git(repo.root, "add", "impl.ts");
    git(repo.root, "commit", "-m", "conflicting main change");
    const r = await runStory(repo.root, ["done", id]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).error).toMatch(/conflict/);
    const s = loadStories(repo.root, CONFIG).find((x) => x.id === id)!;
    expect(s.status).toBe("in-progress");
    expect(s.body).toMatch(/## Implementation Notes[\s\S]*integration conflict/);
    expect(existsSync(join(repo.root, ".worktrees", id))).toBe(true);
    expect(git(repo.root, "status", "--porcelain").includes("UU")).toBe(false); // no half-merge left behind
    await repo.cleanup();
  });

  test("done requires in-progress", async () => {
    const repo = await makeRepo();
    const created = await runStory(repo.root, ["create", "--title", "x", "--json"]);
    const { id } = created.json() as { id: string };
    const r = await runStory(repo.root, ["done", id]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).error).toMatch(/expected in-progress/);
    await repo.cleanup();
  });
});

describe("story done — local mode", () => {
  test("gates green → in-review, claim cleared, worktree left for human review", async () => {
    const repo = await makeRepo({ ...DEFAULT_CONFIG, merge: "local" });
    const id = await claimedStory(repo);
    const r = await runStory(repo.root, ["done", id, "--json"]);
    expect(r.code).toBe(0);
    const s = loadStories(repo.root, CONFIG).find((x) => x.id === id)!;
    expect(s.status).toBe("in-review");
    expect(s.claim).toBeUndefined();
    expect(s.touches).toEqual(["impl.ts"]); // in-review holds exactly the real files
    expect(existsSync(join(repo.root, ".worktrees", id))).toBe(true);
    expect(existsSync(join(repo.root, "impl.ts"))).toBe(false); // NOT merged
    await repo.cleanup();
  });

  test("local done never commits on base — integration belongs to the human", async () => {
    const repo = await makeRepo({ ...DEFAULT_CONFIG, merge: "local" });
    const id = await claimedStory(repo);
    expect((await runStory(repo.root, ["done", id])).code).toBe(0);
    expect(git(repo.root, "log", "-1", "--format=%s").trim()).toBe("init");
    await repo.cleanup();
  });
});

// The "pr mode seam" describe block (throw on merge: "pr") pinned B19's
// not-yet-implemented placeholder. Task E4 replaces that throw with
// github.mjs's real integratePrMode dispatch — see
// tests/stories/github-pr-create.test.ts's "story done → integratePrMode
// dispatch (pr mode, end to end)" for the equivalent coverage.

describe("story done — committed-work guards", () => {
  // The incident these pin: build-flow leaves changes uncommitted by design;
  // gates ran against the dirty working tree and passed, integrateSelf merged
  // the codeless BRANCH ("Already up to date"), teardown force-removed the
  // worktree, and three stories closed "done" with zero code on main.
  test("refuses done while the worktree has uncommitted changes — nothing is merged or torn down", async () => {
    const repo = await makeRepo();
    const created = await runStory(repo.root, ["create", "--title", "uncommitted work", "--json"]);
    const { id } = created.json() as { id: string };
    expect((await runStory(repo.root, ["claim", id, "--session", "w1"])).code).toBe(0);
    const wt = join(repo.root, ".worktrees", id);
    writeFileSync(join(wt, "impl.ts"), "uncommitted code\n"); // no git add/commit

    const r = await runStory(repo.root, ["done", id]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/uncommitted/i);
    expect(r.stderr).toContain("git -C"); // actionable commit instructions
    const s = loadStories(repo.root, CONFIG).find((x) => x.id === id)!;
    expect(s.status).toBe("in-progress"); // story not closed
    expect(existsSync(join(wt, "impl.ts"))).toBe(true); // work preserved
    expect(existsSync(join(repo.root, "impl.ts"))).toBe(false); // nothing merged
    await repo.cleanup();
  });

  test("refuses done when the story branch has no commits beyond base, unless --allow-empty", async () => {
    const repo = await makeRepo();
    const created = await runStory(repo.root, ["create", "--title", "codeless story", "--json"]);
    const { id } = created.json() as { id: string };
    expect((await runStory(repo.root, ["claim", id, "--session", "w1"])).code).toBe(0);

    const refused = await runStory(repo.root, ["done", id]);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toMatch(/no commits/i);
    expect(refused.stderr).toContain("--allow-empty");
    expect(loadStories(repo.root, CONFIG).find((x) => x.id === id)!.status).toBe("in-progress");

    const allowed = await runStory(repo.root, ["done", id, "--allow-empty"]);
    expect(allowed.code).toBe(0);
    expect(loadStories(repo.root, CONFIG).find((x) => x.id === id)!.status).toBe("done");
    await repo.cleanup();
  });

  test("dirty board files get a restore hint, not a commit instruction", async () => {
    const repo = await makeRepo();
    const created = await runStory(repo.root, ["create", "--title", "board drift", "--json"]);
    const { id } = created.json() as { id: string };
    expect((await runStory(repo.root, ["claim", id, "--session", "w1"])).code).toBe(0);
    const wt = join(repo.root, ".worktrees", id);
    mkdirSync(join(wt, "stories"), { recursive: true });
    writeFileSync(join(wt, "stories", "stray.md"), "board pollution\n");

    const r = await runStory(repo.root, ["done", id]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/CLI-managed/);
    expect(r.stderr).toMatch(/checkout --/);
    await repo.cleanup();
  });
});
