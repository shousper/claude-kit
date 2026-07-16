import { describe, expect, test } from "bun:test";
import { actionableItems, detectEffects } from "../../plugins/stories/lib/github.mjs";
import { comment, prDetail, prListEntry, review } from "./gh-fixtures.ts";

const story = (id: string, number: number, over: Record<string, unknown> = {}) => ({
  id,
  title: "t",
  status: "in-review",
  pr: { number, lastSync: "2026-07-08T12:00:00Z" },
  ...over,
});

describe("actionableItems", () => {
  test("collects post-cursor reviews and comments from other users", () => {
    const items = actionableItems(
      prDetail({
        reviews: [
          review(), // CHANGES_REQUESTED at 13:00 — actionable
          review({ state: "APPROVED", body: "lgtm" }), // approvals are not actionable
          review({ state: "COMMENTED", body: "" }), // empty comment review — not actionable
          review({ submittedAt: "2026-07-08T11:00:00Z" }), // before cursor
          review({ author: { login: "me" } }), // self — ignored
        ],
        comments: [
          comment(), // actionable
          comment({ author: { login: "me" } }), // self — ignored
          comment({ createdAt: "2026-07-08T11:59:00Z" }), // before cursor
        ],
      }),
      "2026-07-08T12:00:00Z",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "review", state: "CHANGES_REQUESTED", body: "fix the null check" });
    expect(items[1]).toMatchObject({ kind: "comment", body: "please add a test" });
  });

  test("missing cursor means everything is new", () => {
    expect(actionableItems(prDetail({ comments: [comment()] }), undefined)).toHaveLength(1);
  });
});

describe("detectEffects", () => {
  test("merged and closed PRs map to merged/closed effects", () => {
    const effects = detectEffects(
      [story("st-a", 1), story("st-b", 2)],
      [prListEntry({ number: 1, state: "MERGED" }), prListEntry({ number: 2, state: "CLOSED" })],
      new Map(),
      "2026-07-08T14:00:00Z",
    );
    expect(effects).toEqual([
      { type: "merged", id: "st-a", number: 1 },
      { type: "closed", id: "st-b", number: 2 },
    ]);
  });

  test("actionable detail produces a feedback effect carrying items and the updatedAt cursor", () => {
    const effects = detectEffects(
      [story("st-a", 5)],
      [prListEntry({ number: 5, updatedAt: "2026-07-08T13:30:00Z" })],
      new Map([[5, prDetail({ reviews: [review()] })]]),
      "2026-07-08T14:00:00Z",
    );
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ type: "feedback", id: "st-a", number: 5, cursor: "2026-07-08T13:30:00Z" });
    expect(effects[0].items).toHaveLength(1);
  });

  test("BEHIND and DIRTY produce drift effects; CLEAN/UNKNOWN produce nothing", () => {
    const effects = detectEffects(
      [story("st-a", 1), story("st-b", 2), story("st-c", 3), story("st-d", 4)],
      [
        prListEntry({ number: 1, mergeStateStatus: "BEHIND" }),
        prListEntry({ number: 2, mergeStateStatus: "DIRTY" }),
        prListEntry({ number: 3, mergeStateStatus: "CLEAN" }),
        prListEntry({ number: 4, mergeStateStatus: "UNKNOWN" }),
      ],
      new Map(),
      "2026-07-08T14:00:00Z",
    );
    expect(effects).toEqual([
      { type: "drift", id: "st-a", number: 1, conflictLikely: false },
      { type: "drift", id: "st-b", number: 2, conflictLikely: true },
    ]);
  });

  test("feedback beats drift; one effect per story per sweep", () => {
    const effects = detectEffects(
      [story("st-a", 5)],
      [prListEntry({ number: 5, mergeStateStatus: "BEHIND" })],
      new Map([[5, prDetail({ reviews: [review()] })]]),
      "2026-07-08T14:00:00Z",
    );
    expect(effects.map((e) => e.type)).toEqual(["feedback"]);
  });

  test("already-flagged and non-in-review stories skip feedback/drift, but merged still lands", () => {
    const effects = detectEffects(
      [
        story("st-a", 1, { feedback: true }),
        story("st-b", 2, { status: "in-progress" }),
        story("st-c", 3, { status: "in-progress" }),
        story("st-d", 4, { status: "done" }),
        story("st-e", 5, { status: "blocked" }),
      ],
      [
        prListEntry({ number: 1, mergeStateStatus: "BEHIND" }),
        prListEntry({ number: 2, mergeStateStatus: "BEHIND" }),
        prListEntry({ number: 3, state: "MERGED" }),
        prListEntry({ number: 4, state: "MERGED" }),
        prListEntry({ number: 5, state: "CLOSED" }),
      ],
      new Map([[1, prDetail({ reviews: [review()] })]]),
      "2026-07-08T14:00:00Z",
    );
    expect(effects).toEqual([{ type: "merged", id: "st-c", number: 3 }]);
  });

  test("stories whose PR is missing from the list are skipped", () => {
    expect(detectEffects([story("st-a", 99)], [prListEntry({ number: 1 })], new Map(), "x")).toEqual([]);
  });
});

describe("detectEffects: approved fallback merge", () => {
  test("OPEN + APPROVED + CLEAN + quiet emits a merge effect", () => {
    const effects = detectEffects(
      [story("st-a", 5)],
      [prListEntry({ number: 5, reviewDecision: "APPROVED" })],
      new Map(),
      "2026-07-08T14:00:00Z",
    );
    expect(effects).toEqual([{ type: "merge", id: "st-a", number: 5 }]);
  });

  test("feedback beats merge; APPROVED but BEHIND routes to drift; flagged stories are skipped", () => {
    const effects = detectEffects(
      [story("st-a", 1), story("st-b", 2), story("st-c", 3, { feedback: true })],
      [
        prListEntry({ number: 1, reviewDecision: "APPROVED" }),
        prListEntry({ number: 2, reviewDecision: "APPROVED", mergeStateStatus: "BEHIND" }),
        prListEntry({ number: 3, reviewDecision: "APPROVED" }),
      ],
      new Map([[1, prDetail({ reviews: [review()] })]]),
      "2026-07-08T14:00:00Z",
    );
    expect(effects.map((e) => `${e.type}:${e.id}`)).toEqual(["feedback:st-a", "drift:st-b"]);
  });
});
