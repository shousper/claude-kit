import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadStories } from "../../plugins/stories/lib/board.mjs";
import { run } from "../../plugins/stories/lib/util.mjs";
import { makeRepo, runStory, storyText, writeStoryFile } from "./helpers";

const CONFIG = { storiesDir: "stories" };
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};

describe("story ready", () => {
  test("lists claimable stories, feedback flagged, respecting live worktree diffs", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "todo", priority: "P1", touches: "[src/x.ts]" }));
    await writeStoryFile(repo.root, "st-0002-b.md", storyText({ id: "st-0002", title: "b", status: "todo", touches: "[docs/**]" }));
    const r = await runStory(repo.root, ["ready", "--json"]);
    expect(r.code).toBe(0);
    expect(r.json()).toEqual([
      { id: "st-0001", title: "a", priority: "P1", feedback: false },
      { id: "st-0002", title: "b", priority: "P2", feedback: false },
    ]);

    // Claim st-0001, then touch src/x.ts's territory from its worktree —
    // a NEW story overlapping that actual diff must drop out of ready.
    expect((await runStory(repo.root, ["claim", "st-0001", "--session", "w1"])).code).toBe(0);
    writeFileSync(join(repo.root, ".worktrees/st-0001", "collide.ts"), "x");
    await writeStoryFile(repo.root, "st-0003-c.md", storyText({ id: "st-0003", title: "c", status: "todo", touches: "[collide.ts]" }));
    const after = (await runStory(repo.root, ["ready", "--json"])).json() as Array<{ id: string }>;
    expect(after.map((s) => s.id)).toEqual(["st-0002"]);
    await repo.cleanup();
  });
});

describe("story claim", () => {
  test("atomically writes claim + in-progress and creates the worktree", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "todo" }));
    const r = await runStory(repo.root, ["claim", "st-0001", "--session", "sess-1", "--json"]);
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({
      id: "st-0001",
      branch: "story/st-0001",
      worktree: join(repo.root, ".worktrees/st-0001"),
      session: "sess-1",
    });
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s.status).toBe("in-progress");
    expect(s.claim).toMatchObject({ session: "sess-1" });
    expect(Date.parse(s.claim!.lease as string)).toBeGreaterThan(0);
    expect(git(join(repo.root, ".worktrees/st-0001"), "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("story/st-0001");
    await repo.cleanup();
  });

  test("rejects non-ready stories: already claimed, dep-blocked, touches conflict", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "todo", touches: "[src/**]" }));
    await writeStoryFile(repo.root, "st-0002-b.md", storyText({ id: "st-0002", title: "b", status: "todo", touches: "[src/sub/y.ts]" }));
    await writeStoryFile(repo.root, "st-0003-c.md", storyText({ id: "st-0003", title: "c", status: "todo", depends_on: "[st-0002]" }));
    expect((await runStory(repo.root, ["claim", "st-0001"])).code).toBe(0);
    const again = await runStory(repo.root, ["claim", "st-0001"]);
    expect(again.code).toBe(1);
    expect(JSON.parse(again.stderr).error).toMatch(/not ready/);
    expect((await runStory(repo.root, ["claim", "st-0002"])).code).toBe(1); // touches conflict
    expect((await runStory(repo.root, ["claim", "st-0003"])).code).toBe(1); // dep not done
    expect((await runStory(repo.root, ["claim", "st-nope"])).code).toBe(1); // unknown id
    await repo.cleanup();
  });

  test("worktree creation failure leaves the board unchanged — no stuck claim, no orphan", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "todo" }));
    // Fail ONLY `git worktree add` (createWorktree's write step); every other
    // git call — findRoot, branchExists, activeDiffs — passes through to the
    // real git so the readiness gate still runs exactly as in production.
    const exec = (cmd: string, args: string[] = [], opts: Record<string, unknown> = {}) =>
      cmd === "git" && args[0] === "worktree" && args[1] === "add"
        ? { code: 1, stdout: "", stderr: "fatal: simulated worktree add failure" }
        : run(cmd, args, opts);
    const r = await runStory(repo.root, ["claim", "st-0001", "--session", "sess-1"], { exec });
    expect(r.code).toBe(1);
    // Create-first ordering: the board is never mutated when the worktree can't
    // be built. The story must still be a clean, claimable todo.
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s.status).toBe("todo");
    expect(s.claim).toBeUndefined();
    expect(existsSync(join(repo.root, ".worktrees/st-0001"))).toBe(false);
    // …and a real re-claim afterwards succeeds (the story was never stranded).
    expect((await runStory(repo.root, ["claim", "st-0001", "--session", "sess-2"])).code).toBe(0);
    expect(loadStories(repo.root, CONFIG)[0].status).toBe("in-progress");
    await repo.cleanup();
  });

  test("board-write failure after worktree creation tears the fresh worktree back down", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "todo" }));
    const storyFile = join(repo.root, "stories", "st-0001-a.md");
    // The worktree gets created for real; then — right after `git worktree add`
    // and before saveStory runs — swap the story file for a directory so
    // writeFileAtomic's rename onto it fails (EISDIR). The claim must roll the
    // FRESH worktree back down instead of leaving it orphaned behind a todo.
    const exec = (cmd: string, args: string[] = [], opts: Record<string, unknown> = {}) => {
      const res = run(cmd, args, opts);
      if (cmd === "git" && args[0] === "worktree" && args[1] === "add") {
        rmSync(storyFile);
        mkdirSync(storyFile);
      }
      return res;
    };
    // The board write fails with a raw (non-CliError) fs error, which main()
    // re-throws — but the rollback runs first. Whether it surfaces as a thrown
    // error or exit 1, the fresh worktree must be gone.
    await runStory(repo.root, ["claim", "st-0001", "--session", "sess-1"], { exec }).catch(() => {});
    expect(existsSync(join(repo.root, ".worktrees/st-0001"))).toBe(false); // fresh worktree torn down
    await repo.cleanup();
  });

  test("claiming a feedback item reuses the existing worktree and clears the flag", async () => {
    const repo = await makeRepo();
    await writeStoryFile(
      repo.root,
      "st-0001-a.md",
      storyText({ id: "st-0001", title: "a", status: "in-review", feedback: "true" }),
    );
    git(repo.root, "worktree", "add", "-b", "story/st-0001", join(repo.root, ".worktrees/st-0001"), "main");
    const r = await runStory(repo.root, ["claim", "st-0001", "--session", "w2", "--json"]);
    expect(r.code).toBe(0);
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s.status).toBe("in-progress");
    expect(s.feedback).toBeUndefined();
    expect(s.claim).toMatchObject({ session: "w2" });
    await repo.cleanup();
  });
});

describe("touches expansion (design §7: warn + note, never halt)", () => {
  test("an active story's diff growing into another active story's territory warns once and records a note", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "todo", touches: "[src/a.ts]" }));
    await writeStoryFile(repo.root, "st-0002-b.md", storyText({ id: "st-0002", title: "b", status: "todo", touches: "[docs/**]" }));
    expect((await runStory(repo.root, ["claim", "st-0001", "--session", "w1"])).code).toBe(0);
    expect((await runStory(repo.root, ["claim", "st-0002", "--session", "w2"])).code).toBe(0);
    // st-0001's ACTUAL diff grows into st-0002's declared territory.
    mkdirSync(join(repo.root, ".worktrees/st-0001/docs"), { recursive: true });
    writeFileSync(join(repo.root, ".worktrees/st-0001/docs/notes.md"), "x");
    const r = await runStory(repo.root, ["ready", "--json"]);
    expect(r.code).toBe(0); // warn, never halt — stdout JSON stays parseable
    expect(r.json()).toEqual([]);
    expect(r.stderr).toContain("warning: st-0001");
    expect(r.stderr).toContain("st-0002");
    const noted = loadStories(repo.root, CONFIG).find((s) => s.id === "st-0001")!;
    expect(noted.body).toMatch(/## Implementation Notes[\s\S]*touches-expansion: overlaps st-0002/);
    // once per pair: a second ready neither re-warns nor duplicates the note
    const again = await runStory(repo.root, ["ready", "--json"]);
    expect(again.stderr).toBe("");
    const body = loadStories(repo.root, CONFIG).find((s) => s.id === "st-0001")!.body;
    expect(body.match(/touches-expansion: overlaps st-0002/g)!.length).toBe(1);
    await repo.cleanup();
  });
});
