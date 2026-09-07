import { describe, it, expect } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { readFileSync, statSync } from "fs";
import { join } from "path";
import { STATE_DIR, legacyConfigPath } from "../../shared/stories/lib/util.mjs";
import { STORIES_CLAUDE_ROOT } from "../utils/paths";
import { makeTmpDir } from "./helpers";

const HOOKS_DIR = join(STORIES_CLAUDE_ROOT, "hooks");
const STATE = STATE_DIR;

const SAMPLE_STORY = `---
id: st-a1b2
title: Sample ready story
type: feature
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
stalls: 0
max_stalls: 3
---
`;

interface HookRun { exitCode: number; stdout: string; stderr: string }

async function runHook(script: string, cwd: string, stdin: unknown): Promise<HookRun> {
  const bash = Bun.which("bash") ?? "bash";
  const proc = Bun.spawn([bash, join(HOOKS_DIR, script)], {
    cwd,
    stdin: new TextEncoder().encode(typeof stdin === "string" ? stdin : JSON.stringify(stdin)),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
}

async function makeProject(opts: { marker?: boolean | "legacy"; storiesDir?: string; stories?: Record<string, string>; loopState?: string } = {}): Promise<string> {
  const dir = await makeTmpDir("stories-hooks-");
  const storiesDir = opts.storiesDir ?? "stories";
  await mkdir(join(dir, storiesDir), { recursive: true });
  const config = JSON.stringify({ version: 1, storiesDir, merge: "self", gates: {}, defaults: {}, budgets: { maxStalls: 3, maxFixRoundsPerStory: 3 } });
  if (opts.marker === "legacy") {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(legacyConfigPath(dir), config);
  } else if (opts.marker !== false) {
    await mkdir(join(dir, STATE, "local"), { recursive: true });
    await writeFile(join(dir, STATE, "config.json"), config);
    if (opts.loopState) await writeFile(join(dir, STATE, "local/loop.sess-1.md"), opts.loopState);
  }
  for (const [name, content] of Object.entries(opts.stories ?? {})) await writeFile(join(dir, storiesDir, name), content);
  const git = (args: string[]) => Bun.spawn(["git", ...args], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
  await git(["init"]);
  await git(["config", "user.email", "t@example.com"]);
  await git(["config", "user.name", "t"]);
  return dir;
}

async function addWorktree(dir: string): Promise<string> {
  const git = (args: string[]) => Bun.spawn(["git", ...args], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
  await git(["add", "-A"]);
  await git(["commit", "-m", "init"]);
  const worktreeDir = await makeTmpDir("stories-hooks-wt-");
  await git(["worktree", "add", "--detach", worktreeDir]);
  return worktreeDir;
}

const preToolUse = (cwd: string, tool: string, tool_input: Record<string, unknown>, session_id = "sess-1") =>
  ({ session_id, hook_event_name: "PreToolUse", cwd, tool_name: tool, tool_input });
const deny = (r: HookRun) => JSON.parse(r.stdout).hookSpecificOutput;

describe("guard.sh", () => {
  it("exits 0 silently when the project has no marker", async () => {
    const dir = await makeProject({ marker: false });
    const r = await runHook("guard.sh", dir, preToolUse(dir, "Write", { file_path: "stories/st-a1b2-sample.md", content: "x" }));
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("denies a Write under storiesDir, naming the exact story commands for that id", async () => {
    const dir = await makeProject();
    const r = await runHook("guard.sh", dir, preToolUse(dir, "Write", { file_path: "stories/st-a1b2-sample.md", content: "x" }));
    expect(r.exitCode).toBe(0);
    const out = deny(r);
    expect(out.hookEventName).toBe("PreToolUse");
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain("story update st-a1b2");
  });

  it("denies absolute paths inside storiesDir and points non-story filenames at story create", async () => {
    const dir = await makeProject();
    expect(deny(await runHook("guard.sh", dir, preToolUse(dir, "Edit", { file_path: join(dir, "stories/st-a1b2-sample.md") }))).permissionDecision).toBe("deny");
    expect(deny(await runHook("guard.sh", dir, preToolUse(dir, "Write", { file_path: "stories/new-idea.md" }))).permissionDecisionReason).toContain("story create");
  });

  it("honors a custom storiesDir and allows writes elsewhere", async () => {
    const dir = await makeProject({ storiesDir: "backlog" });
    expect(deny(await runHook("guard.sh", dir, preToolUse(dir, "Write", { file_path: "backlog/st-c3d4-x.md" }))).permissionDecision).toBe("deny");
    expect((await runHook("guard.sh", dir, preToolUse(dir, "Write", { file_path: "stories/st-c3d4-x.md" }))).stdout.trim()).toBe("");
    expect((await runHook("guard.sh", dir, preToolUse(dir, "Write", { file_path: "src/index.ts" }))).stdout.trim()).toBe("");
  });

  it("denies an Edit of the CLI-owned local state", async () => {
    const dir = await makeProject();
    const out = deny(await runHook("guard.sh", dir, preToolUse(dir, "Edit", { file_path: `${STATE}/local/state.json` })));
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain("story CLI");
  });

  it("reads NotebookEdit's notebook_path and resolves embedded .. segments", async () => {
    const dir = await makeProject();
    expect(deny(await runHook("guard.sh", dir, preToolUse(dir, "NotebookEdit", { notebook_path: "stories/st-a1b2-notes.ipynb" }))).permissionDecision).toBe("deny");
    expect(deny(await runHook("guard.sh", dir, preToolUse(dir, "Write", { file_path: "src/../stories/st-a1b2-sample.md" }))).permissionDecision).toBe("deny");
  });

  it("denies AskUserQuestion only while this session's loop is bound", async () => {
    const dir = await makeProject({ loopState: LOOP_STATE });
    const bound = await runHook("guard.sh", dir, preToolUse(dir, "AskUserQuestion", { questions: [] }, "sess-1"));
    expect(deny(bound).permissionDecisionReason).toContain("story park");
    const other = await runHook("guard.sh", dir, preToolUse(dir, "AskUserQuestion", { questions: [] }, "sess-2"));
    expect(other.stdout.trim()).toBe("");
  });
});

describe("stop-loop.sh", () => {
  const stopEvent = (cwd: string, sessionId = "sess-1") => ({ session_id: sessionId, hook_event_name: "Stop", stop_hook_active: false, cwd });

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
    const dir = await makeProject({ stories: { "st-a1b2-sample-ready-story.md": SAMPLE_STORY }, loopState: LOOP_STATE });
    const r = await runHook("stop-loop.sh", dir, stopEvent(dir));
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("st-a1b2");
    expect(out.reason).toContain("bun test passes");
    expect(out.systemMessage).toBe("story st-a1b2 · iteration 3 · stalls 0/3");
  });

  it("lets another session stop freely (session mismatch allows)", async () => {
    const dir = await makeProject({ stories: { "st-a1b2-sample-ready-story.md": SAMPLE_STORY }, loopState: LOOP_STATE });
    expect(JSON.parse((await runHook("stop-loop.sh", dir, stopEvent(dir, "sess-SOMEONE-ELSE"))).stdout)).toEqual({});
  });

  it("self-heals a corrupt loop state file into a systemMessage and still exits 0", async () => {
    const dir = await makeProject({ loopState: "garbage" });
    const r = await runHook("stop-loop.sh", dir, stopEvent(dir));
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBeUndefined();
    expect(out.systemMessage).toMatch(/corrupt/i);
  });

  it("emits {} on the legacy layout instead of failing", async () => {
    const dir = await makeProject({ marker: "legacy" });
    expect(JSON.parse((await runHook("stop-loop.sh", dir, stopEvent(dir))).stdout)).toEqual({});
  });

  it("still blocks when cwd is a story worktree, not the main checkout", async () => {
    const dir = await makeProject({ stories: { "st-a1b2-sample-ready-story.md": SAMPLE_STORY }, loopState: LOOP_STATE });
    const worktreeDir = await addWorktree(dir);
    const out = JSON.parse((await runHook("stop-loop.sh", worktreeDir, stopEvent(worktreeDir))).stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("st-a1b2");
  });
});

describe("session-start.sh", () => {
  const startEvent = (cwd: string) => ({ session_id: "sess-1", hook_event_name: "SessionStart", source: "startup", cwd });

  it("exits 0 silently when the project has no marker", async () => {
    const dir = await makeProject({ marker: false });
    const r = await runHook("session-start.sh", dir, startEvent(dir));
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("injects rules + ready summary + loop status + the CLI path as additionalContext", async () => {
    const dir = await makeProject({ stories: { "st-a1b2-sample-ready-story.md": SAMPLE_STORY }, loopState: LOOP_STATE });
    const r = await runHook("session-start.sh", dir, startEvent(dir));
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const ctx = out.hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain("stories workflow");
    expect(ctx).toContain(`The story CLI is at: ${join(STORIES_CLAUDE_ROOT, "bin/story")}`);
    expect(ctx).toContain("st-a1b2");
    expect(ctx).toContain("story loop status");
  });

  it("on the legacy layout injects the migration notice", async () => {
    const dir = await makeProject({ marker: "legacy" });
    const out = JSON.parse((await runHook("session-start.sh", dir, startEvent(dir))).stdout);
    expect(out.hookSpecificOutput.additionalContext).toMatch(/story doctor/);
  });

  it("still injects when cwd is a story worktree", async () => {
    const dir = await makeProject({ stories: { "st-a1b2-sample-ready-story.md": SAMPLE_STORY } });
    const worktreeDir = await addWorktree(dir);
    const out = JSON.parse((await runHook("session-start.sh", worktreeDir, startEvent(worktreeDir))).stdout);
    expect(out.hookSpecificOutput.additionalContext).toContain("stories workflow");
  });
});

describe("hooks/hooks.json wiring", () => {
  const config = JSON.parse(readFileSync(join(HOOKS_DIR, "hooks.json"), "utf8"));

  it("declares exactly SessionStart, Stop, and PreToolUse", () => {
    expect(Object.keys(config.hooks).sort()).toEqual(["PreToolUse", "SessionStart", "Stop"]);
  });

  it("SessionStart is synchronous and covers startup|resume|clear|compact", () => {
    const [entry] = config.hooks.SessionStart;
    expect(entry.matcher).toBe("startup|resume|clear|compact");
    expect(entry.hooks[0]).toEqual({ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh", async: false });
  });

  it("Stop runs stop-loop.sh and PreToolUse guards every file-writing tool plus AskUserQuestion with guard.sh", () => {
    expect(config.hooks.Stop[0].hooks[0].command).toBe("${CLAUDE_PLUGIN_ROOT}/hooks/stop-loop.sh");
    const [entry] = config.hooks.PreToolUse;
    expect(entry.matcher).toBe("Edit|MultiEdit|NotebookEdit|Write|AskUserQuestion");
    expect(entry.hooks[0].command).toBe("${CLAUDE_PLUGIN_ROOT}/hooks/guard.sh");
  });

  it("every hook script and the bin shim exist and are executable", () => {
    for (const file of ["hooks/session-start.sh", "hooks/stop-loop.sh", "hooks/guard.sh", "bin/story"]) {
      expect(statSync(join(STORIES_CLAUDE_ROOT, file)).mode & 0o111, file).toBeTruthy();
    }
  });
});
