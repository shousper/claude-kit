// Loop state, Stop-hook tick decisions, and shared learnings for the stories plugin.
//
// State file  : .claude/story-loop.local.md      (YAML-subset frontmatter via the
//               board's parseStory/serializeStory; atomic via writeFileAtomic)
// Learnings   : .claude/story-learnings.local.md (append-only under the "learnings" lock)
// Decisions   : tick() returns {decision: "allow"|"block", reason?, systemMessage?, summary?}
//               toHookOutput() shapes that into Stop-hook JSON:
//                 block -> {"decision":"block","reason":…,"systemMessage":…}
//                 allow -> {"systemMessage":…} when there is a summary, else {}
//
// Import discipline: this module may import board/locks/util/worktrees/doctor
// but NEVER cli.mjs — cli.mjs statically imports loop.mjs for the `loop`
// subcommand (C6), so a back-import would be a static cycle.
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { computeReady, loadConfig, loadStories, parseStory, readBodySection, serializeStory } from "./board.mjs";
import { runDoctor } from "./doctor.mjs";
import { withLock } from "./locks.mjs";
import { CliError, writeFileAtomic } from "./util.mjs";
import { activeDiffs } from "./worktrees.mjs";
// (computeReady/loadStories/runDoctor/withLock/activeDiffs are imported now
// because tasks C2–C6 append code that uses them — bun does not fail on
// unused imports.)

const LOOP_FILE = ".claude/story-loop.local.md";
const LEARNINGS_FILE = ".claude/story-learnings.local.md";

export function loopStatePath(root) { return join(root, LOOP_FILE); }
export function learningsPath(root) { return join(root, LEARNINGS_FILE); }

// ---------------------------------------------------------------- loop state

// The state file reuses the board's frontmatter format: every loop-state key is
// "unknown" to serializeStory's FIELD_ORDER (they serialize after the — absent —
// known fields, in insertion order), and parseStory hands them back typed:
// numbers stay numbers, the attempts one-level flow map stays a map.

export function readLoopState(root) {
  const p = loopStatePath(root);
  if (!existsSync(p)) return null;
  let s;
  try {
    s = parseStory(readFileSync(p, "utf8"), p);
  } catch (err) {
    throw new CliError(`corrupt loop state (${err.message}): ${p}`);
  }
  if (s.goal === undefined && s.iteration === undefined) throw new CliError(`corrupt loop state: ${p}`);
  const attempts = {};
  for (const [id, n] of Object.entries(s.attempts ?? {})) attempts[id] = Number(n) || 0;
  return {
    goal: s.goal || "complete all stories",
    session_id: s.session_id ? String(s.session_id) : "",
    iteration: Number(s.iteration) || 0,
    max_iterations: Number(s.max_iterations) || 10,
    attempts,
  };
}

export function writeLoopState(root, state) {
  const record = {
    goal: state.goal,
    iteration: state.iteration,
    max_iterations: state.max_iterations,
    body: "",
  };
  if (state.session_id) record.session_id = state.session_id;
  if (Object.keys(state.attempts ?? {}).length > 0) record.attempts = state.attempts;
  writeFileAtomic(loopStatePath(root), serializeStory(record)); // temp+rename: atomic, creates .claude/
}

// ----------------------------------------------------------- shared learnings

export async function appendLearning(root, text, opts = {}) {
  const now = opts.now ?? (() => new Date());
  await withLock(root, "learnings", () => {
    const p = learningsPath(root);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, `\n## ${now().toISOString()}\n\n${String(text).trim()}\n`);
  });
}

// Tail excerpt for tick re-prompts. Reads without the lock: appends are atomic
// enough at this size and a torn read only degrades a prompt, never state.
export function readLearnings(root, opts = {}) {
  const p = learningsPath(root);
  if (!existsSync(p)) return "";
  const entries = readFileSync(p, "utf8").split(/^(?=## )/m).filter((e) => e.trim());
  const excerpt = entries.slice(-(opts.maxEntries ?? 5)).join("").trim();
  const maxChars = opts.maxChars ?? 2000;
  return excerpt.length > maxChars ? excerpt.slice(-maxChars) : excerpt;
}

// -------------------------------------------------- story body & goal helpers

// The unified case-insensitive body-section reader now lives in board.mjs;
// re-exported under the historical name so existing importers keep working.
export { readBodySection as extractSection } from "./board.mjs";

// goal: "complete all stories" (default) | "epic:st-XXXX" | "st-1 st-2, st-3".
// Free text falls back to the whole board.
export function scopeStories(stories, goal) {
  const g = String(goal ?? "").trim();
  if (!g || g === "complete all stories") return stories;
  if (g.startsWith("epic:")) {
    const epic = g.slice("epic:".length).trim();
    return stories.filter((s) => s.epic === epic || s.id === epic);
  }
  const ids = g.split(/[\s,]+/).filter((w) => w.startsWith("st-"));
  if (ids.length === 0) return stories;
  return stories.filter((s) => ids.includes(s.id));
}

// High-signal re-prompt (Geocodio pattern): the specific next story + its
// verifiable acceptance criteria + accumulated learnings — never "keep going".
export function buildBlockReason(story, learnings, state) {
  return [
    `Story loop iteration ${state.iteration}/${state.max_iterations} - the goal is not complete. Work exactly one story now:`,
    "",
    `${story.id} - ${story.title}`,
    "",
    "Acceptance criteria:",
    readBodySection(story.body, "Acceptance Criteria") || "(none recorded - treat the Description section as the contract)",
    "",
    `Claim it with: story claim ${story.id} - implement inside its worktree (kit:build-flow), then: story done ${story.id}`,
    `Blocked on a human decision? story park ${story.id} --question "..." and pick up the next story.`,
    "",
    "Learnings from previous iterations:",
    (learnings ?? "").trim() || "(none yet)",
  ].join("\n");
}

// --------------------------------------------------------- summaries + tick

const indent = (t) => t.split("\n").map((l) => `  ${l}`).join("\n");

function endSummary(headline, stories) {
  const done = stories.filter((s) => s.status === "done").length;
  const parked = stories.filter((s) => s.status === "blocked");
  const lines = [
    `Story loop finished. ${headline}`,
    `Board: ${done}/${stories.length} in scope done, ${parked.length} parked.`,
  ];
  for (const s of parked) {
    const q = readBodySection(s.body, "Questions");
    lines.push(`- ${s.id} ${s.title} - PARKED${q ? `:\n${indent(q)}` : " (no question recorded)"}`);
  }
  if (parked.length > 0) {
    lines.push("Parked stories need a human decision - answer the question, then: story update <id> --status todo");
  }
  return lines.join("\n");
}

function waitingSummary(open) {
  const held = open.filter((s) => s.status === "in-progress" || s.status === "in-review");
  return [
    "Story loop idle: nothing is claimable right now.",
    ...held.map((s) => `- ${s.id} ${s.title} (${s.status})`),
    "The loop stays armed; it resumes when a story becomes ready (review lands, claim released, or dependency completes).",
  ].join("\n");
}

function attemptsFor(state, id) { return Number(state.attempts?.[id]) || 0; }

// Iteration/attempt increments go through writeLoopState (temp+rename): atomic.
function bump(root, state, storyId) {
  state.iteration += 1;
  if (storyId) state.attempts = { ...state.attempts, [storyId]: attemptsFor(state, storyId) + 1 };
  writeLoopState(root, state);
}

// The Stop-hook decision engine (design §10). All collaborators injectable for tests.
export async function tick(sessionId, opts = {}) {
  const root = opts.root ?? process.cwd();
  // A corrupt/unreadable config means there is no drivable loop — the Stop hook
  // must NOT hard-crash on it (that would wedge every stop) and must NOT proceed
  // with an empty {} config (which would drive with undefined gates/budgets/merge).
  // Treat it as "allow stop" with a clear reason instead.
  let config;
  try {
    config = loadConfig(root);
  } catch (err) {
    return { decision: "allow", summary: `Story loop cannot run: ${err.message}` };
  }
  // loadStories REQUIRES config; computeReady is pure — the diff union comes
  // from worktrees.activeDiffs (declared touches ∪ actual worktree diffs).
  const loadStories_ = opts.loadStories ?? (() => loadStories(root, config));
  const computeReady_ = opts.computeReady ??
    ((stories) => computeReady(stories, { diffs: activeDiffs(root, config, stories) }));
  const readLearnings_ = opts.readLearnings ?? (() => readLearnings(root));
  // PR mode (Section E): best-effort sweep BEFORE any decision, so feedback
  // detected right now is visible to this very tick's ready computation.
  // github.mjs is imported dynamically — a static import would close the
  // cycle loop.mjs → github.mjs → cli.mjs → loop.mjs.
  if (config.merge === "pr") {
    try {
      const sweepFn = opts.sweepFn ?? (await import("./github.mjs")).sweep;
      await sweepFn(root, {});
    } catch {
      // Sweep is best-effort at turn end; a gh outage must not block the session.
    }
  }
  // Ratified: only the SAFE fix kinds auto-apply during a run (merged-local +
  // merged-self flips + stale-lease reclaims + missing-worktree reclaims);
  // every other kind stays detect-only until a human runs `story doctor --fix`.
  // missing-worktree is the same safety class as stale-lease — reclaim an
  // in-progress story with no worktree back to todo so a worker sees it now
  // instead of after STALE_LEASE_MS; merged-self closes a story whose merge
  // landed but whose status write crashed, so no worker redoes merged work.
  // runDoctor takes NO lock — wrap it in the board lock, exactly as cmdDoctor
  // does.
  const doctor_ = opts.doctor ?? (() =>
    withLock(root, "board", () =>
      runDoctor(root, config, {
        fix: true,
        kinds: ["merged-local", "merged-self", "stale-lease", "missing-worktree"],
      })));

  let state;
  try {
    state = readLoopState(root);
  } catch {
    unlinkSync(loopStatePath(root));
    return {
      decision: "allow",
      summary: 'Story loop state file was corrupt and has been removed. Restart with: story loop start --goal "..."',
    };
  }
  if (!state) return { decision: "allow" };
  if (state.session_id && state.session_id !== sessionId) return { decision: "allow" };
  if (!state.session_id && sessionId) {
    state.session_id = sessionId; // bind the loop to the first session that ticks it
    writeLoopState(root, state);
  }

  const report = await doctor_(); // auto-fixes land first, then the board is read
  const scoped = scopeStories(await loadStories_(), state.goal);

  if (state.iteration >= state.max_iterations) {
    unlinkSync(loopStatePath(root));
    return {
      decision: "allow",
      summary: endSummary(`Iteration budget exhausted (${state.iteration}/${state.max_iterations}).`, scoped),
    };
  }

  const hard = (report.issues ?? []).filter((i) => i.hard).map((i) => i.detail ?? i.kind);
  if (hard.length > 0) {
    bump(root, state); // corruption blocks still consume budget: no infinite repair loop
    return {
      decision: "block",
      reason: [
        "Story board integrity check failed - repair it before continuing the loop:",
        ...hard.map((h) => `- ${h}`),
        "",
        "Run: story doctor          (inspect)",
        "Then: story doctor --fix   (repair)",
        "Never hand-edit files under the stories directory.",
      ].join("\n"),
      systemMessage: `story doctor · iteration ${state.iteration}/${state.max_iterations}`,
    };
  }

  const open = scoped.filter((s) => s.status !== "done" && s.status !== "blocked");
  if (open.length === 0) {
    unlinkSync(loopStatePath(root));
    return {
      decision: "allow",
      summary: endSummary("Goal complete: every story in scope is done or parked.", scoped),
    };
  }

  const ready = await computeReady_(scoped);
  const maxAttempts = Number(config?.budgets?.maxFixRoundsPerStory) || 3;
  const eligible = ready.filter((s) => attemptsFor(state, s.id) < maxAttempts);

  if (ready.length > 0 && eligible.length === 0) {
    unlinkSync(loopStatePath(root));
    return {
      decision: "allow",
      summary: endSummary(`Every ready story has hit the per-story attempt budget (${maxAttempts}).`, scoped),
    };
  }
  if (eligible.length === 0) return { decision: "allow", summary: waitingSummary(open) };

  const next = eligible[0];
  bump(root, state, next.id);
  return {
    decision: "block",
    reason: buildBlockReason(next, await readLearnings_(), state),
    systemMessage: `story ${next.id} · iteration ${state.iteration}/${state.max_iterations}`,
  };
}

// ------------------------------------------------------------- CLI surface

// Shape a tick result into Stop-hook JSON (research-plugin-system.md §4):
//   block -> {"decision":"block","reason":…,"systemMessage":…}
//   allow -> {"systemMessage": summary} | {}
export function toHookOutput(result) {
  if (result.decision === "block") {
    const out = { decision: "block", reason: result.reason };
    if (result.systemMessage) out.systemMessage = result.systemMessage;
    return out;
  }
  return result.summary ? { systemMessage: result.summary } : {};
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// story loop start|status|stop|tick|learn — the engine behind cli.mjs's cmdLoop
// (step 6). Takes the already-parsed {positionals, flags} (cli.mjs's parseArgv
// is the single parser for the whole CLI — this used to re-parse a re-serialized
// argv with a weaker local parser that mishandled --key=value and list flags).
// Throws CliError (util.mjs) so cli.mjs's main() formats failures as
// {"error"} on stderr, exit 1 — the section-B convention.
// opts.root is REQUIRED in production (cmdLoop passes findRoot(ctx.cwd, ctx.exec),
// which resolves the MAIN checkout even from inside a story worktree); the
// process.cwd() fallback exists for tests only.
// opts.stdinText and opts.tickDeps exist for tests; production passes neither.
export async function runLoopCommand({ positionals = [], flags = {} } = {}, opts = {}) {
  const root = opts.root ?? process.cwd();
  const [sub, ...rest] = positionals;

  if (sub === "start") {
    if (existsSync(loopStatePath(root))) throw new CliError("a story loop is already active - run: story loop stop");
    const state = {
      goal: typeof flags.goal === "string" ? flags.goal : "complete all stories",
      session_id: typeof flags.session === "string" ? flags.session : "",
      iteration: 0,
      max_iterations: Number(flags["max-iterations"]) || Number(loadConfig(root)?.budgets?.maxIterations) || 10,
      attempts: {},
    };
    writeLoopState(root, state);
    return { started: true, ...state };
  }

  if (sub === "status") {
    try {
      const state = readLoopState(root);
      return state ? { active: true, ...state } : { active: false };
    } catch {
      return { active: false, corrupt: true };
    }
  }

  if (sub === "stop") {
    if (!existsSync(loopStatePath(root))) return { stopped: false };
    unlinkSync(loopStatePath(root));
    return { stopped: true };
  }

  if (sub === "learn") {
    // The sanctioned learnings writer (design §6): workers run
    // `story loop learn "<one-liner>"` — never hand-edit the .local.md file.
    const text = typeof flags.text === "string" ? flags.text : rest.join(" ");
    if (!text.trim()) throw new CliError('story loop learn needs text: story loop learn "<one-liner>"');
    await appendLearning(root, text);
    return { learned: true };
  }

  if (sub === "tick") {
    if (flags.hook) {
      try {
        const raw = opts.stdinText ?? (await readStdin());
        let sessionId = "";
        try { sessionId = JSON.parse(raw).session_id ?? ""; } catch { /* tolerate garbage stdin */ }
        return toHookOutput(await tick(sessionId, { root, ...(opts.tickDeps ?? {}) }));
      } catch {
        return {}; // a Stop hook must never wedge stopping
      }
    }
    return tick(typeof flags.session === "string" ? flags.session : "", { root, ...(opts.tickDeps ?? {}) });
  }

  throw new CliError(`unknown loop subcommand: ${sub ?? "(none)"}`);
}
