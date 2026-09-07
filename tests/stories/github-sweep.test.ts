import { promises as fs } from "node:fs";
import { describe, expect, test } from "bun:test";
import { isFeedback, sweep } from "../../shared/stories/lib/github.mjs";
import { withLock } from "../../shared/stories/lib/locks.mjs";
import { sweepStatePath } from "../../shared/stories/lib/util.mjs";
import { branchName } from "../../shared/stories/lib/worktrees.mjs";
import { inReviewStoryLines, loadStoryById, makeFakeExec, makePrRepo, ok, writeStory } from "./gh-helpers.ts";
import { prDetail, prListEntry, review } from "./gh-fixtures.ts";
import { DEFAULT_CONFIG, makeRepo, runStory } from "./helpers";

const NOW = () => new Date("2026-07-08T14:00:00Z");

describe("sweep", () => {
  test("non-pr merge mode is a no-op", async () => {
    const root = await makePrRepo({ merge: "self" });
    const { exec, calls } = makeFakeExec();
    expect(await sweep(root, { exec, now: NOW })).toEqual({ swept: false, reason: "not-pr-mode" });
    expect(calls).toHaveLength(0);
  });

  test("a recent shared lastSweep dedups; --force overrides", async () => {
    const root = await makePrRepo();
    await fs.writeFile(
      sweepStatePath(root),
      JSON.stringify({ lastSweep: "2026-07-08T13:59:50Z" }),
    );
    const { exec, calls } = makeFakeExec();
    const skipped = await sweep(root, { exec, now: NOW });
    expect(skipped.swept).toBe(false);
    expect(skipped.reason).toBe("recent");
    expect(calls).toHaveLength(0);

    const forced = await sweep(root, { exec, now: NOW, force: true });
    expect(forced.swept).toBe(true); // no pr stories → no gh calls, but the sweep ran
    expect(calls).toHaveLength(0);
    const state = JSON.parse(await fs.readFile(sweepStatePath(root), "utf8"));
    expect(state.lastSweep).toBe("2026-07-08T14:00:00.000Z");
  });

  test("a concurrent holder of the sweep lock makes sweep yield", async () => {
    const root = await makePrRepo();
    const { exec } = makeFakeExec();
    await withLock(root, "sweep", async () => {
      expect(await sweep(root, { exec, now: NOW, lockTimeoutMs: 50 })).toEqual({
        swept: false,
        reason: "locked",
      });
    });
  });

  test("full pass: one list call, details only for changed open PRs, effects applied, cursors advanced", async () => {
    const root = await makePrRepo();
    await writeStory(root, inReviewStoryLines("st-3e46", 1));
    await writeStory(root, inReviewStoryLines("st-feed", 2));
    await writeStory(root, inReviewStoryLines("st-901e", 3));

    const list = [
      prListEntry({ number: 1, state: "MERGED", headRefName: branchName("st-3e46") }),
      prListEntry({ number: 2, updatedAt: "2026-07-08T13:00:00Z", headRefName: branchName("st-feed") }),
      prListEntry({ number: 3, updatedAt: "2026-07-08T13:00:00Z", headRefName: branchName("st-901e") }),
    ];
    const { exec, lines } = makeFakeExec([
      ["gh pr list", ok(JSON.stringify(list))],
      ["gh pr view 2", ok(JSON.stringify(prDetail({ reviews: [review({ submittedAt: "2026-07-08T12:30:00Z" })] })))],
      ["gh pr view 3", ok(JSON.stringify(prDetail()))],
    ]);
    const teardowns: string[] = [];
    const res = await sweep(root, {
      exec,
      now: NOW,
      teardownFn: async (_r: string, id: string) => teardowns.push(id),
    });

    expect(res.swept).toBe(true);
    expect(lines().filter((l) => l.startsWith("gh pr list")).length).toBe(1);
    expect(lines().filter((l) => l.startsWith("gh pr view")).length).toBe(2); // never for the merged PR
    expect(res.effects.map((e: { type: string }) => e.type).sort()).toEqual(["feedback", "merged"]);

    expect((await loadStoryById(root, "st-3e46")).status).toBe("done");
    expect(teardowns).toEqual(["st-3e46"]);

    const feed = await loadStoryById(root, "st-feed");
    expect(isFeedback(feed)).toBe(true);
    expect(String(feed.pr.lastSync)).toBe("2026-07-08T13:00:00Z");

    const quiet = await loadStoryById(root, "st-901e");
    expect(isFeedback(quiet)).toBe(false);
    expect(String(quiet.pr.lastSync)).toBe("2026-07-08T13:00:00Z"); // cursor advanced even with no feedback
  });
});

describe("story sweep (CLI)", () => {
  test("prints the sweep result JSON via the --json convention and exits 0", async () => {
    const repo = await makeRepo(); // merge: self
    const r = await runStory(repo.root, ["sweep", "--json"]);
    expect(r.code).toBe(0);
    expect(r.json()).toEqual({ swept: false, reason: "not-pr-mode" });
    await repo.cleanup();
  });
});
