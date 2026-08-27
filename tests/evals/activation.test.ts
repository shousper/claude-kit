import { describe, it } from "bun:test";
import { runEval } from "../utils/eval-runner";
import { runTrials } from "../utils/trials";
import { activationTests, type ActivationTest } from "../fixtures/prompts";
import { createWorkspace } from "../utils/workspace-manager";
import { checkSkillActivation } from "../utils/skill-activation";
import { selectHarnesses, type Harness } from "../utils/harness";
import { paritySubset, smokeSubset } from "../utils/parity";
import { STORIES_ROOT } from "../utils/paths";

const TRIALS = 3;
const REQUIRED_PASSES = 2;
const PER_TRIAL_TIMEOUT = 60_000;
const SKIP_CLEANUP = process.env.SKIP_CLEANUP === "1";
const RUN_EVALS = process.env.RUN_EVALS === "1";
const EVAL_TIER = process.env.EVAL_TIER;

type SessionContext = "post-brainstorm" | "mid-session";
const VALID_SESSIONS: Record<SessionContext, true> = { "post-brainstorm": true, "mid-session": true };
function isValidSession(context: string): context is SessionContext {
  return Object.hasOwn(VALID_SESSIONS, context);
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

function groupTests(tests: ActivationTest[]): GroupedTests {
  return tests.reduce<GroupedTests>((acc, test) => {
    const context = test.sessionContext ?? "cold-start";
    (acc[test.skill] ??= {})[context] ??= [];
    acc[test.skill][context].push(test);
    return acc;
  }, {});
}

/** EVAL_TIER controls spend: smoke is PR-tier, parity proves the mechanism on a
 *  second harness, full/unset is the whole description-quality matrix. */
function selectCases(): ActivationTest[] {
  if (EVAL_TIER === "smoke") return smokeSubset(activationTests);
  if (EVAL_TIER === "parity") return paritySubset(activationTests);
  return activationTests;
}

function runActivationSuite(harness: Harness) {
  const grouped = groupTests(selectCases());
  // Each harness installs from its own plugin dir (see Harness.pluginRoot for why).
  const pluginDirs = [harness.pluginRoot, STORIES_ROOT];

  describe.skipIf(!RUN_EVALS)(`skill activation (${harness.id})`, () => {
    for (const [skill, contexts] of Object.entries(grouped)) {
      describe(skill, () => {
        for (const [context, tests] of Object.entries(contexts)) {
          describe(context, () => {
            for (const test of tests) {
              const label = test.shouldActivate
                ? `activates on: ${test.prompt.slice(0, 60)}`
                : `does NOT activate on: ${test.prompt.slice(0, 60)}`;

              it(label, async () => {
                if (context !== "cold-start" && !isValidSession(context))
                  throw new Error(`Unknown session context: ${context}`);
                const sessionOpt = isValidSession(context) ? context : undefined;

                const trialDetails: Array<{ activated: boolean; details: string; exitCode: number; stdout: string; stderr: string }> = [];

                const outcome = await runTrials({
                  trials: TRIALS,
                  requiredPasses: REQUIRED_PASSES,
                  run: async () => {
                    const trialWorkspace = await createWorkspace({
                      ...(sessionOpt ? { session: sessionOpt } : {}),
                      ...(test.workspace ? { workspace: test.workspace } : {}),
                    });
                    try {
                      const result = await runEval(harness, test.prompt, {
                        timeout: PER_TRIAL_TIMEOUT,
                        maxTurns: 3,
                        cwd: trialWorkspace.cwd,
                        env: trialWorkspace.env,
                        pluginDirs,
                        ephemeral: true,
                        ...(sessionOpt && trialWorkspace.sessionId
                          ? { resume: trialWorkspace.sessionId, forkSession: true }
                          : {}),
                      });
                      const check = checkSkillActivation(harness, result.stdout, test.skill);
                      trialDetails.push({ activated: check.activated, details: check.details, ...result });
                      return { pass: check.activated, invalid: check.invalid };
                    } finally {
                      if (!SKIP_CLEANUP) await trialWorkspace.cleanup();
                    }
                  },
                });

                if (outcome.invalid) {
                  throw new Error(
                    `[INVALID RUN] Harness "${harness.id}" silently changed model mid-run for skill "${test.skill}"\n` +
                      `Prompt: "${test.prompt}"\n` +
                      `Context: ${context}\n` +
                      `Trials:\n${formatTrialReport(trialDetails)}`,
                  );
                }

                if (test.shouldActivate && !outcome.passed) {
                  throw new Error(
                    `[POSITIVE TEST FAILED] Skill "${test.skill}" activated ${outcome.passes}/${outcome.ran} times on ${harness.id} (need ${REQUIRED_PASSES})\n` +
                      `Prompt: "${test.prompt}"\n` +
                      `Context: ${context}\n` +
                      `Trials:\n${formatTrialReport(trialDetails)}`,
                  );
                }

                if (!test.shouldActivate && outcome.passed) {
                  throw new Error(
                    `[NEGATIVE TEST FAILED] Skill "${test.skill}" should NOT have activated on ${harness.id}, but did ${outcome.passes}/${outcome.ran} times\n` +
                      `Prompt: "${test.prompt}"\n` +
                      `Context: ${context}\n` +
                      `Trials:\n${formatTrialReport(trialDetails)}`,
                  );
                }
              // runTrials executes sequentially (early-exit on requiredPasses/maxFailures), so
              // worst case is every trial running to completion: TRIALS * PER_TRIAL_TIMEOUT.
              }, TRIALS * PER_TRIAL_TIMEOUT + 30_000);
            }
          });
        }
      });
    }
  });
}

// Session continuation (--resume/--fork-session) is wired on the claude harness (RunOptions.resume
// + forkSession, tests/utils/harness/claude.ts). It's a no-op on omp: workspace-manager.ts writes
// Claude JSONL session fixtures only, and omp's session store doesn't read that format, so
// post-brainstorm/mid-session cases still cold-start on omp until the fixture format is shared.
for (const harness of selectHarnesses(process.env.HARNESSES)) {
  runActivationSuite(harness);
}
