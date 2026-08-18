import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getStory,
  loadStories,
  mutateStory,
  saveStory,
  slugify,
  storiesDir,
} from "../../plugins/stories/lib/board.mjs";
import { makeRepo, storyText, writeStoryFile } from "./helpers";

const CONFIG = { storiesDir: "stories" };

describe("slugify", () => {
  test("lowercases, dashes, trims, caps at 40 chars", () => {
    expect(slugify("Add ×N Multiplier Gates!")).toBe("add-n-multiplier-gates");
    expect(slugify("---")).toBe("story");
    expect(slugify("x".repeat(60)).length).toBe(40);
  });
});

describe("loadStories / saveStory", () => {
  test("loads stories, skips _templates and the archive dir by default", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-one.md", storyText({ id: "st-0001", title: "one", status: "todo" }));
    await writeStoryFile(repo.root, "_TEMPLATE.md", "not a story");
    await writeStoryFile(
      repo.root,
      "archive/st-00aa-old.md",
      storyText({ id: "st-00aa", title: "old", status: "done" }),
    );
    const active = loadStories(repo.root, CONFIG);
    expect(active.map((s) => s.id)).toEqual(["st-0001"]);
    expect(active[0].file).toBe(join(storiesDir(repo.root, CONFIG), "st-0001-one.md"));
    const all = loadStories(repo.root, CONFIG, { includeArchive: true });
    expect(all.map((s) => s.id).sort()).toEqual(["st-0001", "st-00aa"].sort());
    await repo.cleanup();
  });

  test("saveStory names new files <id>-<slug>.md and round-trips", async () => {
    const repo = await makeRepo();
    const saved = saveStory(repo.root, CONFIG, {
      id: "st-b0b0",
      title: "Fix the Thing",
      status: "todo",
      body: "\n## Description\n\nx\n",
    });
    expect(saved.file).toBe(join(repo.root, "stories", "st-b0b0-fix-the-thing.md"));
    expect(readFileSync(saved.file, "utf8")).toContain("id: st-b0b0");
    expect(loadStories(repo.root, CONFIG)[0].title).toBe("Fix the Thing");
    await repo.cleanup();
  });

  test("skips a story whose id has traversal segments (never returns it for a path builder)", async () => {
    const repo = await makeRepo();
    // A story file that arrived via a branch/PR/clone carrying a hostile id.
    await writeStoryFile(
      repo.root,
      "evil.md",
      storyText({ id: '"../../../../tmp/evil"', title: "evil", status: "in-progress" }),
    );
    await writeStoryFile(repo.root, "st-0001-ok.md", storyText({ id: "st-0001", title: "ok", status: "todo" }));
    const loaded = loadStories(repo.root, CONFIG);
    // The malformed id is dropped; only the well-formed story survives, so its
    // id can never flow into worktreePath/evidenceDir/branchName downstream.
    expect(loaded.map((s) => s.id)).toEqual(["st-0001"]);
    await repo.cleanup();
  });

  test("saveStory reuses story.file when present (no rename on update)", async () => {
    const repo = await makeRepo();
    const file = await writeStoryFile(repo.root, "st-0001-one.md", storyText({ id: "st-0001", title: "one", status: "todo" }));
    const loaded = loadStories(repo.root, CONFIG)[0];
    const saved = saveStory(repo.root, CONFIG, { ...loaded, status: "in-progress" });
    expect(saved.file).toBe(file);
    expect(loadStories(repo.root, CONFIG)[0].status).toBe("in-progress");
    await repo.cleanup();
  });

  test("getStory throws for unknown id", async () => {
    expect(() => getStory([], "st-9999")).toThrow(/no story 'st-9999'/);
  });

  test("getStory throws for a malformed (non-hex) id before it can reach a path builder", async () => {
    expect(() => getStory([], "st-nope")).toThrow(/invalid story id 'st-nope'/);
    expect(() => getStory([], "../../../tmp/evil")).toThrow(/invalid story id/);
  });
});

describe("mutateStory (shared lock+load+copy+stamp+save skeleton)", () => {
  test("stamps updated and, with heartbeat, refreshes claim.lease", async () => {
    const repo = await makeRepo();
    await writeStoryFile(
      repo.root,
      "st-0001-one.md",
      storyText({
        id: "st-0001",
        title: "one",
        status: "in-progress",
        claim: "{session: sess-1, lease: 2000-01-01T00:00:00.000Z}",
        updated: "2000-01-01",
      }),
    );
    const saved = await mutateStory(repo.root, CONFIG, "st-0001", (s) => {
      s.title = "renamed";
    }, { heartbeat: true });
    expect(saved.title).toBe("renamed");
    expect(saved.updated).not.toBe("2000-01-01"); // stamped today
    expect(saved.claim.lease).not.toBe("2000-01-01T00:00:00.000Z"); // heartbeat refreshed
    await repo.cleanup();
  });

  test("without heartbeat, leaves claim.lease untouched (sweep mutations are not heartbeats)", async () => {
    const repo = await makeRepo();
    await writeStoryFile(
      repo.root,
      "st-0002-two.md",
      storyText({
        id: "st-0002",
        title: "two",
        status: "in-review",
        claim: "{session: sess-1, lease: 2000-01-01T00:00:00.000Z}",
        updated: "2000-01-01",
      }),
    );
    const saved = await mutateStory(repo.root, CONFIG, "st-0002", (s) => {
      s.status = "in-review";
    });
    expect(saved.updated).not.toBe("2000-01-01"); // still stamps updated
    expect(saved.claim.lease).toBe("2000-01-01T00:00:00.000Z"); // NOT refreshed
    await repo.cleanup();
  });

  test("fn may return a replacement story instead of mutating in place", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0003-three.md", storyText({ id: "st-0003", title: "three", status: "todo" }));
    const saved = await mutateStory(repo.root, CONFIG, "st-0003", (s) => ({ ...s, status: "backlog" }));
    expect(saved.status).toBe("backlog");
    expect(loadStories(repo.root, CONFIG)[0].status).toBe("backlog");
    await repo.cleanup();
  });
});
