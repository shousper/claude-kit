import { describe, it, expect, afterEach } from "bun:test";
import { readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { runEval } from "./eval-runner";
import { createWorkspace, type Workspace } from "./workspace-manager";

const RUN_EVALS = process.env.RUN_EVALS === "1";

let workspaces: Workspace[] = [];

afterEach(async () => {
  for (const ws of workspaces) {
    await ws.cleanup();
  }
  workspaces = [];
});

describe.skipIf(!RUN_EVALS)("eval environment isolation", () => {
  it("runs claude from an isolated workspace", async () => {
    const ws = await createWorkspace();
    workspaces.push(ws);

    const result = await runEval("Reply with just the word PONG", {
      timeout: 45_000,
      maxTurns: 1,
      pluginDir: false,
      env: ws.env,
      cwd: ws.cwd,
    });

    if (result.exitCode !== 0) {
      console.error("STDERR:", result.stderr);
      console.error("STDOUT (last 1000):", result.stdout.slice(-1000));
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  }, 60_000);

  it("resumes a session installed by workspace manager", async () => {
    const ws = await createWorkspace({ session: "post-brainstorm" });
    workspaces.push(ws);

    const result = await runEval("What was discussed earlier in this session?", {
      maxTurns: 1,
      resume: ws.sessionId!,
      forkSession: true,
      pluginDir: false,
      env: ws.env,
      cwd: ws.cwd,
    });

    if (result.exitCode !== 0) {
      console.error("STDERR:", result.stderr);
      console.error("STDOUT (last 1000):", result.stdout.slice(-1000));
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  }, 120_000);
});
