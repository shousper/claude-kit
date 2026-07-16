import { describe, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { runEval } from "../utils/eval-runner";
import { createWorkspace } from "../utils/workspace-manager";
import { parseStreamJson } from "../utils/workflow-invocation";

// End-to-end stories loop: given the marker config and a seeded board (fixture
// workspace-stories, gates = `true`), does a live agent drive the story CLI —
// claim → implement → done — rather than hand-editing the board?
//
// The prompt forbids background workflows: the Workflow tool is denied in headless
// (-p) mode (see build-flow-invocation.test.ts), so stories:work's usual
// kit:build-flow dispatch cannot run here; direct implementation is the only
// viable path and is what we steer to.

const TRIALS = 2;
const REQUIRED_PASSES = 1;
const PER_TRIAL_TIMEOUT = 300_000;
const MAX_TURNS = 40;
const SKIP_CLEANUP = process.env.SKIP_CLEANUP === "1";
const RUN_EVALS = process.env.RUN_EVALS === "1";

const PROMPT =
  "This project uses the stories workflow (see .claude/story-workflow.json). Complete all " +
  "stories on the board. Use the story CLI for every board mutation — claim each ready story, " +
  "implement its acceptance criteria, and close it with `story done`. Do NOT launch background " +
  "workflows and do NOT edit files under stories/ directly; implement the work yourself in " +
  "this session.";

// Any invocation of the story CLI, whether bare (`story claim …`) or via a
// resolved path (`…/plugins/stories/bin/story claim …`).
const STORY_CLI_RE =
  /(^|[/\s])story\s+(init|create|ready|claim|show|list|board|update|note|park|record|done|doctor|archive|loop)\b/;

function storyCliCalls(stdout: string): string[] {
  return parseStreamJson(stdout)
    .filter((e: any) => e.type === "assistant")
    .flatMap((e: any) => (e.message?.content ?? []) as any[])
    .filter((b: any) => b.type === "tool_use" && b.name === "Bash")
    .map((b: any) => String(b.input?.command ?? ""))
    .filter((cmd) => STORY_CLI_RE.test(cmd));
}

/** Story files (active or archived) whose frontmatter reached status: done. */
function doneStories(cwd: string): string[] {
  const done: string[] = [];
  for (const dir of [join(cwd, "stories"), join(cwd, "stories", "archive")]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      if (/^status:\s*done\b/m.test(readFileSync(join(dir, f), "utf-8"))) done.push(f);
    }
  }
  return done;
}

function truncate(s: string, max = 300): string {
  if (!s) return "(empty)";
  return s.length <= max ? s : s.slice(0, max) + `... (${s.length} chars total)`;
}

describe.skipIf(!RUN_EVALS)("stories:work live loop", () => {
  it(
    "drives the story CLI and closes at least one story",
    async () => {
      const trials = await Promise.all(
        Array.from({ length: TRIALS }, async () => {
          const ws = await createWorkspace({ workspace: "stories" });
          try {
            const result = await runEval(PROMPT, {
              timeout: PER_TRIAL_TIMEOUT,
              maxTurns: MAX_TURNS,
              cwd: ws.cwd,
              env: ws.env,
              noSessionPersistence: true,
              dangerouslySkipPermissions: true,
            });
            const cliCalls = storyCliCalls(result.stdout);
            const done = doneStories(ws.cwd); // must read before cleanup
            return {
              pass: cliCalls.length > 0 && done.length >= 1,
              cliCalls,
              done,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
            };
          } finally {
            if (!SKIP_CLEANUP) await ws.cleanup();
          }
        }),
      );

      const passes = trials.filter((t) => t.pass).length;
      if (passes < REQUIRED_PASSES) {
        const report = trials
          .map((t, i) =>
            [
              `  Trial ${i + 1} [pass=${t.pass}] (exit ${t.exitCode}):`,
              `    story CLI calls (${t.cliCalls.length}): ${
                t.cliCalls.length
                  ? t.cliCalls.slice(0, 5).map((c) => truncate(c, 120)).join(" | ")
                  : "(none)"
              }`,
              `    stories done: ${t.done.length ? t.done.join(", ") : "(none)"}`,
              `    stdout: ${truncate(t.stdout)}`,
              t.stderr ? `    stderr: ${truncate(t.stderr, 150)}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n");
        throw new Error(
          `[STORIES WORK FAILED] ${passes}/${TRIALS} trials closed a story via the CLI (need ${REQUIRED_PASSES})\n` +
            `Prompt: "${PROMPT}"\n` +
            `Trials:\n${report}`,
        );
      }
    },
    PER_TRIAL_TIMEOUT + 60_000,
  );
});
