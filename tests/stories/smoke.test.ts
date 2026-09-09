import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { CONFIG_DEFAULTS } from "../../shared/stories/lib/board.mjs";
import { ARCHIVE_DIR, EXIT, loopStatePath, stateStorePath } from "../../shared/stories/lib/util.mjs";
import { worktreePath } from "../../shared/stories/lib/worktrees.mjs";
import { makeRepo, STORY_BIN } from "./helpers";
import { STORIES_OMP_ROOT } from "../utils/paths";

// Spawn the real binary (shebang → node), exactly as hooks and skills will.
function story(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync({ cmd: [STORY_BIN, ...args], cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};
// The adapter contract: exit 2 = block (status line, blank line, reason), exit 0 = allow.
function storyTick(cwd: string, session: string) {
  const r = spawnSync(STORY_BIN, ["loop", "tick", "--session", session], { cwd, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("bin/story end-to-end", () => {
  test("create → ready → claim → work → done drives a story to merged", async () => {
    const repo = await makeRepo();

    const created = story(repo.root, "create", "--title", "Smoke story", "--description", "d", "--ac", "a", "--type", "chore", "--json");
    expect(created.code).toBe(0);
    const { id } = JSON.parse(created.stdout) as { id: string };
    expect(id).toMatch(/^st-[0-9a-f]{4}$/);

    const ready = story(repo.root, "ready", "--json");
    expect(ready.code).toBe(0);
    expect((JSON.parse(ready.stdout) as Array<{ id: string }>).map((s) => s.id)).toEqual([id]);

    expect(story(repo.root, "claim", id, "--session", "smoke").code).toBe(0);
    const wt = worktreePath(repo.root, id);
    await Bun.write(join(wt, "smoke.txt"), "hello\n");
    git(wt, "add", "smoke.txt");
    git(wt, "commit", "-m", "smoke work");

    // note + show work from INSIDE the worktree (findRoot via git-common-dir)
    expect(story(wt, "note", id, "--body", "working from the worktree").code).toBe(0);

    expect(story(repo.root, "done", id, "--allow-unplanned").code).toBe(0);
    expect(existsSync(join(repo.root, "smoke.txt"))).toBe(true); // merged into main
    expect(existsSync(wt)).toBe(false); // worktree torn down

    const shown = story(repo.root, "show", id, "--json");
    expect((JSON.parse(shown.stdout) as { status: string }).status).toBe("done");

    expect(story(repo.root, "doctor", "--quiet").code).toBe(0);
    expect(story(repo.root, "archive", "--json").code).toBe(0);
    expect(existsSync(join(repo.root, CONFIG_DEFAULTS.storiesDir, ARCHIVE_DIR))).toBe(true);
    await repo.cleanup();
  }, 30_000);

  test("errors follow the convention through the binary: exit 1 + {error} JSON on stderr", async () => {
    const repo = await makeRepo();
    const r = story(repo.root, "done", "st-zzzz");
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(JSON.parse(r.stderr)).toEqual({ error: expect.stringContaining("st-zzzz") });
    await repo.cleanup();
  });

  test("the shim maps CLAUDE_SESSION_ID onto STORY_SESSION_ID and reports its own path", async () => {
    const repo = await makeRepo();
    const r = spawnSync(STORY_BIN, ["context", "--json"], { cwd: repo.root, env: { ...process.env, CLAUDE_SESSION_ID: "worker-7" }, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { cli: string }).cli).toBe(STORY_BIN);
    await repo.cleanup();
  });

  test("the OMP plugin's symlinked Node entry runs the same CLI: context, and guard exit codes", async () => {
    const repo = await makeRepo();
    const ompBin = resolve(STORIES_OMP_ROOT, "bin/story");
    const context = spawnSync(ompBin, ["context", "--json"], { cwd: repo.root, encoding: "utf8" });
    expect(context.status).toBe(0);
    const out = JSON.parse(context.stdout) as { rules: string; ready: unknown[] };
    expect(out.rules).toContain("# Using Stories");
    expect(out.ready).toEqual([]);
    expect(spawnSync(ompBin, ["guard", "--tool", "edit", "--path", "stories/st-a1b2-x.md"], { cwd: repo.root, encoding: "utf8" }).status).toBe(2);
    expect(spawnSync(ompBin, ["guard", "--tool", "edit", "--path", "src/x.ts"], { cwd: repo.root, encoding: "utf8" }).status).toBe(0);
    await repo.cleanup();
  });
});

describe("incident scenario: controller capture, now inert", () => {
  test("create → loop bound to worker-1 → planner tick is inert → worker tick blocks → done is idempotent", async () => {
    const repo = await makeRepo();

    // 1. story create: the .md file carries no execution state; state lives
    // in the local state store instead.
    const created = story(repo.root, "create", "--title", "Loop story", "--description", "d", "--ac", "a", "--type", "chore", "--json");
    expect(created.code).toBe(0);
    const { id } = JSON.parse(created.stdout) as { id: string };

    const storyFileName = readdirSync(join(repo.root, "stories")).find((n) => n.startsWith(id));
    const storyText = readFileSync(join(repo.root, "stories", storyFileName!), "utf8");
    expect(storyText).not.toContain("status:");

    const statePath = stateStorePath(repo.root);
    expect(existsSync(statePath)).toBe(true);
    const store = JSON.parse(readFileSync(statePath, "utf8")) as { stories: Record<string, unknown> };
    expect(store.stories[id]).toBeDefined();

    // 2. worker-1 starts a loop; a DIFFERENT session (planner-9) ticking must
    // be a no-op — the exact controller-capture shape from the 2026-08-18
    // incident, now inert because ownership binds at start, never at tick.
    // Binds via CLAUDE_SESSION_ID in the env — the only production path
    // (work/SKILL.md and README tell workers to run `story loop start
    // --goal "..."` bare) — not via --session.
    const loopStart = spawnSync(
      STORY_BIN,
      ["loop", "start", "--goal", "complete all stories"],
      { cwd: repo.root, env: { ...process.env, CLAUDE_SESSION_ID: "worker-1" }, encoding: "utf8" },
    );
    expect(loopStart.status).toBe(0);
    const loopFile = loopStatePath(repo.root, "worker-1");
    const loopBefore = readFileSync(loopFile, "utf8");
    expect(loopBefore).toContain("iteration: 0");

    const plannerTick = storyTick(repo.root, "planner-9");
    expect(plannerTick.code).toBe(EXIT.OK);
    expect(plannerTick.stdout).toBe("");
    expect(readFileSync(loopFile, "utf8")).toBe(loopBefore); // worker-1's loop file: untouched, iteration still 0
    const jsonTick = spawnSync(STORY_BIN, ["loop", "tick", "--session", "planner-9", "--json"], { cwd: repo.root, encoding: "utf8" });
    expect(jsonTick.status).toBe(EXIT.OK);
    expect(JSON.parse(jsonTick.stdout)).toEqual({ decision: "allow" });

    // 3. worker-1 ticking its own loop finds the claimable story and blocks,
    // naming it: status line, blank line, reason.
    const workerTick = storyTick(repo.root, "worker-1");
    expect(workerTick.code).toBe(EXIT.DENY);
    const [status, blank, ...reason] = workerTick.stdout.split("\n");
    expect(status).toMatch(/^story st-[0-9a-f]+ · iteration 1/);
    expect(blank).toBe("");
    expect(reason.join("\n")).toContain(id);

    // 4. claim → commit → done → done again: idempotent close.
    expect(story(repo.root, "claim", id, "--session", "worker-1").code).toBe(0);
    const wt = worktreePath(repo.root, id);
    await Bun.write(join(wt, "smoke.txt"), "hello\n");
    git(wt, "add", "smoke.txt");
    git(wt, "commit", "-m", "worker-1 work");

    expect(story(repo.root, "done", id, "--allow-unplanned").code).toBe(0);
    const doneAgain = story(repo.root, "done", id, "--allow-unplanned", "--json");
    expect(doneAgain.code).toBe(0);
    expect(JSON.parse(doneAgain.stdout)).toMatchObject({ id, status: "done", already: true });

    await repo.cleanup();
  }, 30_000);
});
