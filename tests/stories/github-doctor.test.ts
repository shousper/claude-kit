import { describe, expect, test } from "bun:test";
import { loadStories } from "../../plugins/stories/lib/board.mjs";
import { DEFAULT_CONFIG, makeRepo, runStory, storyText, writeStoryFile } from "./helpers";

const CONFIG = { storiesDir: "stories" };

describe("doctor stale-lease reclaim is pr-aware (Task E11)", () => {
  test("stale claim on a story WITH a pr record reclaims to in-review + feedback: true", async () => {
    const repo = await makeRepo({ ...DEFAULT_CONFIG, merge: "pr" });
    await writeStoryFile(
      repo.root,
      "st-0001-a.md",
      storyText({
        id: "st-0001", title: "a", status: "in-progress",
        claim: "{session: dead, lease: 2020-01-01T00:00:00.000Z}",
        pr: "{number: 12, lastSync: 2026-07-08T12:00:00Z, syncAttempts: 0}",
      }),
    );
    const r = await runStory(repo.root, ["doctor", "--fix", "--json"]);
    expect(r.code).toBe(0);
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s.status).toBe("in-review"); // the PR still exists — feedback path, not fresh todo
    expect(s.feedback).toBe(true);
    expect(s.claim).toBeUndefined();
    await repo.cleanup();
  });

  test("without a pr record the reclaim still lands on todo (B21 behavior preserved)", async () => {
    const repo = await makeRepo({ ...DEFAULT_CONFIG, merge: "pr" });
    await writeStoryFile(
      repo.root,
      "st-0002-b.md",
      storyText({
        id: "st-0002", title: "b", status: "in-progress",
        claim: "{session: dead, lease: 2020-01-01T00:00:00.000Z}",
      }),
    );
    const r = await runStory(repo.root, ["doctor", "--fix", "--json"]);
    expect(r.code).toBe(0);
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s.status).toBe("todo");
    expect(s.claim).toBeUndefined();
    await repo.cleanup();
  });
});
