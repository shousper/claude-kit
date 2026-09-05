import { describe, it, expect } from "bun:test";
import { readFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { runEval } from "../utils/eval-runner";
import { createWorkspace } from "../utils/workspace-manager";
import { selectHarnesses, type Harness } from "../utils/harness";
import { WRITING_ROOTS } from "../utils/paths";
import { stylePrompts, type StylePrompt } from "../fixtures/style-prompts";
import { scoreText, type StyleScore } from "../utils/style-grader";

const RUN_EVALS = process.env.RUN_EVALS === "1";
const SKIP_CLEANUP = process.env.SKIP_CLEANUP === "1";
const PER_RUN_TIMEOUT = 180_000;
const MODELS = (process.env.EVAL_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
const CONDITIONS = ["absent", "installed"] as const;
type Condition = (typeof CONDITIONS)[number];

interface Row extends StyleScore {
  harness: string;
  model: string;
  condition: Condition;
  prompt: string;
}

/** The absent condition is only absent if the plugin is not globally installed. */
function warnIfGloballyInstalled(harness: Harness): void {
  const lock = harness.id === "omp" ? join(homedir(), ".omp/agent/omp-plugins.lock.json") : join(homedir(), ".claude/plugins/installed_plugins.json");
  if (existsSync(lock) && /"writing/.test(readFileSync(lock, "utf-8"))) {
    console.warn(`[style eval] the writing plugin appears globally installed for ${harness.id}; the absent condition is not clean`);
  }
}

/** Strip parent-session nesting guards but keep the host Claude OAuth config. */
function hostClaudeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) continue;
    env[k] = v;
  }
  return env;
}

async function outputFor(prompt: StylePrompt, cwd: string, replyText: string): Promise<string> {
  if (!prompt.outputFile) return replyText;
  return readFile(join(cwd, prompt.outputFile), "utf-8").catch(() => "");
}

async function runOne(harness: Harness, model: string | undefined, condition: Condition, prompt: StylePrompt): Promise<Row> {
  const workspace = await createWorkspace({ workspace: "writing" });
  try {
    const result = await runEval(harness, prompt.prompt, {
      cwd: workspace.cwd,
      // Isolated Claude config dirs cannot refresh OAuth across sequential runs.
      env: harness.id === "claude" ? hostClaudeEnv() : workspace.env,
      pluginDirs: condition === "installed" ? [WRITING_ROOTS[harness.id]] : [],
      ephemeral: true,
      timeout: PER_RUN_TIMEOUT,
      maxTurns: 20,
      dangerouslySkipPermissions: true,
      ...(model ? { model } : {}),
    });
    const errors = result.events.filter((e) => e.kind === "error");
    if (errors.length > 0) {
      const messages = errors.map((e) => (e.kind === "error" ? e.message : "")).join("; ");
      throw new Error(`${harness.id} ${condition} ${prompt.id}: ${messages}`);
    }
    const replyText = result.events.filter((e) => e.kind === "text").map((e) => (e.kind === "text" ? e.text : "")).join("\n");
    const text = await outputFor(prompt, workspace.cwd, replyText);
    const score = await scoreText(text, prompt.extract ? { extract: prompt.extract } : {});
    return { harness: harness.id, model: model ?? harness.model, condition, prompt: prompt.id, ...score };
  } finally {
    if (!SKIP_CLEANUP) await workspace.cleanup();
  }
}

function runStyleSuite(harness: Harness): void {
  const models = MODELS.length > 0 ? MODELS : [undefined];
  const runs = models.length * CONDITIONS.length * stylePrompts.length;

  describe.skipIf(!RUN_EVALS)(`writing style (${harness.id})`, () => {
    it("scores lower with the plugin installed than without it", async () => {
      warnIfGloballyInstalled(harness);
      const rows: Row[] = [];
      for (const model of models) {
        for (const condition of CONDITIONS) {
          for (const prompt of stylePrompts) rows.push(await runOne(harness, model, condition, prompt));
        }
      }
      console.table(rows.map(({ ticCounts, ...row }) => ({ ...row, perThousand: row.perThousand.toFixed(1) })));

      for (const model of models) {
        const label = model ?? harness.model;
        const mean = (condition: Condition) => {
          const subset = rows.filter((r) => r.model === label && r.condition === condition);
          return subset.reduce((sum, r) => sum + r.perThousand, 0) / subset.length;
        };
        const absent = mean("absent");
        const installed = mean("installed");
        console.log(`[style eval] ${harness.id} ${label}: absent ${absent.toFixed(1)} -> installed ${installed.toFixed(1)} findings per 1,000 words`);
        expect(installed, `${harness.id} ${label}`).toBeLessThan(absent);
      }
    }, runs * PER_RUN_TIMEOUT * harness.timeoutScale + 60_000);
  });
}

for (const harness of selectHarnesses(process.env.HARNESSES)) {
  runStyleSuite(harness);
}
