import { describe, it, expect } from "bun:test";
import { mkdir, mkdtemp, writeFile, realpath } from "fs/promises";
import { readFileSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const STORIES_ROOT = resolve(import.meta.dir, "../../plugins/stories");
const HOOKS_DIR = join(STORIES_ROOT, "hooks");

const SAMPLE_STORY = `---
id: st-a1b2
title: Sample ready story
type: feature
status: todo
priority: P2
depends_on: []
touches: []
created: 2026-07-08
updated: 2026-07-08
---

## Description

A sample story.

## Acceptance Criteria

- [ ] bun test passes
`;

const LOOP_STATE = `---
goal: complete all stories
session_id: sess-1
iteration: 2
max_iterations: 10
---
`;

interface HookRun { exitCode: number; stdout: string; stderr: string; }

async function runHook(script: string, cwd: string, stdin: unknown): Promise<HookRun> {
  const bash = Bun.which("bash") ?? "bash";
  const proc = Bun.spawn([bash, join(HOOKS_DIR, script)], {
    cwd,
    stdin: new TextEncoder().encode(typeof stdin === "string" ? stdin : JSON.stringify(stdin)),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}

async function makeProject(opts: {
  marker?: boolean;
  storiesDir?: string;
  stories?: Record<string, string>;
  loopState?: string;
} = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "stories-hooks-")).then(realpath);
  const storiesDir = opts.storiesDir ?? "stories";
  await mkdir(join(dir, storiesDir), { recursive: true });
  if (opts.marker !== false) {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, ".claude/story-workflow.json"), JSON.stringify({
      version: 1, storiesDir, merge: "self", gates: {}, defaults: {},
      budgets: { maxIterations: 10, maxFixRoundsPerStory: 3 },
    }));
    if (opts.loopState) await writeFile(join(dir, ".claude/story-loop.sess-1.local.md"), opts.loopState);
  }
  for (const [name, content] of Object.entries(opts.stories ?? {})) {
    await writeFile(join(dir, storiesDir, name), content);
  }
  const git = (args: string[]) => Bun.spawn(["git", ...args], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
  await git(["init"]);
  await git(["config", "user.email", "t@example.com"]);
  await git(["config", "user.name", "t"]);
  return dir;
}

// Creates a story worktree off `dir` via `git worktree add` — hooks fire with
// cwd inside such worktrees, where the marker/board files are invisible to $PWD.
async function addWorktree(dir: string): Promise<string> {
  const git = (args: string[]) => Bun.spawn(["git", ...args], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
  await git(["add", "-A"]);
  await git(["commit", "-m", "init"]);
  const worktreeDir = await mkdtemp(join(tmpdir(), "stories-hooks-wt-")).then(realpath);
  await git(["worktree", "add", "--detach", worktreeDir]);
  return worktreeDir;
}

describe("guard-stories.sh", () => {
  const preToolUse = (cwd: string, filePath: string, tool = "Write") => ({
    session_id: "sess-1",
    hook_event_name: "PreToolUse",
    cwd,
    tool_name: tool,
    tool_input: { file_path: filePath, content: "hand edit" },
  });

  it("exits 0 silently when the project has no marker", async () => {
    const dir = await makeProject({ marker: false });
    const r = await runHook("guard-stories.sh", dir, preToolUse(dir, "stories/st-a1b2-sample.md"));
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("denies a Write under storiesDir, naming the exact story commands for that id", async () => {
    const dir = await makeProject();
    const r = await runHook("guard-stories.sh", dir, preToolUse(dir, "stories/st-a1b2-sample.md"));
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("story update st-a1b2");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("story note st-a1b2");
  });

  it("denies absolute paths inside the project's storiesDir", async () => {
    const dir = await makeProject();
    const r = await runHook("guard-stories.sh", dir, preToolUse(dir, join(dir, "stories/st-a1b2-sample.md"), "Edit"));
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("points non-story filenames at story create", async () => {
    const dir = await makeProject();
    const r = await runHook("guard-stories.sh", dir, preToolUse(dir, "stories/new-idea.md"));
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason).toContain("story create");
  });

  it("honors a custom storiesDir from the marker", async () => {
    const dir = await makeProject({ storiesDir: "backlog" });
    const denied = await runHook("guard-stories.sh", dir, preToolUse(dir, "backlog/st-c3d4-x.md"));
    expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    const allowed = await runHook("guard-stories.sh", dir, preToolUse(dir, "stories/st-c3d4-x.md"));
    expect(allowed.stdout.trim()).toBe("");
  });

  it("allows writes outside storiesDir", async () => {
    const dir = await makeProject();
    const r = await runHook("guard-stories.sh", dir, preToolUse(dir, "src/index.ts"));
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("denies an Edit of the CLI-owned state store, pointing at the story CLI", async () => {
    const dir = await makeProject();
    const r = await runHook("guard-stories.sh", dir, preToolUse(dir, ".claude/story-state.local.json", "Edit"));
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("story CLI");
  });
});

describe("stop-loop.sh", () => {
  const stopEvent = (cwd: string, sessionId = "sess-1") => ({
    session_id: sessionId,
    hook_event_name: "Stop",
    stop_hook_active: false,
    last_assistant_message: "done for now",
    cwd,
  });

  it("exits 0 silently when the project has no marker", async () => {
    const dir = await makeProject({ marker: false });
    const r = await runHook("stop-loop.sh", dir, stopEvent(dir));
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("emits {} when no loop is active", async () => {
    const dir = await makeProject();
    const r = await runHook("stop-loop.sh", dir, stopEvent(dir));
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({});
  });

  it("blocks with the next ready story when the owning session's loop is live", async () => {
    const dir = await makeProject({
      stories: { "st-a1b2-sample-ready-story.md": SAMPLE_STORY },
      loopState: LOOP_STATE,
    });
    const r = await runHook("stop-loop.sh", dir, stopEvent(dir));
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("st-a1b2");
    expect(out.reason).toContain("bun test passes");
    expect(out.systemMessage).toBe("story st-a1b2 · iteration 3/10");
  });

  it("lets another session stop freely (session mismatch allows)", async () => {
    const dir = await makeProject({
      stories: { "st-a1b2-sample-ready-story.md": SAMPLE_STORY },
      loopState: LOOP_STATE,
    });
    const r = await runHook("stop-loop.sh", dir, stopEvent(dir, "sess-SOMEONE-ELSE"));
    expect(JSON.parse(r.stdout)).toEqual({});
  });

  it("self-heals a corrupt loop state file and still exits 0", async () => {
    const dir = await makeProject({ loopState: "garbage" });
    const r = await runHook("stop-loop.sh", dir, stopEvent(dir));
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBeUndefined();
    expect(out.systemMessage).toMatch(/corrupt/i);
  });

  it("still blocks when cwd is a story worktree, not the main checkout", async () => {
    const dir = await makeProject({
      stories: { "st-a1b2-sample-ready-story.md": SAMPLE_STORY },
      loopState: LOOP_STATE,
    });
    const worktreeDir = await addWorktree(dir);
    const r = await runHook("stop-loop.sh", worktreeDir, stopEvent(worktreeDir));
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).not.toBe("");
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("st-a1b2");
  });
});

describe("session-start.sh", () => {
  const startEvent = (cwd: string) => ({
    session_id: "sess-1",
    hook_event_name: "SessionStart",
    source: "startup",
    cwd,
  });

  it("exits 0 silently when the project has no marker", async () => {
    const dir = await makeProject({ marker: false });
    const r = await runHook("session-start.sh", dir, startEvent(dir));
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("injects rules + ready summary + loop status as SessionStart additionalContext", async () => {
    const dir = await makeProject({
      stories: { "st-a1b2-sample-ready-story.md": SAMPLE_STORY },
      loopState: LOOP_STATE,
    });
    const r = await runHook("session-start.sh", dir, startEvent(dir));
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const ctx = out.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("stories workflow");
    expect(ctx).toContain("st-a1b2");           // from story ready --json
    expect(ctx).toContain("story loop status"); // loop-status section header
  });

  it("still injects additionalContext when cwd is a story worktree, not the main checkout", async () => {
    const dir = await makeProject({
      stories: { "st-a1b2-sample-ready-story.md": SAMPLE_STORY },
      loopState: LOOP_STATE,
    });
    const worktreeDir = await addWorktree(dir);
    const r = await runHook("session-start.sh", worktreeDir, startEvent(worktreeDir));
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).not.toBe("");
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.additionalContext).toContain("stories workflow");
  });
});

describe("hooks/hooks.json wiring", () => {
  const config = JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.json"), "utf8"));

  it("SessionStart is synchronous and covers startup|resume|clear|compact", () => {
    const [entry] = config.hooks.SessionStart;
    expect(entry.matcher).toBe("startup|resume|clear|compact");
    expect(entry.hooks[0]).toEqual({
      type: "command",
      command: "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh",
      async: false,
    });
  });

  it("Stop runs stop-loop.sh", () => {
    expect(config.hooks.Stop[0].hooks[0].command).toBe("${CLAUDE_PLUGIN_ROOT}/hooks/stop-loop.sh");
  });

  it("PreToolUse guards Edit|Write with guard-stories.sh", () => {
    const [entry] = config.hooks.PreToolUse;
    expect(entry.matcher).toBe("Edit|Write");
    expect(entry.hooks[0].command).toBe("${CLAUDE_PLUGIN_ROOT}/hooks/guard-stories.sh");
  });

  it("every hook script exists and is executable", () => {
    for (const script of ["session-start.sh", "stop-loop.sh", "guard-stories.sh"]) {
      expect(statSync(join(HOOKS_DIR, script)).mode & 0o111).toBeTruthy();
    }
  });
});
