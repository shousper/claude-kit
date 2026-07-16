import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadStories } from "../../plugins/stories/lib/board.mjs";
import { makeRepo, runStory, storyText, writeStoryFile } from "./helpers";

const CONFIG = { storiesDir: "stories" };

describe("story archive", () => {
  test("moves done stories to stories/archive/, leaves everything else", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "done" }));
    await writeStoryFile(repo.root, "st-0002-b.md", storyText({ id: "st-0002", title: "b", status: "todo" }));
    await writeStoryFile(repo.root, "st-0003-c.md", storyText({ id: "st-0003", title: "c", status: "done" }));
    const r = await runStory(repo.root, ["archive", "--json"]);
    expect(r.code).toBe(0);
    expect((r.json() as { archived: string[] }).archived.sort()).toEqual(["st-0001", "st-0003"]);
    expect(loadStories(repo.root, CONFIG).map((s) => s.id)).toEqual(["st-0002"]);
    expect(existsSync(join(repo.root, "stories/archive/st-0001-a.md"))).toBe(true);
    expect(existsSync(join(repo.root, "stories/archive/st-0003-c.md"))).toBe(true);
    // archived stories still resolve as done deps
    const all = loadStories(repo.root, CONFIG, { includeArchive: true });
    expect(all.map((s) => s.id).sort()).toEqual(["st-0001", "st-0002", "st-0003"]);
    await repo.cleanup();
  });

  test("no done stories → archives nothing, exit 0", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, ["archive", "--json"]);
    expect(r.code).toBe(0);
    expect((r.json() as { archived: string[] }).archived).toEqual([]);
    await repo.cleanup();
  });
});
