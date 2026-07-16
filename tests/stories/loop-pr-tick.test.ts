import { describe, expect, test } from "bun:test";
import { tick } from "../../plugins/stories/lib/loop.mjs";
import { makePrRepo } from "./gh-helpers.ts";

describe("loop tick in pr mode", () => {
  test("tick invokes the sweep when merge mode is pr", async () => {
    const root = await makePrRepo();
    let swept = 0;
    const decision = await tick("sess-1", {
      root,
      sweepFn: async () => {
        swept++;
        return { swept: true, effects: [] };
      },
    });
    expect(swept).toBe(1);
    expect(decision.decision).toBe("allow"); // no active loop state in this repo
  });

  test("tick does not sweep in self mode", async () => {
    const root = await makePrRepo({ merge: "self" });
    let swept = 0;
    await tick("sess-1", { root, sweepFn: async () => { swept++; return { swept: true, effects: [] }; } });
    expect(swept).toBe(0);
  });

  test("a throwing sweep does not break the tick", async () => {
    const root = await makePrRepo();
    const decision = await tick("sess-1", {
      root,
      sweepFn: async () => {
        throw new Error("gh exploded");
      },
    });
    expect(decision.decision).toBe("allow");
  });
});
