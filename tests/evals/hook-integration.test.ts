import { describe, it, expect, afterAll } from "bun:test";
import { runEval } from "../utils/eval-runner";
import { createWorkspace, type Workspace } from "../utils/workspace-manager";

const RUN_EVALS = process.env.RUN_EVALS === "1";
const workspaces: Workspace[] = [];

afterAll(async () => {
  for (const ws of workspaces) await ws.cleanup();
});

describe.skipIf(!RUN_EVALS)("hook integration", () => {
  it("eslint hook fires when Claude writes a JS file", async () => {
    const ws = await createWorkspace();
    workspaces.push(ws);

    const result = await runEval(
      "Write a file at src/example.js with this exact content: const unused = 1;",
      {
        timeout: 60_000,
        maxTurns: 3,
        cwd: ws.cwd,
        env: ws.env,
      },
    );

    expect(result.exitCode).toBe(0);

    // Check that the hook output appears somewhere in the stream
    const output = result.stdout + result.stderr;
    const mentionsEslint = output.toLowerCase().includes("eslint") ||
      output.includes("formatted") ||
      output.includes("linting");
    expect(mentionsEslint).toBe(true);
  }, 90_000);
});
