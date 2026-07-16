import { describe, expect, test } from "bun:test";
import { computeReady, loadStories } from "../../plugins/stories/lib/board.mjs";
import { loadConfig } from "../../plugins/stories/lib/cli.mjs";
import { makePrRepo, writeStory } from "./gh-helpers.ts";

describe("computeReady with pr-mode stories (pins B12/B13 behavior)", () => {
  test("in-review feedback stories rank before todo stories regardless of priority", async () => {
    const root = await makePrRepo();
    await writeStory(root, [
      "id: st-feed",
      "title: Address review",
      "type: feature",
      "status: in-review",
      "priority: P3",
      "feedback: true",
      "pr: {number: 12, lastSync: 2026-07-08T12:00:00Z, syncAttempts: 0}",
      "created: 2026-07-08",
      "updated: 2026-07-08",
    ]);
    await writeStory(root, [
      "id: st-4ee1",
      "title: Fresh work",
      "type: feature",
      "status: todo",
      "priority: P0",
      "touches: [other/**]",
      "created: 2026-07-08",
      "updated: 2026-07-08",
    ]);
    const ready = computeReady(loadStories(root, loadConfig(root)), {});
    expect(ready[0].id).toBe("st-feed");
    expect(ready.map((s: { id: string }) => s.id)).toContain("st-4ee1");
  });

  test("in-review stories without the feedback flag are not ready", async () => {
    const root = await makePrRepo();
    await writeStory(root, [
      "id: st-a417",
      "title: Awaiting review",
      "type: feature",
      "status: in-review",
      "priority: P0",
      "pr: {number: 13, lastSync: 2026-07-08T12:00:00Z, syncAttempts: 0}",
      "created: 2026-07-08",
      "updated: 2026-07-08",
    ]);
    const ready = computeReady(loadStories(root, loadConfig(root)), {});
    expect(ready.map((s: { id: string }) => s.id)).not.toContain("st-a417");
  });
});
