import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadStories } from "../../shared/stories/lib/board.mjs";
import { makeRepo, runStory, storyText, writeStoryFile } from "./helpers";

const CONFIG = { storiesDir: "stories" };

describe("story create", () => {
  test("files a story with defaults and prints the id", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, ["create", "--title", "First story", "--description", "d", "--ac", "a", "--json"]);
    expect(r.code).toBe(0);
    const { id, file } = r.json() as { id: string; file: string };
    expect(id).toMatch(/^st-[0-9a-f]{4}$/);
    expect(file).toBe(join(repo.root, "stories", `${id}-first-story.md`));
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s).toMatchObject({
      id, title: "First story", type: "feature", status: "todo",
      priority: "P2", depends_on: [], touches: [], exclusive: false,
    });
    expect(s.body).toContain("## Description\n\nd\n\n## Acceptance Criteria\n\n- [ ] a\n\n## Implementation Plan\n\n## Implementation Notes\n\n## Questions");
    await repo.cleanup();
  });

  test("refuses a story with no description, and a non-epic with no acceptance criterion", async () => {
    const repo = await makeRepo();
    const noDesc = await runStory(repo.root, ["create", "--title", "x", "--ac", "a"]);
    expect(noDesc.code).toBe(1);
    expect(JSON.parse(noDesc.stderr).error).toMatch(/--description/);
    const noAc = await runStory(repo.root, ["create", "--title", "x", "--description", "d"]);
    expect(noAc.code).toBe(1);
    expect(JSON.parse(noAc.stderr).error).toMatch(/--ac/);
    const epic = await runStory(repo.root, ["create", "--title", "x", "--type", "epic", "--description", "d", "--json"]);
    expect(epic.code).toBe(0);
    const multi = await runStory(repo.root, ["create", "--title", "y", "--description", "d", "--ac", "first", "--ac", "second", "--json"]);
    expect(multi.code).toBe(0);
    const s = loadStories(repo.root, CONFIG).find((x) => x.title === "y")!;
    expect(s.body).toContain("- [ ] first\n- [ ] second");
    await repo.cleanup();
  });

  test("applies the same body rule to --body-file, so a placeholder body is refused", async () => {
    const repo = await makeRepo();
    writeFileSync(join(repo.root, "empty.md"), "\n## Description\n\n## Acceptance Criteria\n\n- [ ] …\n");
    const r = await runStory(repo.root, ["create", "--title", "x", "--body-file", "empty.md"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).error).toMatch(/Description/);
    await repo.cleanup();
  });

  test("accepts type, priority, epic, glob touches, gates, --exclusive, --backlog", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, [
      "create", "--title", "Sweeping refactor", "--description", "d", "--ac", "a", "--type", "chore", "--priority", "P0",
      "--touches", "src/**,scripts/*.sh", "--gates", "test", "--exclusive", "--backlog", "--json",
    ]);
    expect(r.code).toBe(0);
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s.touches).toEqual(["src/**", "scripts/*.sh"]);
    expect(s.gates).toEqual(["test"]);
    expect(s.exclusive).toBe(true);
    expect(s.status).toBe("backlog");
    await repo.cleanup();
  });

  test("--body-file replaces the template body verbatim; --discovered-from records provenance", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-parent.md", storyText({ id: "st-0001", title: "parent", status: "in-progress" }));
    writeFileSync(join(repo.root, "body.md"), "\n## Description\n\nSpawned mid-story.\n\n## Acceptance Criteria\n\n- [ ] checkbox kept\n");
    const r = await runStory(repo.root, [
      "create", "--title", "Discovered work", "--body-file", "body.md", "--discovered-from", "st-0001", "--json",
    ]);
    expect(r.code).toBe(0);
    const s = loadStories(repo.root, CONFIG).find((x) => x.title === "Discovered work")!;
    expect(s.discovered_from).toBe("st-0001");
    expect(s.body).toBe("\n## Description\n\nSpawned mid-story.\n\n## Acceptance Criteria\n\n- [ ] checkbox kept\n");
    await repo.cleanup();
  });

  test("--depends-on must reference existing stories", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, ["create", "--title", "x", "--description", "d", "--ac", "a", "--depends-on", "st-dead"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).error).toMatch(/no story 'st-dead'/);
    await repo.cleanup();
  });

  test("--gates must name gates defined in config", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, ["create", "--title", "x", "--description", "d", "--ac", "a", "--gates", "e2e"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).error).toMatch(/unknown gate 'e2e'/);
    await repo.cleanup();
  });

  test("--title is required; colon titles survive the round trip", async () => {
    const repo = await makeRepo();
    expect((await runStory(repo.root, ["create"])).code).toBe(1);
    const r = await runStory(repo.root, ["create", "--title", "fix: the [thing]", "--description", "d", "--ac", "a", "--json"]);
    expect(r.code).toBe(0);
    const { file } = r.json() as { file: string };
    expect(readFileSync(file, "utf8")).toContain('title: "fix: the [thing]"');
    expect(loadStories(repo.root, CONFIG).some((s) => s.title === "fix: the [thing]")).toBe(true);
    await repo.cleanup();
  });
});

describe("story create — complexity", () => {
  test("--complexity hard is stored and written to the file", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, ["create", "--title", "x", "--description", "d", "--ac", "a", "--complexity", "hard", "--json"]);
    expect(r.code).toBe(0);
    const { id, file } = r.json() as { id: string; file: string };
    const show = await runStory(repo.root, ["show", id, "--json"]);
    expect((show.json() as { complexity: string }).complexity).toBe("hard");
    expect(readFileSync(file, "utf8")).toMatch(/^complexity: hard$/m);
    await repo.cleanup();
  });

  test("omitting --complexity defaults to routine and is not written to the file", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, ["create", "--title", "x", "--description", "d", "--ac", "a", "--json"]);
    expect(r.code).toBe(0);
    const { id, file } = r.json() as { id: string; file: string };
    const show = await runStory(repo.root, ["show", id, "--json"]);
    expect((show.json() as { complexity: string }).complexity).toBe("routine");
    expect(readFileSync(file, "utf8")).not.toContain("complexity:");
    await repo.cleanup();
  });

  test("--complexity extreme is rejected with the legal list", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, ["create", "--title", "x", "--description", "d", "--ac", "a", "--complexity", "extreme"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/routine/);
    expect(r.stderr).toMatch(/frontier/);
    await repo.cleanup();
  });
});
