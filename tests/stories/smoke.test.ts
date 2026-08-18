import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { makeRepo, STORY_BIN } from "./helpers";

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
// `story loop tick --hook` reads the Stop-hook event JSON from stdin — the
// only smoke command that needs stdin, so node's spawnSync (with `input`)
// covers it rather than teaching `story()` about stdin generally.
function storyHook(cwd: string, stdin: Record<string, unknown>) {
  const r = spawnSync(STORY_BIN, ["loop", "tick", "--hook"], { cwd, input: JSON.stringify(stdin), encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("bin/story end-to-end", () => {
  test("create → ready → claim → work → done drives a story to merged", async () => {
    const repo = await makeRepo();

    const created = story(repo.root, "create", "--title", "Smoke story", "--type", "chore", "--json");
    expect(created.code).toBe(0);
    const { id } = JSON.parse(created.stdout) as { id: string };
    expect(id).toMatch(/^st-[0-9a-f]{4}$/);

    const ready = story(repo.root, "ready", "--json");
    expect(ready.code).toBe(0);
    expect((JSON.parse(ready.stdout) as Array<{ id: string }>).map((s) => s.id)).toEqual([id]);

    expect(story(repo.root, "claim", id, "--session", "smoke").code).toBe(0);
    const wt = join(repo.root, ".worktrees", id);
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
    expect(existsSync(join(repo.root, "stories/archive"))).toBe(true);
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
});

describe("incident scenario: controller capture, now inert", () => {
  test("create → loop bound to worker-1 → planner tick is inert → worker tick blocks → done is idempotent", async () => {
    const repo = await makeRepo();

    // 1. story create: the .md file carries no execution state; state lives
    // in the local state store instead.
    const created = story(repo.root, "create", "--title", "Loop story", "--type", "chore", "--json");
    expect(created.code).toBe(0);
    const { id } = JSON.parse(created.stdout) as { id: string };

    const storyFileName = readdirSync(join(repo.root, "stories")).find((n) => n.startsWith(id));
    const storyText = readFileSync(join(repo.root, "stories", storyFileName!), "utf8");
    expect(storyText).not.toContain("status:");

    const statePath = join(repo.root, ".claude", "story-state.local.json");
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
    const loopFile = join(repo.root, ".claude", "story-loop.worker-1.local.md");
    const loopBefore = readFileSync(loopFile, "utf8");
    expect(loopBefore).toContain("iteration: 0");

    const plannerTick = storyHook(repo.root, { session_id: "planner-9" });
    expect(plannerTick.code).toBe(0);
    expect(JSON.parse(plannerTick.stdout)).toEqual({});
    expect(readFileSync(loopFile, "utf8")).toBe(loopBefore); // worker-1's loop file: untouched, iteration still 0

    // 3. worker-1 ticking its own loop finds the claimable story and blocks
    // Stop, naming it.
    const workerTick = storyHook(repo.root, { session_id: "worker-1" });
    expect(workerTick.code).toBe(0);
    const workerResult = JSON.parse(workerTick.stdout) as { decision: string; reason: string };
    expect(workerResult.decision).toBe("block");
    expect(workerResult.reason).toContain(id);

    // 4. claim → commit → done → done again: idempotent close.
    expect(story(repo.root, "claim", id, "--session", "worker-1").code).toBe(0);
    const wt = join(repo.root, ".worktrees", id);
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
