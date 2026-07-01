import { describe, it } from "bun:test";
import { runEval } from "../utils/eval-runner";
import { createWorkspace, type WorkspaceOptions } from "../utils/workspace-manager";
import { checkWorkflowInvocation, findWorkflowCalls } from "../utils/workflow-invocation";

// These evals answer the one question static tests cannot: given the build-flow skill, does a
// real agent emit a correctly-shaped `Workflow` launch call? The workflow itself is never
// executed — in headless (`-p`) mode the Workflow tool is denied, but the assistant's tool_use
// (with its args) is still emitted in stream-json, which is exactly what we inspect.

const TRIALS = 3;
const REQUIRED_PASSES = 2;
const PER_TRIAL_TIMEOUT = 120_000;
const MAX_TURNS = 10;
const SKIP_CLEANUP = process.env.SKIP_CLEANUP === "1";

interface Scenario {
  name: string;
  prompt: string;
  session?: WorkspaceOptions["session"];
}

// "Different conditions" under which a launch must still be correctly shaped. Add scenarios here.
const SCENARIOS: Scenario[] = [
  {
    name: "executes a markdown plan file",
    prompt:
      "You are already in an isolated git worktree and you have my explicit consent to build on " +
      "the current branch — do NOT create a new worktree. Do NOT implement the tasks yourself. " +
      "Execute the plan in docs/plans/2026-02-20-auth-system.md using build-flow: parse it into " +
      "dependency-ordered batches and launch the build-flow workflow now.",
  },
  {
    // Same launch step, different entry phrasing — guards against the call shape being
    // sensitive to how the request is worded.
    name: "executes on a direct 'build it' instruction",
    prompt:
      "I've finalized the implementation plan in docs/plans/2026-02-20-auth-system.md and this " +
      "worktree is ready — build here, do NOT create a new worktree and do NOT implement it " +
      "yourself. Build it now with build-flow: parse the plan into dependency-ordered batches " +
      "and launch the build-flow workflow.",
  },
];

function truncate(s: string, max = 300): string {
  if (!s) return "(empty)";
  return s.length <= max ? s : s.slice(0, max) + `... (${s.length} chars total)`;
}

describe("build-flow workflow invocation", () => {
  for (const scenario of SCENARIOS) {
    it(
      scenario.name,
      async () => {
        const trials = await Promise.all(
          Array.from({ length: TRIALS }, async () => {
            const ws = await createWorkspace(scenario.session ? { session: scenario.session } : {});
            try {
              const result = await runEval(scenario.prompt, {
                timeout: PER_TRIAL_TIMEOUT,
                maxTurns: MAX_TURNS,
                cwd: ws.cwd,
                env: ws.env,
                noSessionPersistence: true,
                ...(ws.sessionId ? { resume: ws.sessionId, forkSession: true } : {}),
              });
              const check = checkWorkflowInvocation(result.stdout);
              return { ...check, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
            } finally {
              if (!SKIP_CLEANUP) await ws.cleanup();
            }
          }),
        );

        const passes = trials.filter((t) => t.invoked && t.valid).length;
        if (passes < REQUIRED_PASSES) {
          const report = trials
            .map((t, i) => {
              const calls = findWorkflowCalls(t.stdout);
              const shape = calls.length
                ? calls.map((c) => truncate(JSON.stringify(c), 200)).join("\n      ")
                : "(no Workflow call emitted)";
              return [
                `  Trial ${i + 1} [invoked=${t.invoked} valid=${t.valid}] (exit ${t.exitCode}):`,
                `    ${t.details}`,
                `    Workflow call: ${shape}`,
                t.stderr ? `    stderr: ${truncate(t.stderr, 150)}` : null,
              ]
                .filter(Boolean)
                .join("\n");
            })
            .join("\n");
          throw new Error(
            `[INVOCATION FAILED] "${scenario.name}": ${passes}/${TRIALS} trials produced a valid launch (need ${REQUIRED_PASSES})\n` +
              `Prompt: "${scenario.prompt}"\n` +
              `Trials:\n${report}`,
          );
        }
      },
      PER_TRIAL_TIMEOUT + 30_000,
    );
  }
});
