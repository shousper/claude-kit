import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { classifyGuard, projectRelative, toolClass } from "../../shared/stories/lib/guard.mjs";
import { writeLoopState } from "../../shared/stories/lib/loop.mjs";
import { EXIT, LOCAL_DIR, STATE_DIR, WORKTREES_DIR } from "../../shared/stories/lib/util.mjs";
import { worktreePath } from "../../shared/stories/lib/worktrees.mjs";
import { DEFAULT_CONFIG, makeRepo, runStory } from "./helpers";

const loop = (root: string, session = "sess-1") =>
  writeLoopState(root, { goal: "complete all stories", session_id: session, iteration: 0, stalls: 0, max_stalls: 3, attempts: {} });

describe("toolClass", () => {
  it("maps both harnesses' tool names onto write and ask classes, case-insensitively", () => {
    expect(toolClass("Edit")).toBe("write");
    expect(toolClass("write")).toBe("write");
    expect(toolClass("apply_patch")).toBe("write");
    expect(toolClass("ask")).toBe("ask");
    expect(toolClass("askuserquestion")).toBe("ask");
    expect(toolClass("Bash")).toBeNull();
    expect(toolClass(undefined)).toBeNull();
  });
});

describe("projectRelative", () => {
  it("normalizes absolute and ./ paths and strips a story-worktree prefix", () => {
    expect(projectRelative("/repo", "/repo/stories/a.md")).toBe("stories/a.md");
    expect(projectRelative("/repo", "./stories/a.md")).toBe("stories/a.md");
    expect(projectRelative("/repo", join(WORKTREES_DIR, "st-a1b2", "stories", "a.md"))).toBe("stories/a.md");
    expect(projectRelative("/repo", join(worktreePath("/repo", "st-a1b2"), "src", "x.ts"))).toBe("src/x.ts");
  });

  it("resolves embedded .. segments before classifying, and returns null outside the project", () => {
    expect(projectRelative("/repo", "src/../stories/a.md")).toBe("stories/a.md");
    expect(projectRelative("/repo", `foo/../${LOCAL_DIR}/state.json`)).toBe(`${LOCAL_DIR}/state.json`);
    expect(projectRelative("/repo", "/repo/src/../stories/a.md")).toBe("stories/a.md");
    expect(projectRelative("/repo", "../repo2/stories/a.md")).toBeNull();
    expect(projectRelative("/repo", "/elsewhere/stories/a.md")).toBeNull();
  });
});

describe("classifyGuard", () => {
  it("denies board writes with the per-id CLI hint, and non-story filenames with story create", async () => {
    const repo = await makeRepo();
    const denied = classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "Write", path: "stories/st-a1b2-sample.md" });
    expect(denied.allow).toBe(false);
    expect(denied.reason).toContain("story update st-a1b2");
    expect(denied.reason).toContain("story park st-a1b2");
    const created = classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "edit", path: join(repo.root, "stories/new-idea.md") });
    expect(created.reason).toContain("story create");
    await repo.cleanup();
  });

  it("honors a custom storiesDir and the board copy inside a story worktree", async () => {
    const repo = await makeRepo();
    const config = { ...DEFAULT_CONFIG, storiesDir: "backlog" };
    expect(classifyGuard(repo.root, config, { tool: "Write", path: "backlog/st-c3d4-x.md" }).allow).toBe(false);
    expect(classifyGuard(repo.root, config, { tool: "Write", path: "stories/st-c3d4-x.md" }).allow).toBe(true);
    expect(classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "Write", path: join(WORKTREES_DIR, "st-c3d4", "stories", "st-c3d4-x.md") }).allow).toBe(false);
    await repo.cleanup();
  });

  it("denies CLI-owned local state and allows config, personas, and source files", async () => {
    const repo = await makeRepo();
    const state = classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "Edit", path: join(LOCAL_DIR, "state.json") });
    expect(state.allow).toBe(false);
    expect(state.reason).toContain("story CLI");
    expect(classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "Edit", path: join(LOCAL_DIR, "evidence", "st-a1b2", "x.json") }).allow).toBe(false);
    expect(classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "Edit", path: join(STATE_DIR, "config.json") }).allow).toBe(true);
    expect(classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "Write", path: join(STATE_DIR, "personas", "api-reviewer.md") }).allow).toBe(true);
    expect(classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "Write", path: "src/index.ts" }).allow).toBe(true);
    expect(classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "Write", path: "/elsewhere/stories/x.md" }).allow).toBe(true);
    expect(classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "Write" }).allow).toBe(true);
    await repo.cleanup();
  });

  it("denies the ask class only while a loop is bound to the session", async () => {
    const repo = await makeRepo();
    expect(classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "ask", session: "sess-1" }).allow).toBe(true);
    expect(classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "ask" }).allow).toBe(true);
    loop(repo.root);
    const denied = classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "AskUserQuestion", session: "sess-1" });
    expect(denied.allow).toBe(false);
    expect(denied.reason).toContain("story park");
    expect(classifyGuard(repo.root, DEFAULT_CONFIG, { tool: "ask", session: "sess-2" }).allow).toBe(true);
    await repo.cleanup();
  });
});

describe("story guard (CLI contract)", () => {
  it("exits 2 with the reason on stdout for a denied write; --json carries allow:false", async () => {
    const repo = await makeRepo();
    const plain = await runStory(repo.root, ["guard", "--tool", "Write", "--path", "stories/st-a1b2-x.md"]);
    expect(plain.code).toBe(EXIT.DENY);
    expect(plain.stdout).toContain("story update st-a1b2");
    const json = await runStory(repo.root, ["guard", "--tool", "Write", "--path", "stories/st-a1b2-x.md", "--json"]);
    expect(json.code).toBe(EXIT.DENY);
    expect(json.json()).toMatchObject({ allow: false });
    await repo.cleanup();
  });

  it("exits 0 silently for an allowed call, and {allow:true} under --json", async () => {
    const repo = await makeRepo();
    const plain = await runStory(repo.root, ["guard", "--tool", "Write", "--path", "src/x.ts"]);
    expect(plain.code).toBe(EXIT.OK);
    expect(plain.stdout).toBe("");
    const json = await runStory(repo.root, ["guard", "--tool", "Bash", "--json"]);
    expect(json.json()).toEqual({ allow: true });
    await repo.cleanup();
  });

  it("reads the session from STORY_SESSION_ID for the ask rule", async () => {
    const repo = await makeRepo();
    loop(repo.root, "worker-1");
    const denied = await runStory(repo.root, ["guard", "--tool", "ask"], { env: { STORY_SESSION_ID: "worker-1" } });
    expect(denied.code).toBe(EXIT.DENY);
    const other = await runStory(repo.root, ["guard", "--tool", "ask"], { env: { STORY_SESSION_ID: "worker-2" } });
    expect(other.code).toBe(EXIT.OK);
    await repo.cleanup();
  });
});
