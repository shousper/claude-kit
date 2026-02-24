import { describe, it } from "bun:test";
import { runEval } from "../utils/eval-runner";
import { activationTests, type ActivationTest } from "../fixtures/prompts";
import { createWorkspace } from "../utils/workspace-manager";

const TRIALS = 3;
const REQUIRED_PASSES = 2;
const PER_TRIAL_TIMEOUT = 60_000;
const SKIP_CLEANUP = process.env.SKIP_CLEANUP === "1";

const VALID_SESSIONS = new Set(["post-brainstorm", "mid-session"] as const);

/**
 * Parse NDJSON (stream-json) output into individual event objects.
 */
function parseStreamJson(stdout: string): any[] {
  let parseFailures = 0;
  const events = stdout
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        parseFailures++;
        return [];
      }
    });
  if (events.length === 0 && parseFailures > 0)
    console.warn(`parseStreamJson: ${parseFailures} lines failed to parse, 0 succeeded`);
  return events;
}

/**
 * Check whether Claude activated the expected skill by inspecting stream-json
 * output for Skill tool calls and text mentions.
 */
function checkSkillActivation(
  stdout: string,
  skill: string,
): { activated: boolean; details: string } {
  const events = parseStreamJson(stdout);
  if (events.length === 0)
    return { activated: false, details: "No parseable events in output" };

  for (const event of events) {
    if (event.type !== "assistant") continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use" && block.name === "Skill") {
        const invoked = block.input?.skill;
        if (invoked === skill || invoked === `kit:${skill}`)
          return { activated: true, details: `Skill tool called with "${invoked}"` };
      }
    }
  }

  for (const event of events) {
    if (event.type !== "assistant") continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "text" && block.text?.includes(`kit:${skill}`))
        return { activated: true, details: `Found "kit:${skill}" in assistant text` };
    }
  }

  const toolCalls = events
    .filter((e: any) => e.type === "assistant")
    .flatMap((e: any) => (e.message?.content ?? []).filter((b: any) => b.type === "tool_use"))
    .map((b: any) => `${b.name}(${JSON.stringify(b.input).slice(0, 80)})`);

  return {
    activated: false,
    details: toolCalls.length > 0
      ? `Tools called: ${toolCalls.join(", ")}`
      : "No tool calls found",
  };
}

function truncate(s: string, max = 300): string {
  if (!s) return "(empty)";
  return s.length <= max ? s : s.slice(0, max) + `... (${s.length} chars total)`;
}

function formatTrialReport(trials: Array<{ activated: boolean; details: string; exitCode: number; stdout: string; stderr: string }>) {
  return trials
    .map((t, i) =>
      [
        `  Trial ${i + 1} [${t.activated ? "ACTIVATED" : "NOT ACTIVATED"}] (exit ${t.exitCode}):`,
        `    ${t.details}`,
        `    stdout: ${truncate(t.stdout)}`,
        t.stderr ? `    stderr: ${truncate(t.stderr, 150)}` : null,
      ].filter(Boolean).join("\n"),
    ).join("\n");
}

// Group tests by skill, then by session context
type GroupedTests = Record<string, Record<string, ActivationTest[]>>;

const grouped = activationTests.reduce<GroupedTests>((acc, test) => {
  const context = test.sessionContext ?? "cold-start";
  (acc[test.skill] ??= {})[context] ??= [];
  acc[test.skill][context].push(test);
  return acc;
}, {});

describe("skill activation", () => {
  for (const [skill, contexts] of Object.entries(grouped)) {
    describe(skill, () => {
      for (const [context, tests] of Object.entries(contexts)) {
        describe(context, () => {
          for (const test of tests) {
            const label = test.shouldActivate
              ? `activates on: ${test.prompt.slice(0, 60)}`
              : `does NOT activate on: ${test.prompt.slice(0, 60)}`;

            it(label, async () => {
              if (context !== "cold-start" && !VALID_SESSIONS.has(context as any))
                throw new Error(`Unknown session context: ${context}`);
              const sessionOpt = VALID_SESSIONS.has(context as any) ? context as "post-brainstorm" | "mid-session" : undefined;

              const trials = await Promise.all(
                Array.from({ length: TRIALS }, async () => {
                  const trialWorkspace = await createWorkspace({
                    ...(sessionOpt ? { session: sessionOpt } : {}),
                    ...(test.workspace ? { workspace: test.workspace } : {}),
                  });
                  try {
                    const evalOpts = {
                      timeout: PER_TRIAL_TIMEOUT,
                      maxTurns: 3,
                      cwd: trialWorkspace.cwd,
                      env: trialWorkspace.env,
                      noSessionPersistence: true,
                      ...(trialWorkspace.sessionId ? { resume: trialWorkspace.sessionId, forkSession: true } : {}),
                    };
                    const result = await runEval(test.prompt, evalOpts);
                    return { ...checkSkillActivation(result.stdout, test.skill), ...result };
                  } finally {
                    if (!SKIP_CLEANUP) await trialWorkspace.cleanup();
                  }
                }),
              );

              const passes = trials.filter((t) => t.activated).length;

              if (test.shouldActivate && passes < REQUIRED_PASSES) {
                throw new Error(
                  `[POSITIVE TEST FAILED] Skill "${test.skill}" activated ${passes}/${TRIALS} times (need ${REQUIRED_PASSES})\n` +
                    `Prompt: "${test.prompt}"\n` +
                    `Context: ${context}\n` +
                    `Trials:\n${formatTrialReport(trials)}`,
                );
              }

              if (!test.shouldActivate && passes >= REQUIRED_PASSES) {
                throw new Error(
                  `[NEGATIVE TEST FAILED] Skill "${test.skill}" should NOT have activated, but did ${passes}/${TRIALS} times\n` +
                    `Prompt: "${test.prompt}"\n` +
                    `Context: ${context}\n` +
                    `Trials:\n${formatTrialReport(trials)}`,
                );
              }
            }, PER_TRIAL_TIMEOUT + 30_000); // Trials are concurrent, so timeout = 1 trial + buffer
          }
        });
      }
    });
  }
});
