import { describe, it, expect } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeLoopState } from "../../shared/stories/lib/loop.mjs";
import { configPath, legacyConfigPath } from "../../shared/stories/lib/util.mjs";
import { makeRepo, runStory, storyText, writeStoryFile } from "./helpers";

const READY_STORY = storyText({ id: "st-a1b2", title: "Sample ready story", type: "feature", priority: "P2", depends_on: "[]", touches: "[]", created: "2026-07-08", updated: "2026-07-08" });

describe("story context", () => {
  it("prints the CLI path, the using-stories rules, the ready set, and the loop status", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-a1b2-sample.md", READY_STORY);
    writeLoopState(repo.root, { goal: "complete all stories", session_id: "sess-1", iteration: 2, stalls: 0, max_stalls: 3, attempts: {} });
    const r = await runStory(repo.root, ["context"], { env: { STORY_BIN: "/opt/plugins/stories/bin/story" } });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("stories workflow");
    expect(r.stdout).toContain("The story CLI is at: /opt/plugins/stories/bin/story");
    expect(r.stdout).toContain("# Using Stories");
    expect(r.stdout).toContain("st-a1b2");
    expect(r.stdout).toContain("story loop status --json");
    expect(r.stdout).toContain('"session_id":"sess-1"');
    await repo.cleanup();
  });

  it("--json carries cli, rules, ready, and loop", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-a1b2-sample.md", READY_STORY);
    const r = await runStory(repo.root, ["context", "--json"]);
    const out = r.json() as { cli: string; rules: string; ready: Array<{ id: string }>; loop: { active: boolean } };
    expect(typeof out.cli).toBe("string");
    expect(out.rules).toContain("# Using Stories");
    expect(out.ready.map((s) => s.id)).toEqual(["st-a1b2"]);
    expect(out.loop).toEqual({ active: false, loops: [] });
    await repo.cleanup();
  });

  it("with a malformed config.json still exits 0, keeps the rules, and surfaces the doctor hint", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-a1b2-sample.md", READY_STORY);
    await writeFile(configPath(repo.root), "{ not json");
    const r = await runStory(repo.root, ["context", "--json"]);
    expect(r.code).toBe(0);
    const out = r.json() as { rules: string; ready: { error: string }; loop: { active: boolean } };
    expect(out.rules).toContain("# Using Stories");
    expect(out.ready.error).toMatch(/run story doctor/);
    expect(out.loop).toEqual({ active: false });
    await repo.cleanup();
  });

  it("on the legacy layout prints the migration notice instead of the board", async () => {
    const repo = await makeRepo();
    await mkdir(join(repo.root, ".claude"), { recursive: true });
    await writeFile(legacyConfigPath(repo.root), "{}");
    await rm(join(repo.root, ".agents"), { recursive: true });
    const r = await runStory(repo.root, ["context", "--json"]);
    expect(r.code).toBe(0);
    const out = r.json() as { legacy: boolean; notice: string; ready: unknown };
    expect(out.legacy).toBe(true);
    expect(out.notice).toMatch(/story doctor/);
    expect(out.ready).toBeNull();
    await repo.cleanup();
  });
});
