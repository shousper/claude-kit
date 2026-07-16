import { describe, expect, test } from "bun:test";
import { computeReady, patternsOverlap } from "../../plugins/stories/lib/board.mjs";

type S = Record<string, unknown>;
const st = (o: S): S => ({
  id: "st-0000", title: "t", type: "feature", status: "todo",
  priority: "P2", depends_on: [], touches: [], exclusive: false, body: "", ...o,
});
const ids = (stories: unknown[]) => (stories as Array<{ id: string }>).map((s) => s.id);

describe("patternsOverlap (conservative: possible overlap counts as overlap)", () => {
  const cases: Array<[string, string, boolean]> = [
    ["src/a.ts", "src/a.ts", true],
    ["src/a.ts", "src/b.ts", false],
    ["src/**", "src/deep/x.ts", true],
    ["src/**", "docs/x.md", false],
    ["src/*.ts", "src/main.ts", true],        // wildcard segment matches
    ["src/*", "src/deep/x.ts", true],          // prefix exhausted → conservative overlap
    ["src", "src/deep/x.ts", true],            // dir-literal prefix → overlap
    ["a/b/c", "a/b", true],                    // symmetric prefix
    ["**", "anything/at/all", true],
    ["src/*", "docs/x.md", false],
    ["src/gates/impl.ts", "src/index.ts", false],
  ];
  for (const [a, b, want] of cases) {
    test(`${a} vs ${b} → ${want}`, () => {
      expect(patternsOverlap(a, b)).toBe(want);
      expect(patternsOverlap(b, a)).toBe(want); // symmetric
    });
  }
});

describe("computeReady — deps, claims, status", () => {
  test("todo with satisfied deps is ready; backlog/blocked/done are not", () => {
    const stories = [
      st({ id: "st-0001" }),
      st({ id: "st-0002", status: "backlog" }),
      st({ id: "st-0003", status: "blocked" }),
      st({ id: "st-0004", status: "done" }),
    ];
    expect(ids(computeReady(stories))).toEqual(["st-0001"]);
  });

  test("unfinished dep excludes; done dep admits; dangling dep excludes (conservative)", () => {
    const stories = [
      st({ id: "st-0001", depends_on: ["st-0002"] }),
      st({ id: "st-0002", status: "in-progress" }),
      st({ id: "st-0003", depends_on: ["st-0004"] }),
      st({ id: "st-0004", status: "done" }),
      st({ id: "st-0005", depends_on: ["st-dead"] }),
    ];
    expect(ids(computeReady(stories))).toEqual(["st-0003"]);
  });

  test("claimed stories are excluded", () => {
    const stories = [
      st({ id: "st-0001", claim: { session: "s", lease: "2026-07-08T00:00:00Z" } }),
      st({ id: "st-0002" }),
    ];
    expect(ids(computeReady(stories))).toEqual(["st-0002"]);
  });

  test("declared touches of in-progress AND in-review stories block overlapping todos", () => {
    const stories = [
      st({ id: "st-0001", status: "in-progress", touches: ["src/gates/**"] }),
      st({ id: "st-0002", status: "in-review", touches: ["docs/**"] }),
      st({ id: "st-0003", touches: ["src/gates/multiplier.ts"] }), // blocked by st-0001
      st({ id: "st-0004", touches: ["docs/readme.md"] }),          // blocked by st-0002 (in-review holds touches)
      st({ id: "st-0005", touches: ["lib/free.ts"] }),             // free
    ];
    expect(ids(computeReady(stories))).toEqual(["st-0005"]);
  });

  test("empty declared touches on the candidate never conflicts by declaration", () => {
    const stories = [
      st({ id: "st-0001", status: "in-progress", touches: ["src/**"] }),
      st({ id: "st-0002", touches: [] }),
    ];
    expect(ids(computeReady(stories))).toEqual(["st-0002"]);
  });
});

describe("computeReady — diff union, exclusive, feedback (table-driven)", () => {
  const table: Array<{
    name: string;
    stories: S[];
    diffs?: Map<string, string[]>;
    want: string[];
  }> = [
    {
      name: "actual worktree diff blocks even when declared touches are empty (underdeclaration hole)",
      stories: [
        st({ id: "st-0001", status: "in-progress", touches: [] }),
        st({ id: "st-0002", touches: ["src/x.ts"] }),
      ],
      diffs: new Map([["st-0001", ["src/x.ts"]]]),
      want: [],
    },
    {
      name: "diff union is additive: declared misses, diff catches",
      stories: [
        st({ id: "st-0001", status: "in-progress", touches: ["docs/**"] }),
        st({ id: "st-0002", touches: ["src/x.ts"] }),
        st({ id: "st-0003", touches: ["lib/y.ts"] }),
      ],
      diffs: new Map([["st-0001", ["src/x.ts"]]]),
      want: ["st-0003"],
    },
    {
      name: "an active exclusive story freezes the whole board",
      stories: [
        st({ id: "st-0001", status: "in-progress", exclusive: true, touches: [] }),
        st({ id: "st-0002", touches: ["unrelated/z.ts"] }),
      ],
      want: [],
    },
    {
      name: "an exclusive candidate is ready only on a quiet board",
      stories: [st({ id: "st-0001", exclusive: true })],
      want: ["st-0001"],
    },
    {
      name: "an exclusive candidate waits while anything is active — even non-overlapping",
      stories: [
        st({ id: "st-0001", exclusive: true, touches: ["a.ts"] }),
        st({ id: "st-0002", status: "in-review", touches: ["b.ts"] }),
      ],
      want: [],
    },
    {
      name: "feedback items rank before higher-priority todos",
      stories: [
        st({ id: "st-0002", status: "in-review", feedback: true, priority: "P3", touches: ["a.ts"] }),
        st({ id: "st-0001", priority: "P0", touches: ["zz.ts"] }),
      ],
      want: ["st-0002", "st-0001"],
    },
    {
      name: "claimed feedback items are excluded (another worker took it)",
      stories: [
        st({ id: "st-0001", status: "in-review", feedback: true, claim: { session: "s", lease: "x" } }),
      ],
      want: [],
    },
    {
      name: "plain in-review without feedback is not workable",
      stories: [st({ id: "st-0001", status: "in-review" })],
      want: [],
    },
    {
      name: "feedback on the exclusive story itself survives the freeze; other feedback does not",
      stories: [
        st({ id: "st-0001", status: "in-review", feedback: true, exclusive: true }),
        st({ id: "st-0002", status: "in-review", feedback: true }),
        st({ id: "st-0003" }),
      ],
      want: ["st-0001"],
    },
    {
      name: "ordering: priority then id within each band",
      stories: [
        st({ id: "st-bbbb", priority: "P1", touches: ["b"] }),
        st({ id: "st-aaaa", priority: "P1", touches: ["a"] }),
        st({ id: "st-cccc", priority: "P0", touches: ["c"] }),
        st({ id: "st-ffff", status: "in-review", feedback: true, priority: "P2" }),
        st({ id: "st-eeee", status: "in-review", feedback: true, priority: "P1" }),
      ],
      want: ["st-eeee", "st-ffff", "st-cccc", "st-aaaa", "st-bbbb"],
    },
  ];

  for (const { name, stories, diffs, want } of table) {
    test(name, () => {
      expect(ids(computeReady(stories, { diffs }))).toEqual(want);
    });
  }
});
