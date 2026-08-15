import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendToSection, setSection } from "../../plugins/stories/lib/cli.mjs";
import { loadStories } from "../../plugins/stories/lib/board.mjs";
import { makeRepo, runStory, storyText, writeStoryFile } from "./helpers";

const CONFIG = { storiesDir: "stories" };

describe("appendToSection", () => {
  test("appends under the heading, before the next section, with correct blank lines", () => {
    const body = "\n## Implementation Notes\n\n## Questions\n";
    expect(appendToSection(body, "## Implementation Notes", "- t1: first")).toBe(
      "\n## Implementation Notes\n\n- t1: first\n\n## Questions\n",
    );
    const two = appendToSection(
      "\n## Implementation Notes\n\n- t1: first\n\n## Questions\n",
      "## Implementation Notes",
      "- t2: second",
    );
    expect(two).toBe("\n## Implementation Notes\n\n- t1: first\n- t2: second\n\n## Questions\n");
  });

  test("creates the section at the end when missing", () => {
    expect(appendToSection("intro\n", "## Questions", "- q1")).toBe("intro\n\n## Questions\n\n- q1\n");
  });
});

describe("setSection", () => {
  test("replaces the section body in place, leaving neighbors untouched", () => {
    const body = "\n## Description\n\nd\n\n## Implementation Plan\n\nold plan\n\n## Implementation Notes\n";
    expect(setSection(body, "## Implementation Plan", "1. step one\n2. step two")).toBe(
      "\n## Description\n\nd\n\n## Implementation Plan\n\n1. step one\n2. step two\n\n## Implementation Notes\n",
    );
  });

  test("creates the section at the end when missing", () => {
    expect(setSection("intro\n", "## Implementation Plan", "1. x")).toBe(
      "intro\n\n## Implementation Plan\n\n1. x\n",
    );
  });
});

describe("story update", () => {
  test("legal status transitions apply; illegal ones are rejected with the table's message", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "backlog" }));
    expect((await runStory(repo.root, ["update", "st-0001", "--status", "todo"])).code).toBe(0);
    expect(loadStories(repo.root, CONFIG)[0].status).toBe("todo");
    const bad = await runStory(repo.root, ["update", "st-0001", "--status", "done"]);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stderr).error).toBe("illegal transition todo → done");
    await repo.cleanup();
  });

  test("field updates: priority validated, touches/gates replaced, feedback set/cleared, updated bumped", async () => {
    const repo = await makeRepo();
    await writeStoryFile(
      repo.root,
      "st-0001-a.md",
      storyText({ id: "st-0001", title: "a", status: "in-review", updated: "2020-01-01" }),
    );
    const r = await runStory(repo.root, [
      "update", "st-0001", "--priority", "P0", "--touches", "src/**", "--feedback", "true",
    ]);
    expect(r.code).toBe(0);
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s.priority).toBe("P0");
    expect(s.touches).toEqual(["src/**"]);
    expect(s.feedback).toBe(true);
    expect(s.updated).not.toBe("2020-01-01");
    expect((await runStory(repo.root, ["update", "st-0001", "--feedback", "false"])).code).toBe(0);
    expect(loadStories(repo.root, CONFIG)[0].feedback).toBeUndefined();
    expect((await runStory(repo.root, ["update", "st-0001", "--priority", "P9"])).code).toBe(1);
    await repo.cleanup();
  });

  test("leaving in-progress (to todo OR in-review) releases the claim; staying refreshes the lease (heartbeat)", async () => {
    const repo = await makeRepo();
    await writeStoryFile(
      repo.root,
      "st-0001-a.md",
      storyText({
        id: "st-0001", title: "a", status: "in-progress",
        claim: "{session: w1, lease: 2020-01-01T00:00:00.000Z}",
      }),
    );
    expect((await runStory(repo.root, ["update", "st-0001", "--priority", "P1"])).code).toBe(0);
    const refreshed = loadStories(repo.root, CONFIG)[0];
    expect(Date.parse(refreshed.claim!.lease as string)).toBeGreaterThan(Date.parse("2021-01-01"));
    expect((await runStory(repo.root, ["update", "st-0001", "--status", "todo"])).code).toBe(0);
    expect(loadStories(repo.root, CONFIG)[0].claim).toBeUndefined();
    // Ratified decision: entering in-review ALWAYS clears the claim — ownership
    // is the branch/pr record, and computeReady needs !claim for feedback items.
    await writeStoryFile(
      repo.root,
      "st-0002-b.md",
      storyText({
        id: "st-0002", title: "b", status: "in-progress",
        claim: "{session: w1, lease: 2020-01-01T00:00:00.000Z}",
      }),
    );
    expect((await runStory(repo.root, ["update", "st-0002", "--status", "in-review"])).code).toBe(0);
    expect(loadStories(repo.root, CONFIG).find((s) => s.id === "st-0002")!.claim).toBeUndefined();
    await repo.cleanup();
  });

  test("--plan-file replaces the Implementation Plan section (repeatably), preserving the rest", async () => {
    const repo = await makeRepo();
    const body = "\n## Description\n\nd\n\n## Implementation Plan\n\n## Implementation Notes\n\n- keep me\n";
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "in-progress" }, body));
    writeFileSync(join(repo.root, "plan.md"), "1. red test\n2. green code\n");
    expect((await runStory(repo.root, ["update", "st-0001", "--plan-file", "plan.md"])).code).toBe(0);
    let s = loadStories(repo.root, CONFIG)[0];
    expect(s.body).toContain("## Implementation Plan\n\n1. red test\n2. green code\n\n## Implementation Notes");
    expect(s.body).toContain("- keep me");
    writeFileSync(join(repo.root, "plan.md"), "1. revised\n");
    expect((await runStory(repo.root, ["update", "st-0001", "--plan-file", "plan.md"])).code).toBe(0);
    s = loadStories(repo.root, CONFIG)[0];
    expect(s.body).toContain("## Implementation Plan\n\n1. revised\n\n## Implementation Notes");
    expect(s.body).not.toContain("red test");
    await repo.cleanup();
  });
});

describe("story update — complexity", () => {
  test("--complexity frontier sets it, then --complexity routine removes the line while show still reports routine", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "todo" }));
    expect((await runStory(repo.root, ["update", "st-0001", "--complexity", "frontier"])).code).toBe(0);
    let show = await runStory(repo.root, ["show", "st-0001", "--json"]);
    expect((show.json() as { complexity: string }).complexity).toBe("frontier");
    expect((await runStory(repo.root, ["update", "st-0001", "--complexity", "routine"])).code).toBe(0);
    show = await runStory(repo.root, ["show", "st-0001", "--json"]);
    expect((show.json() as { complexity: string }).complexity).toBe("routine");
    const s = loadStories(repo.root, CONFIG)[0];
    expect(readFileSync(s.file, "utf8")).not.toContain("complexity:");
    await repo.cleanup();
  });
});

describe("story note", () => {
  test("appends a timestamped note under Implementation Notes, preserving the rest verbatim", async () => {
    const repo = await makeRepo();
    const body = "\n## Description\n\nd\n\n## Acceptance Criteria\n\n- [ ] ac1\n\n## Implementation Notes\n\n## Questions\n";
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "in-progress" }, body));
    const r = await runStory(repo.root, ["note", "st-0001", "--body", "did a thing"]);
    expect(r.code).toBe(0);
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s.body).toMatch(/## Implementation Notes\n\n- \d{4}-\d{2}-\d{2}T[\d:.]+Z: did a thing\n\n## Questions/);
    expect(s.body).toContain("- [ ] ac1"); // untouched sections byte-identical
    expect((await runStory(repo.root, ["note", "st-0001"])).code).toBe(1); // --body required
    await repo.cleanup();
  });
});

describe("story park", () => {
  test("blocks the story, records the question, releases the claim", async () => {
    const repo = await makeRepo();
    await writeStoryFile(
      repo.root,
      "st-0001-a.md",
      storyText({
        id: "st-0001", title: "a", status: "in-progress",
        claim: "{session: w1, lease: 2026-07-08T00:00:00.000Z}",
      }),
    );
    const r = await runStory(repo.root, ["park", "st-0001", "--question", "REST or GraphQL?"]);
    expect(r.code).toBe(0);
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s.status).toBe("blocked");
    expect(s.claim).toBeUndefined();
    expect(s.body).toMatch(/## Questions\n\n- .*REST or GraphQL\?/s);
    // done is terminal: parking a done story is illegal
    await writeStoryFile(repo.root, "st-0002-b.md", storyText({ id: "st-0002", title: "b", status: "done" }));
    expect((await runStory(repo.root, ["park", "st-0002", "--question", "q"])).code).toBe(1);
    await repo.cleanup();
  });
});
