import { describe, expect, test } from "bun:test";
import { fail, loadStoryById, makeFakeExec, makePrRepo, ok, writeStory } from "./gh-helpers.ts";

describe("gh test harness", () => {
  test("fakeExec matches routes in order, records calls, defaults to success", async () => {
    const { exec, calls } = makeFakeExec([
      ["gh pr list", ok("[]")],
      [/^gh pr view \d+/, fail(1, "nope")],
    ]);
    expect((await exec("gh", ["pr", "list"])).stdout).toBe("[]");
    expect((await exec("gh", ["pr", "view", "7"])).code).toBe(1);
    expect((await exec("git", ["push"])).code).toBe(0);
    expect(calls.length).toBe(3);
    expect(calls[2].cmd).toBe("git");
  });

  test("writeStory round-trips a pr flow map through the board parser", async () => {
    const root = await makePrRepo();
    await writeStory(root, [
      "id: st-c0de",
      "title: Round trip",
      "type: feature",
      "status: in-review",
      "priority: P2",
      "pr: {number: 12, lastSync: 2026-07-08T12:00:00Z, syncAttempts: 0}",
      "created: 2026-07-08",
      "updated: 2026-07-08",
    ]);
    const story = await loadStoryById(root, "st-c0de");
    expect(story.id).toBe("st-c0de");
    expect(Number(story.pr.number)).toBe(12);
    expect(String(story.pr.lastSync)).toBe("2026-07-08T12:00:00Z");
  });
});
