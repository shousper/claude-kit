import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, storyText } from "./helpers";

describe("makeRepo", () => {
  test("creates an isolated git repo with marker config and stories scaffold", async () => {
    const repo = await makeRepo();
    expect(existsSync(join(repo.root, ".git"))).toBe(true);
    expect(existsSync(join(repo.root, ".claude/story-workflow.json"))).toBe(true);
    expect(existsSync(join(repo.root, "stories/archive"))).toBe(true);
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
    expect(repo.root).toBe(await import("node:fs/promises").then((fs) => fs.realpath(repo.root)));
    await repo.cleanup();
  });

  test("storyText renders frontmatter + body", () => {
    expect(storyText({ id: "st-0001", title: "x" }, "body\n")).toBe(
      "---\nid: st-0001\ntitle: x\n---\nbody\n",
    );
  });
});
