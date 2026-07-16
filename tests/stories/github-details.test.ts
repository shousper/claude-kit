import { describe, expect, test } from "bun:test";
import { fetchDetails } from "../../plugins/stories/lib/github.mjs";
import { fail, makeFakeExec, ok } from "./gh-helpers.ts";
import { prDetail } from "./gh-fixtures.ts";

describe("fetchDetails", () => {
  test("fetches each requested PR, at most `cap` in flight", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { exec, calls } = makeFakeExec([
      [/^gh pr view /, async (_cmd, args) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return ok(JSON.stringify(prDetail({ author: { login: `pr${args[2]}` } })));
      }],
    ]);
    const out = await fetchDetails([1, 2, 3, 4, 5], { exec, cwd: "/repo", cap: 2 });
    expect(out.size).toBe(5);
    expect(out.get(3)!.author.login).toBe("pr3");
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(calls.every((c) => c.args.includes("author,reviews,comments"))).toBe(true);
  });

  test("a failing detail fetch is skipped, not fatal", async () => {
    const { exec } = makeFakeExec([
      ["gh pr view 2", fail(1, "rate limited")],
      [/^gh pr view /, ok(JSON.stringify(prDetail()))],
    ]);
    const out = await fetchDetails([1, 2], { exec, cwd: "/repo" });
    expect(out.has(1)).toBe(true);
    expect(out.has(2)).toBe(false);
  });

  test("no numbers → no calls", async () => {
    const { exec, calls } = makeFakeExec();
    expect((await fetchDetails([], { exec, cwd: "/repo" })).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
