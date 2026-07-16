import path from "node:path";
import { describe, expect, test } from "bun:test";
import { applyEffect, isFeedback } from "../../plugins/stories/lib/github.mjs";
import { loadStoryById, makeFakeExec, makePrRepo, writeStory } from "./gh-helpers.ts";
import { fail as failRes } from "./gh-helpers.ts";

export const inReviewLines = (id: string, number: number, extra: string[] = []) => [
  `id: ${id}`,
  "title: A story",
  "type: feature",
  "status: in-review",
  "priority: P2",
  `pr: {number: ${number}, lastSync: 2026-07-08T12:00:00Z, syncAttempts: 0}`,
  "created: 2026-07-08",
  "updated: 2026-07-08",
  ...extra,
];

describe("applyEffect: feedback", () => {
  test("sets the flag, appends the feedback note, advances the cursor", async () => {
    const root = await makePrRepo();
    await writeStory(root, inReviewLines("st-feed", 12));
    await applyEffect(root, {
      type: "feedback",
      id: "st-feed",
      number: 12,
      cursor: "2026-07-08T13:30:00Z",
      items: [
        { kind: "review", author: "reviewer", state: "CHANGES_REQUESTED", body: "fix the null check" },
        { kind: "comment", author: "reviewer", body: "please add a test" },
      ],
    }, { exec: makeFakeExec().exec });

    const after = await loadStoryById(root, "st-feed");
    expect(after.status).toBe("in-review");
    expect(isFeedback(after)).toBe(true);
    expect(String(after.pr.lastSync)).toBe("2026-07-08T13:30:00Z");
    expect(after.body).toContain("fix the null check");
    expect(after.body).toContain("please add a test");
    expect(after.body).toContain("kit:receiving-review");
  });
});

describe("applyEffect: closed", () => {
  test("parks the story with a question", async () => {
    const root = await makePrRepo();
    await writeStory(root, inReviewLines("st-c15d", 13));
    await applyEffect(root, { type: "closed", id: "st-c15d", number: 13 }, { exec: makeFakeExec().exec });

    const after = await loadStoryById(root, "st-c15d");
    expect(after.status).toBe("blocked");
    expect(after.body).toContain("closed without merging");
    expect(after.body).toContain("#13");
  });
});

describe("applyEffect: merged", () => {
  test("closes the story, tears down the worktree, pulls main", async () => {
    const root = await makePrRepo();
    await writeStory(root, inReviewLines("st-33cd", 14));
    const teardowns: string[] = [];
    const { exec, lines, calls } = makeFakeExec();
    await applyEffect(root, { type: "merged", id: "st-33cd", number: 14 }, {
      exec,
      teardownFn: async (r: string, id: string) => teardowns.push(`${r}:${id}`),
    });

    const after = await loadStoryById(root, "st-33cd");
    expect(after.status).toBe("done");
    expect(after.claim).toBeUndefined();
    expect(after.body).toContain("PR #14 merged");
    expect(teardowns).toEqual([`${root}:st-33cd`]);
    const pull = calls.find((c) => lines()[calls.indexOf(c)] === "git pull --ff-only")!;
    expect(pull.opts.cwd).toBe(root);
  });

  test("teardown and pull failures are noted, not fatal", async () => {
    const root = await makePrRepo();
    await writeStory(root, inReviewLines("st-3302", 15));
    const { exec } = makeFakeExec([["git pull", failRes(1, "dirty tree")]]);
    await applyEffect(root, { type: "merged", id: "st-3302", number: 15 }, {
      exec,
      teardownFn: async () => {
        throw new Error("worktree busy");
      },
    });
    const after = await loadStoryById(root, "st-3302");
    expect(after.status).toBe("done");
    expect(after.body).toContain("teardown failed");
    expect(after.body).toContain("pull main manually");
  });
});

const gatesPass = { pass: true, results: [{ gate: "test", pass: true }] };
const gatesFail = { pass: false, results: [{ gate: "test", pass: false }] };

describe("applyEffect: drift", () => {
  test("green path: fetch, merge main, re-run gates, push", async () => {
    const root = await makePrRepo();
    await writeStory(root, inReviewLines("st-d4f7", 16));
    const gateCalls: string[] = [];
    const { exec, lines, calls } = makeFakeExec();
    const res = await applyEffect(root, { type: "drift", id: "st-d4f7", number: 16, conflictLikely: false }, {
      exec,
      runGates: async (_r: string, s: { id: string }, o: { cwd: string }) => {
        gateCalls.push(`${s.id}@${o.cwd}`);
        return gatesPass;
      },
    });
    expect(res.outcome).toBe("pushed");
    const wt = path.join(root, ".worktrees", "st-d4f7");
    expect(lines()).toEqual([
      "git fetch origin main",
      "git merge origin/main --no-edit",
      "git push origin story/st-d4f7",
    ]);
    expect(calls.every((c) => c.opts.cwd === wt)).toBe(true);
    expect(gateCalls).toEqual([`st-d4f7@${wt}`]);

    const after = await loadStoryById(root, "st-d4f7");
    expect(Number(after.pr.syncAttempts)).toBe(1);
    expect(isFeedback(after)).toBe(false);
    expect(after.body).toContain("gates green");
  });

  test("gate failure files a feedback item instead of pushing", async () => {
    const root = await makePrRepo();
    await writeStory(root, inReviewLines("st-d4f2", 17));
    const { exec, lines } = makeFakeExec();
    const res = await applyEffect(root, { type: "drift", id: "st-d4f2", number: 17, conflictLikely: false }, {
      exec,
      runGates: async () => gatesFail,
    });
    expect(res.outcome).toBe("gates-failed");
    expect(lines().some((l) => l.startsWith("git push"))).toBe(false);
    const after = await loadStoryById(root, "st-d4f2");
    expect(isFeedback(after)).toBe(true);
    expect(after.body).toContain("gates failed");
    expect(after.body).toContain("test");
  });

  test("merge conflict aborts the merge and files a feedback item without running gates", async () => {
    const root = await makePrRepo();
    await writeStory(root, inReviewLines("st-d4f3", 18));
    let gatesRan = false;
    const { exec, lines } = makeFakeExec([["git merge origin/main", failRes(1, "CONFLICT")]]);
    const res = await applyEffect(root, { type: "drift", id: "st-d4f3", number: 18, conflictLikely: true }, {
      exec,
      runGates: async () => {
        gatesRan = true;
        return gatesPass;
      },
    });
    expect(res.outcome).toBe("conflict");
    expect(lines()).toContain("git merge --abort");
    expect(gatesRan).toBe(false);
    const after = await loadStoryById(root, "st-d4f3");
    expect(isFeedback(after)).toBe(true);
    expect(after.body).toContain("conflict");
  });

  test("budget exhausted parks the story with a question and touches no git", async () => {
    const root = await makePrRepo(); // default maxFixRoundsPerStory: 3
    await writeStory(root, [
      "id: st-d4f4",
      "title: A story",
      "type: feature",
      "status: in-review",
      "priority: P2",
      "pr: {number: 19, lastSync: 2026-07-08T12:00:00Z, syncAttempts: 3}",
      "created: 2026-07-08",
      "updated: 2026-07-08",
    ]);
    const { exec, calls } = makeFakeExec();
    const res = await applyEffect(root, { type: "drift", id: "st-d4f4", number: 19, conflictLikely: false }, { exec });
    expect(res.outcome).toBe("parked");
    expect(calls).toHaveLength(0);
    const after = await loadStoryById(root, "st-d4f4");
    expect(after.status).toBe("blocked");
    expect(after.body).toContain("budget");
  });
});

describe("applyEffect: merge (approved fallback)", () => {
  test("runs gh pr merge and leaves the story in-review for the next sweep's merged path", async () => {
    const root = await makePrRepo();
    await writeStory(root, inReviewLines("st-a99e", 20));
    const { exec, lines } = makeFakeExec();
    const res = await applyEffect(root, { type: "merge", id: "st-a99e", number: 20 }, { exec });
    expect(res).toEqual({ id: "st-a99e", type: "merge", outcome: "merged" });
    expect(lines()).toContain("gh pr merge 20 --merge");
    const after = await loadStoryById(root, "st-a99e");
    expect(after.status).toBe("in-review"); // the merged path closes it next sweep
    expect(after.body).toContain("merged by sweep");
  });

  test("a failing gh pr merge is noted, not fatal (branch protection, races)", async () => {
    const root = await makePrRepo();
    await writeStory(root, inReviewLines("st-a992", 21));
    const { exec } = makeFakeExec([["gh pr merge", failRes(1, "merge blocked by branch protection")]]);
    const res = await applyEffect(root, { type: "merge", id: "st-a992", number: 21 }, { exec });
    expect(res.outcome).toBe("failed");
    const after = await loadStoryById(root, "st-a992");
    expect(after.status).toBe("in-review");
    expect(after.body).toContain("merge manually");
  });
});
