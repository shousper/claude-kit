import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, accessSync, constants } from "fs";
import { resolve } from "path";
import { HOOKS_DIR } from "../utils/paths";

// Source: Claude Code hook system — update these when Claude Code adds new events/tools
// See: https://docs.anthropic.com/en/docs/claude-code/hooks
const VALID_EVENTS = ["PreToolUse", "PostToolUse", "SessionStart", "Stop", "SubagentStop"];
const VALID_TOOL_MATCHERS = [
  "Write", "Edit", "Read", "Bash", "Glob", "Grep", "WebFetch", "WebSearch",
  "Task", "Skill", "NotebookEdit", "TodoWrite",
];
const VALID_SESSION_EVENTS = ["startup", "resume", "clear", "compact"];
const SHELLCHECK = Bun.which("shellcheck") ?? "shellcheck";

const hooksPath = resolve(HOOKS_DIR, "hooks.json");
const hooksConfig = JSON.parse(readFileSync(hooksPath, "utf-8"));
const pluginRoot = resolve(HOOKS_DIR, "..");

describe("hooks.json", () => {
  it("is valid JSON with a hooks object", () => {
    expect(hooksConfig).toHaveProperty("hooks");
    expect(typeof hooksConfig.hooks).toBe("object");
    expect(hooksConfig.hooks).not.toBeNull();
  });

  it("all event names are valid Claude Code events", () => {
    for (const event of Object.keys(hooksConfig.hooks)) {
      expect(VALID_EVENTS).toContain(event);
    }
  });

  it("all hook entries have matcher (string) and hooks (array)", () => {
    for (const [event, entries] of Object.entries(hooksConfig.hooks)) {
      expect(Array.isArray(entries)).toBe(true);
      for (const entry of entries as any[]) {
        expect(typeof entry.matcher).toBe("string");
        expect(Array.isArray(entry.hooks)).toBe(true);
      }
    }
  });

  it("PostToolUse matchers reference valid tool names", () => {
    const postToolUse = hooksConfig.hooks.PostToolUse ?? [];
    for (const entry of postToolUse) {
      for (const tool of entry.matcher.split("|")) {
        expect(VALID_TOOL_MATCHERS).toContain(tool);
      }
    }
  });

  it("all referenced scripts exist on disk", () => {
    for (const entries of Object.values(hooksConfig.hooks)) {
      for (const entry of entries as any[]) {
        for (const hook of entry.hooks) {
          const scriptPath = hook.command.replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot);
          expect(() => accessSync(scriptPath)).not.toThrow();
        }
      }
    }
  });

  it("all referenced scripts are executable", () => {
    for (const entries of Object.values(hooksConfig.hooks)) {
      for (const entry of entries as any[]) {
        for (const hook of entry.hooks) {
          const scriptPath = hook.command.replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot);
          expect(() => accessSync(scriptPath, constants.X_OK)).not.toThrow();
        }
      }
    }
  });

  it.skipIf(!Bun.which("shellcheck"))("all .sh files in hooks/ pass shellcheck", async () => {
    const scripts = readdirSync(HOOKS_DIR).filter((f) => f.endsWith(".sh"));
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      const proc = Bun.spawn([SHELLCHECK, "-s", "bash", resolve(HOOKS_DIR, script)], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stdout = await new Response(proc.stdout).text();
        throw new Error(`shellcheck failed for ${script}:\n${stdout}`);
      }
    }
  });

  it("SessionStart matchers only reference valid session events", () => {
    const sessionStart = hooksConfig.hooks.SessionStart ?? [];
    for (const entry of sessionStart) {
      for (const part of entry.matcher.split("|")) {
        expect(VALID_SESSION_EVENTS).toContain(part);
      }
    }
  });
});

describe("session-start.sh", () => {
  it("exits 0 and produces valid JSON with expected structure", async () => {
    const proc = Bun.spawn(["bash", resolve(HOOKS_DIR, "session-start.sh")], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: process.env.HOME ?? "/tmp" },
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const stdout = await new Response(proc.stdout).text();
    const json = JSON.parse(stdout);
    expect(json).toHaveProperty("hookSpecificOutput");
    expect(json.hookSpecificOutput).toHaveProperty("hookEventName", "SessionStart");
    expect(json.hookSpecificOutput).toHaveProperty("additionalContext");
    expect(typeof json.hookSpecificOutput.additionalContext).toBe("string");
  });
});
