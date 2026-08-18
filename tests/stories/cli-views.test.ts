import { describe, expect, test } from "bun:test";
import { makeRepo, runStory, storyText, writeStoryFile } from "./helpers";

describe("story list", () => {
  test("lists id/status/priority/title; --status filters; --json omits body", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "First", status: "todo", priority: "P1" }));
    await writeStoryFile(repo.root, "st-0002-b.md", storyText({ id: "st-0002", title: "Second", status: "in-progress" }));
    const all = await runStory(repo.root, ["list", "--json"]);
    expect(all.code).toBe(0);
    const rows = all.json() as Array<Record<string, unknown>>;
    expect(rows.map((s) => s.id)).toEqual(["st-0001", "st-0002"]);
    expect(rows[0]).not.toHaveProperty("body");
    expect(rows[0]).not.toHaveProperty("file");
    const filtered = await runStory(repo.root, ["list", "--status", "in-progress", "--json"]);
    expect((filtered.json() as Array<{ id: string }>).map((s) => s.id)).toEqual(["st-0002"]);
    const human = await runStory(repo.root, ["list"]);
    expect(human.stdout).toContain("st-0001");
    expect(human.stdout).toContain("First");
    await repo.cleanup();
  });
});

describe("story board", () => {
  test("groups by status, skipping empty columns", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "todo" }));
    await writeStoryFile(repo.root, "st-0002-b.md", storyText({ id: "st-0002", title: "b", status: "blocked" }));
    const r = await runStory(repo.root, ["board", "--json"]);
    expect(r.code).toBe(0);
    const cols = r.json() as Record<string, Array<{ id: string }>>;
    expect(cols.todo.map((s) => s.id)).toEqual(["st-0001"]);
    expect(cols.blocked.map((s) => s.id)).toEqual(["st-0002"]);
    expect(cols["in-progress"]).toEqual([]);
    const human = await runStory(repo.root, ["board"]);
    expect(human.stdout).toContain("todo (1)");
    expect(human.stdout).toContain("blocked (1)");
    expect(human.stdout).not.toContain("in-progress (0)");
    await repo.cleanup();
  });
});

describe("story show", () => {
  test("prints the full story (frontmatter + body); --json structures it; finds archived stories", async () => {
    const repo = await makeRepo();
    const body = "\n## Description\n\ndetail here\n\n## Acceptance Criteria\n\n- [ ] ac1\n";
    await writeStoryFile(repo.root, "archive/st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "done" }, body));
    const r = await runStory(repo.root, ["show", "st-0001", "--json"]);
    expect(r.code).toBe(0);
    const s = r.json() as Record<string, unknown>;
    expect(s.id).toBe("st-0001");
    expect(s.body).toContain("- [ ] ac1");
    const human = await runStory(repo.root, ["show", "st-0001"]);
    expect(human.stdout).toContain("id: st-0001");
    expect(human.stdout).toContain("detail here");
    expect((await runStory(repo.root, ["show", "st-nope"])).code).toBe(1);
    expect((await runStory(repo.root, ["show"])).code).toBe(1);
    await repo.cleanup();
  });

  test("human view prints a state header ahead of the raw file", async () => {
    const repo = await makeRepo();
    const created = await runStory(repo.root, ["create", "--title", "b"]);
    expect(created.code).toBe(0);
    const human = await runStory(repo.root, ["show", created.stdout.trim()]);
    expect(human.stdout).toContain("status: todo");
    await repo.cleanup();
  });
});
