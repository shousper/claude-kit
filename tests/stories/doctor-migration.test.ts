import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GITIGNORE_BLOCK, WORKTREES_DIR, configPath, evidenceRoot, legacyConfigPath, stateDir } from "../../shared/stories/lib/util.mjs";
import { makeRepo, runStory, storyText, writeStoryFile } from "./helpers";

const LEGACY_IGNORE = `${WORKTREES_DIR}/\n.claude/*.local.*\n.claude/locks/\n.claude/story-evidence/\n`;

/** Turns a fresh repo into the pre-split .claude/ layout. */
async function legacyRepo() {
  const repo = await makeRepo();
  await rm(join(repo.root, ".agents"), { recursive: true });
  const c = join(repo.root, ".claude");
  await mkdir(join(c, "story-evidence", "st-a1b2"), { recursive: true });
  await mkdir(join(c, "locks"), { recursive: true });
  await mkdir(join(c, "agents"), { recursive: true });
  await writeFile(legacyConfigPath(repo.root), JSON.stringify({
    version: 1, storiesDir: "stories", merge: "self", baseBranch: "main",
    gates: { test: { kind: "command", run: "true" } }, defaults: { feature: ["test"], bug: ["test"], chore: [] },
    gateLock: true, budgets: { maxIterations: 10, maxFixRoundsPerStory: 3 },
  }, null, 2));
  await writeFile(join(c, "story-state.local.json"), JSON.stringify({ version: 1, stories: { "st-a1b2": { status: "todo" } } }));
  await writeFile(join(c, "story-loop.sess-1.local.md"), "---\ngoal: complete all stories\nsession_id: sess-1\niteration: 1\nmax_iterations: 10\n---\n");
  await writeFile(join(c, "story-loop.local.md"), "---\ngoal: g\niteration: 1\n---\n");
  await writeFile(join(c, "story-learnings.local.md"), "\n## 2026-01-01T00:00:00.000Z\n\nprefer bun test\n");
  await writeFile(join(c, "story-sweep.local.json"), "{}");
  await writeFile(join(c, "story-evidence", "st-a1b2", "verdict-visual.json"), "{}");
  await writeFile(join(c, "locks", "board.lock"), "{}");
  await writeFile(join(c, "agents", "art-director.md"), "# persona\n");
  await writeFile(join(repo.root, ".gitignore"), LEGACY_IGNORE);
  await writeStoryFile(repo.root, "st-a1b2-sample.md", storyText({ id: "st-a1b2", title: "Sample", type: "feature", priority: "P2", depends_on: "[]", touches: "[]", created: "2026-07-08", updated: "2026-07-08" }));
  return repo;
}

describe("story doctor: layout migration", () => {
  it("refuses other commands on the legacy layout, and init too", async () => {
    const repo = await legacyRepo();
    const ready = await runStory(repo.root, ["ready"]);
    expect(ready.code).toBe(1);
    expect(JSON.parse(ready.stderr).error).toMatch(/legacy layout .*story doctor/);
    const init = await runStory(repo.root, ["init"]);
    expect(init.code).toBe(1);
    expect(JSON.parse(init.stderr).error).toMatch(/legacy layout/);
    await repo.cleanup();
  });

  it("moves every file to .agents/shousper-stories/, rewrites the ignore block and the budget key, and is idempotent", async () => {
    const repo = await legacyRepo();
    const r = await runStory(repo.root, ["doctor", "--json"]);
    expect(r.code).toBe(0);
    const report = r.json() as { fixed: Array<Record<string, unknown>> };
    expect(report.fixed[0]).toMatchObject({ kind: "layout-migrated", gitignore: "rewritten" });
    expect(report.fixed[0].personas).toMatch(/\.claude\/agents/);
    const s = stateDir(repo.root);
    const config = JSON.parse(readFileSync(join(s, "config.json"), "utf8"));
    expect(config.budgets).toEqual({ maxStalls: 3, maxFixRoundsPerStory: 3 });
    expect(JSON.parse(readFileSync(join(s, "local", "state.json"), "utf8")).stories["st-a1b2"].status).toBe("todo");
    expect(existsSync(join(s, "local", "loop.sess-1.md"))).toBe(true);
    expect(readFileSync(join(s, "local", "learnings.md"), "utf8")).toContain("prefer bun test");
    expect(existsSync(join(s, "local", "sweep.json"))).toBe(true);
    expect(existsSync(join(s, "local", "evidence", "st-a1b2", "verdict-visual.json"))).toBe(true);
    expect(readFileSync(join(repo.root, ".gitignore"), "utf8")).toBe(GITIGNORE_BLOCK);
    for (const gone of ["story-workflow.json", "story-state.local.json", "story-loop.sess-1.local.md", "story-loop.local.md", "story-learnings.local.md", "story-sweep.local.json", "story-evidence", "locks"]) {
      expect(existsSync(join(repo.root, ".claude", gone)), gone).toBe(false);
    }
    expect(existsSync(join(repo.root, ".claude", "agents", "art-director.md"))).toBe(true); // never moved

    const again = await runStory(repo.root, ["doctor", "--json"]);
    expect((again.json() as { fixed: unknown[] }).fixed).toEqual([]);
    const ready = await runStory(repo.root, ["ready", "--json"]);
    expect((ready.json() as Array<{ id: string }>).map((x) => x.id)).toEqual(["st-a1b2"]);
    await repo.cleanup();
  });

  it("resumes after an interrupted migration: the marker flips only once every file has moved", async () => {
    const repo = await legacyRepo();
    // A non-empty directory already at the evidence destination makes that
    // rename fail part-way through the move (state.json has moved, evidence has not).
    const blocker = join(evidenceRoot(repo.root), "stray");
    await mkdir(blocker, { recursive: true });
    await writeFile(join(blocker, "x.json"), "{}");
    await expect(runStory(repo.root, ["doctor", "--json"])).rejects.toThrow(/ENOTEMPTY/);
    expect(existsSync(join(repo.root, ".claude", "story-workflow.json"))).toBe(true);
    expect(existsSync(configPath(repo.root))).toBe(false);
    expect(existsSync(join(repo.root, ".claude", "story-evidence", "st-a1b2", "verdict-visual.json"))).toBe(true);

    await rm(evidenceRoot(repo.root), { recursive: true });
    const second = await runStory(repo.root, ["doctor", "--json"]);
    expect(second.code).toBe(0);
    const report = second.json() as { fixed: Array<{ kind: string }> };
    expect(report.fixed[0].kind).toBe("layout-migrated");
    const s = stateDir(repo.root);
    expect(JSON.parse(readFileSync(join(s, "local", "state.json"), "utf8")).stories["st-a1b2"].status).toBe("todo");
    expect(existsSync(join(s, "local", "evidence", "st-a1b2", "verdict-visual.json"))).toBe(true);
    expect(existsSync(join(repo.root, ".claude", "story-workflow.json"))).toBe(false);
    await repo.cleanup();
  });

  it("finishes a migration that died between writing the new config and removing the legacy marker", async () => {
    const repo = await legacyRepo();
    const s = stateDir(repo.root);
    // Simulate the half-flipped state: new config on disk (hand-edited since), legacy marker still present.
    await mkdir(join(s, "local"), { recursive: true });
    await writeFile(join(s, "config.json"), JSON.stringify({ version: 1, storiesDir: "stories", merge: "self", baseBranch: "main", gates: {}, defaults: {}, budgets: { maxStalls: 7, maxFixRoundsPerStory: 3 }, edited: true }, null, 2));
    const r = await runStory(repo.root, ["doctor", "--json"]);
    expect(r.code).toBe(0);
    const report = r.json() as { fixed: Array<{ kind: string; gitignore: string }> };
    expect(report.fixed[0]).toMatchObject({ kind: "layout-migrated", gitignore: "rewritten" });
    expect(existsSync(join(repo.root, ".claude", "story-workflow.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(s, "config.json"), "utf8")).budgets.maxStalls).toBe(7); // the newer config wins
    expect(JSON.parse(readFileSync(join(s, "local", "state.json"), "utf8")).stories["st-a1b2"].status).toBe("todo");
    expect((await runStory(repo.root, ["doctor", "--json"])).json()).toMatchObject({ fixed: [] });
    await repo.cleanup();
  });

  it("appends only the missing ignore lines when the old block is not present verbatim", async () => {
    const repo = await legacyRepo();
    await writeFile(join(repo.root, ".gitignore"), `node_modules/\n${WORKTREES_DIR}/\n`);
    const r = await runStory(repo.root, ["doctor", "--json"]);
    expect((r.json() as { fixed: Array<{ gitignore: string }> }).fixed[0].gitignore).toBe("appended");
    expect(readFileSync(join(repo.root, ".gitignore"), "utf8")).toBe(`node_modules/\n${GITIGNORE_BLOCK}`);
    await repo.cleanup();
  });
});
