import { describe, expect, test, afterEach } from "bun:test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, DEFAULT_CONFIG, STORIES_LIB, type Repo } from "./helpers";

const board = await import(join(STORIES_LIB, "board.mjs"));

let repo: Repo;
afterEach(() => repo?.cleanup());

const STATE_PATH = (root: string) => join(root, ".claude", "story-state.local.json");

function writeStoryFile(root: string, name: string, frontmatter: string, body = "\n## Description\n") {
  writeFileSync(join(root, "stories", name), `---\n${frontmatter}\n---\n${body}`);
}

describe("state store io", () => {
  test("readStateStore returns empty store when file is absent", async () => {
    repo = await makeRepo();
    expect(board.readStateStore(repo.root)).toEqual({ version: 1, stories: {} });
  });

  test("writeStateStore round-trips atomically", async () => {
    repo = await makeRepo();
    board.writeStateStore(repo.root, { version: 1, stories: { "st-aaaa": { status: "todo" } } });
    expect(board.readStateStore(repo.root).stories["st-aaaa"].status).toBe("todo");
    expect(existsSync(STATE_PATH(repo.root))).toBe(true);
  });

  test("readStateStore throws CliError on corrupt JSON", async () => {
    repo = await makeRepo();
    writeFileSync(STATE_PATH(repo.root), "{nope");
    expect(() => board.readStateStore(repo.root)).toThrow(/corrupt story state/);
  });
});

describe("loadStories overlay", () => {
  test("store state wins over frontmatter state", async () => {
    repo = await makeRepo();
    writeStoryFile(repo.root, "st-aaaa-x.md", "id: st-aaaa\ntitle: X\nstatus: todo");
    board.writeStateStore(repo.root, {
      version: 1,
      stories: { "st-aaaa": { status: "in-progress", claim: { session: "s1", lease: "2026-08-18T00:00:00Z" } } },
    });
    const [s] = board.loadStories(repo.root, DEFAULT_CONFIG);
    expect(s.status).toBe("in-progress");
    expect(s.claim.session).toBe("s1");
  });

  test("frontmatter state is the fallback for unmigrated stories", async () => {
    repo = await makeRepo();
    writeStoryFile(repo.root, "st-bbbb-y.md", "id: st-bbbb\ntitle: Y\nstatus: blocked");
    const [s] = board.loadStories(repo.root, DEFAULT_CONFIG);
    expect(s.status).toBe("blocked");
  });

  test("a story with state in neither place defaults to todo", async () => {
    repo = await makeRepo();
    writeStoryFile(repo.root, "st-cccc-z.md", "id: st-cccc\ntitle: Z");
    const [s] = board.loadStories(repo.root, DEFAULT_CONFIG);
    expect(s.status).toBe("todo");
  });
});

describe("saveStory state split", () => {
  test("state fields go to the store, never to the .md file", async () => {
    repo = await makeRepo();
    const story = board.applyDefaults({
      id: "st-dddd", title: "Split", status: "in-progress",
      claim: { session: "s9", lease: "2026-08-18T00:00:00Z" },
    });
    const saved = board.saveStory(repo.root, DEFAULT_CONFIG, story);
    const raw = readFileSync(saved.file, "utf8");
    expect(raw).not.toContain("status:");
    expect(raw).not.toContain("claim:");
    const store = board.readStateStore(repo.root);
    expect(store.stories["st-dddd"]).toEqual({
      status: "in-progress", claim: { session: "s9", lease: "2026-08-18T00:00:00Z" },
    });
  });

  test("round trip: saveStory then loadStories reproduces state", async () => {
    repo = await makeRepo();
    board.saveStory(repo.root, DEFAULT_CONFIG, board.applyDefaults({ id: "st-eeee", title: "RT", status: "todo" }));
    const [s] = board.loadStories(repo.root, DEFAULT_CONFIG);
    expect(s.status).toBe("todo");
  });

  test("clearing a field (delete s.claim) removes it from the store", async () => {
    repo = await makeRepo();
    const s = board.applyDefaults({ id: "st-ffff", title: "Clear", status: "in-progress", claim: { session: "x", lease: "2026-08-18T00:00:00Z" } });
    board.saveStory(repo.root, DEFAULT_CONFIG, s);
    delete s.claim;
    board.saveStory(repo.root, DEFAULT_CONFIG, { ...s, status: "done" });
    expect(board.readStateStore(repo.root).stories["st-ffff"]).toEqual({ status: "done" });
  });
});
