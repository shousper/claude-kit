import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadStories } from "../../plugins/stories/lib/board.mjs";
import { makeRepo, runStory, storyText, writeStoryFile } from "./helpers";

const CONFIG = { storiesDir: "stories" };

describe("story create", () => {
  test("files a story with defaults and prints the id", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, ["create", "--title", "First story", "--json"]);
    expect(r.code).toBe(0);
    const { id, file } = r.json() as { id: string; file: string };
    expect(id).toMatch(/^st-[0-9a-f]{4}$/);
    expect(file).toBe(join(repo.root, "stories", `${id}-first-story.md`));
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s).toMatchObject({
      id, title: "First story", type: "feature", status: "todo",
      priority: "P2", depends_on: [], touches: [], exclusive: false,
    });
    expect(s.body).toContain("## Acceptance Criteria");
    await repo.cleanup();
  });

  test("accepts type, priority, epic, glob touches, gates, --exclusive, --backlog", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, [
      "create", "--title", "Sweeping refactor", "--type", "chore", "--priority", "P0",
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
    const r = await runStory(repo.root, ["create", "--title", "x", "--depends-on", "st-dead"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).error).toMatch(/no story 'st-dead'/);
    await repo.cleanup();
  });

  test("--gates must name gates defined in config", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, ["create", "--title", "x", "--gates", "e2e"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).error).toMatch(/unknown gate 'e2e'/);
    await repo.cleanup();
  });

  test("--title is required; colon titles survive the round trip", async () => {
    const repo = await makeRepo();
    expect((await runStory(repo.root, ["create"])).code).toBe(1);
    const r = await runStory(repo.root, ["create", "--title", "fix: the [thing]", "--json"]);
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
    const r = await runStory(repo.root, ["create", "--title", "x", "--complexity", "hard", "--json"]);
    expect(r.code).toBe(0);
    const { id, file } = r.json() as { id: string; file: string };
    const show = await runStory(repo.root, ["show", id, "--json"]);
    expect((show.json() as { complexity: string }).complexity).toBe("hard");
    expect(readFileSync(file, "utf8")).toMatch(/^complexity: hard$/m);
    await repo.cleanup();
  });

  test("omitting --complexity defaults to routine and is not written to the file", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, ["create", "--title", "x", "--json"]);
    expect(r.code).toBe(0);
    const { id, file } = r.json() as { id: string; file: string };
    const show = await runStory(repo.root, ["show", id, "--json"]);
    expect((show.json() as { complexity: string }).complexity).toBe("routine");
    expect(readFileSync(file, "utf8")).not.toContain("complexity:");
    await repo.cleanup();
  });

  test("--complexity extreme is rejected with the legal list", async () => {
    const repo = await makeRepo();
    const r = await runStory(repo.root, ["create", "--title", "x", "--complexity", "extreme"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/routine/);
    expect(r.stderr).toMatch(/frontier/);
    await repo.cleanup();
  });
});
