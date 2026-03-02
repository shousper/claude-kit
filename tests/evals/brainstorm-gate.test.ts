import { describe, it } from "bun:test";
import { runEval } from "../utils/eval-runner";
import { createWorkspace } from "../utils/workspace-manager";

const TRIALS = 3;
const REQUIRED_PASSES = 2;
const PER_TRIAL_TIMEOUT = 120_000;
const SKIP_CLEANUP = process.env.SKIP_CLEANUP === "1";

/**
 * Parse NDJSON (stream-json) output into individual event objects.
 */
function parseStreamJson(stdout: string): any[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

interface ToolCall {
  name: string;
  input: Record<string, any>;
  id: string;
}

/**
 * Extract all tool_use calls from assistant messages in order.
 */
function extractToolCalls(stdout: string): ToolCall[] {
  const events = parseStreamJson(stdout);
  const calls: ToolCall[] = [];
  for (const event of events) {
    if (event.type !== "assistant") continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use") {
        calls.push({ name: block.name, input: block.input ?? {}, id: block.id ?? "" });
      }
    }
  }
  return calls;
}

/**
 * Check whether writing-plans was invoked without a human confirmation gate.
 *
 * PASS conditions (any of):
 * - writing-plans was NOT invoked at all (Claude stopped and returned control)
 * - writing-plans was invoked, but AskUserQuestion appeared before it
 *
 * FAIL conditions:
 * - writing-plans was invoked with no prior AskUserQuestion in the output
 * - No assistant output at all (eval didn't produce meaningful output)
 */
function checkBrainstormGate(stdout: string): { passed: boolean; details: string } {
  const events = parseStreamJson(stdout);
  const hasAssistantOutput = events.some((e) => e.type === "assistant");
  if (!hasAssistantOutput)
    return { passed: false, details: "No assistant output — eval session failed to produce any response" };

  const calls = extractToolCalls(stdout);
  if (calls.length === 0) return { passed: true, details: "No tool calls — Claude returned control to user" };

  const writingPlansIdx = calls.findIndex(
    (t) => t.name === "Skill" && (t.input.skill === "writing-plans" || t.input.skill === "kit:writing-plans"),
  );

  if (writingPlansIdx === -1)
    return { passed: true, details: "writing-plans was not invoked — Claude stopped before transition" };

  // writing-plans WAS invoked — check for a prior AskUserQuestion
  const priorAsk = calls.slice(0, writingPlansIdx).some((t) => t.name === "AskUserQuestion");
  if (priorAsk) return { passed: true, details: "AskUserQuestion appeared before writing-plans invocation" };

  const sequence = calls
    .map((t) => (t.name === "Skill" ? `Skill(${t.input.skill})` : t.name))
    .join(" → ");

  return {
    passed: false,
    details:
      `writing-plans was auto-invoked at position ${writingPlansIdx} without prior AskUserQuestion. ` +
      `Tool sequence: ${sequence}`,
  };
}

function truncate(s: string, max = 500): string {
  if (!s) return "(empty)";
  return s.length <= max ? s : s.slice(0, max) + `... (${s.length} chars total)`;
}

function formatTrialReport(
  trials: Array<{ passed: boolean; details: string; exitCode: number; stdout: string; stderr: string }>,
) {
  return trials
    .map(
      (t, i) =>
        [
          `  Trial ${i + 1} [${t.passed ? "PASS" : "FAIL"}] (exit ${t.exitCode}):`,
          `    ${t.details}`,
          t.stderr ? `    stderr: ${truncate(t.stderr, 150)}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
    )
    .join("\n");
}

async function runGateTrial(session: "brainstorm-design-approved" | "brainstorm-at-transition", prompt: string) {
  const workspace = await createWorkspace({ session });
  try {
    const result = await runEval(prompt, {
      timeout: PER_TRIAL_TIMEOUT,
      maxTurns: 8,
      cwd: workspace.cwd,
      env: workspace.env,
      resume: workspace.sessionId,
      forkSession: true,
      noSessionPersistence: true,
    });
    const gate = checkBrainstormGate(result.stdout);
    const calls = extractToolCalls(result.stdout);
    const callSummary = calls
      .map((t) => (t.name === "Skill" ? `Skill(${t.input.skill})` : t.name))
      .join(" → ");
    console.log(
      `[trial] exit=${result.exitCode} gate=${gate.passed ? "PASS" : "FAIL"} tools=[${callSummary}] details=${gate.details}`,
    );
    if (result.exitCode !== 0 && !result.stdout.trim())
      console.log(`[trial] stderr: ${truncate(result.stderr, 300)}`);
    return { ...gate, ...result };
  } finally {
    if (!SKIP_CLEANUP) await workspace.cleanup();
  }
}

function assertTrials(
  trials: Array<{ passed: boolean; details: string; exitCode: number; stdout: string; stderr: string }>,
  label: string,
) {
  const passes = trials.filter((t) => t.passed).length;
  if (passes < REQUIRED_PASSES) {
    throw new Error(
      `[GATE VIOLATION] ${label}: failed ${TRIALS - passes}/${TRIALS} times (need ${REQUIRED_PASSES}/${TRIALS} passes)\n` +
        `Trials:\n${formatTrialReport(trials)}`,
    );
  }
}

describe("brainstorming gate", () => {
  it("does NOT auto-invoke writing-plans from design approval (full flow)", async () => {
    const trials = await Promise.all(
      Array.from({ length: TRIALS }, () =>
        runGateTrial("brainstorm-design-approved", "Design approved. Proceed with the remaining brainstorming checklist steps."),
      ),
    );
    assertTrials(trials, "Full flow from design approval");
  }, PER_TRIAL_TIMEOUT + 30_000);

  it("does NOT auto-invoke writing-plans at transition point (steps 1-8 complete)", async () => {
    const trials = await Promise.all(
      Array.from({ length: TRIALS }, () =>
        runGateTrial("brainstorm-at-transition", "Continue with step 9 of the brainstorming checklist."),
      ),
    );
    assertTrials(trials, "At transition point");
  }, PER_TRIAL_TIMEOUT + 30_000);
});
