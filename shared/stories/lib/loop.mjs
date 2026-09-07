// Loop state, turn-end tick decisions, and shared learnings for the stories plugin.
//
// State files : <state root>/local/loop.<session>.md — one per session, PER-SESSION
//               (YAML-subset frontmatter via the board's parseStory/serializeStory;
//               atomic via writeFileAtomic). A loop is bound to the session that
//               started it and re-prompts only that session — the 2026-08-18
//               incident was a shared file letting the first session to stop
//               adopt another session's loop.
// Learnings   : <state root>/local/learnings.md (append-only under the "learnings" lock)
// Decisions   : tick() returns {decision: "allow"|"block", reason?, status?, summary?} —
//               the neutral contract both harness adapters shape into their own
//               stop/block conventions.
//
// Import discipline: this module may import board/locks/util/worktrees/doctor
// but NEVER cli.mjs — cli.mjs statically imports loop.mjs for the `loop`
// subcommand (C6), so a back-import would be a static cycle.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { CONFIG_DEFAULTS, ID_PREFIX, SECTIONS, STATUS, computeReady, isActive, loadConfig, loadStories, parseStory, readBodySection, serializeStory } from "./board.mjs";
import { AUTOFIX_KINDS, runDoctor } from "./doctor.mjs";
import { LOCK, withLock } from "./locks.mjs";
import { CliError, LOOP_STATE_FILE_RE, learningsPath, loopStatePath, localDir, writeFileAtomic } from "./util.mjs";
import { activeDiffs } from "./worktrees.mjs";

// Per-session loop state: <state root>/local/loop.<session>.md — covered by
// the local/ ignore line. loopStatePath/learningsPath/LOOP_STATE_FILE_RE live
// in util.mjs, the dependency leaf, so board.mjs/locks.mjs/loop.mjs/doctor.mjs
// share one spelling.

// Every per-session loop file currently on disk.
export function listLoopStates(root) {
  const dir = localDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => LOOP_STATE_FILE_RE.test(n))
    .map((n) => join(dir, n));
}

// ---------------------------------------------------------------- loop state

// The state file reuses the board's frontmatter format: every loop-state key is
// "unknown" to serializeStory's FIELD_ORDER (they serialize after the — absent —
// known fields, in insertion order), and parseStory hands them back typed:
// numbers stay numbers, the attempts one-level flow map stays a map.

const DEFAULT_GOAL = "complete all stories";
const LEARNINGS_TAIL_ENTRIES = 5;
const LEARNINGS_TAIL_CHARS = 2000;
const MARKER_HEX_LEN = 16;

function parseLoopStateFile(p) {
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
    goal: s.goal || DEFAULT_GOAL,
    session_id: s.session_id ? String(s.session_id) : "",
    iteration: Number(s.iteration) || 0,
    stalls: Number(s.stalls) || 0,
    max_stalls: Number(s.max_stalls) || CONFIG_DEFAULTS.budgets.maxStalls,
    progress_marker: s.progress_marker ? String(s.progress_marker) : "",
    attempts,
  };
}

export function readLoopState(root, sessionId) {
  const p = loopStatePath(root, sessionId);
  if (!existsSync(p)) return null;
  return parseLoopStateFile(p);
}

// state.session_id is required — it is the ONLY thing that determines which
// file this write lands in (ownership binds at start, never later).
export function writeLoopState(root, state) {
  const record = {
    goal: state.goal,
    session_id: state.session_id,
    iteration: state.iteration,
    stalls: state.stalls ?? 0,
    max_stalls: state.max_stalls ?? CONFIG_DEFAULTS.budgets.maxStalls,
    body: "",
  };
  if (state.progress_marker) record.progress_marker = state.progress_marker;
  if (Object.keys(state.attempts ?? {}).length > 0) record.attempts = state.attempts;
  writeFileAtomic(loopStatePath(root, state.session_id), serializeStory(record)); // temp+rename: atomic, creates local/
}

/**
 * Fingerprint of the board's status vector. Any story claimed, closed, parked,
 * flagged, or filed changes it; a tick that sees the same marker as the last
 * one made no progress. Prefixed so the frontmatter parser never reads it as
 * a number.
 */
export function progressMarker(stories) {
  const rows = stories.map((s) => `${s.id}:${s.status}:${s.feedback === true ? 1 : 0}`).sort();
  return `m${createHash("sha1").update(rows.join("\n")).digest("hex").slice(0, MARKER_HEX_LEN)}`;
}

// ----------------------------------------------------------- shared learnings

export async function appendLearning(root, text, opts = {}) {
  const now = opts.now ?? (() => new Date());
  await withLock(root, LOCK.LEARNINGS, () => {
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
  const excerpt = entries.slice(-(opts.maxEntries ?? LEARNINGS_TAIL_ENTRIES)).join("").trim();
  const maxChars = opts.maxChars ?? LEARNINGS_TAIL_CHARS;
  return excerpt.length > maxChars ? excerpt.slice(-maxChars) : excerpt;
}

// -------------------------------------------------- story body & goal helpers

// goal: "complete all stories" (default) | "epic:st-XXXX" | "st-1 st-2, st-3".
// Free text falls back to the whole board.
const EPIC_PREFIX = "epic:";

export function scopeStories(stories, goal) {
  const g = String(goal ?? "").trim();
  if (!g || g === DEFAULT_GOAL) return stories;
  if (g.startsWith(EPIC_PREFIX)) {
    const epic = g.slice(EPIC_PREFIX.length).trim();
    return stories.filter((s) => s.epic === epic || s.id === epic);
  }
  const ids = g.split(/[\s,]+/).filter((w) => w.startsWith(ID_PREFIX));
  if (ids.length === 0) return stories;
  return stories.filter((s) => ids.includes(s.id));
}

// High-signal re-prompt (Geocodio pattern): the specific next story + its
// verifiable acceptance criteria + accumulated learnings — never "keep going".
export function buildBlockReason(story, learnings, state) {
  return [
    `Story loop iteration ${state.iteration} (stalls ${state.stalls}/${state.max_stalls}) - the goal is not complete. Work exactly one story now:`,
    "",
    `${story.id} - ${story.title}`,
    "",
    "Acceptance criteria:",
    readBodySection(story.body, SECTIONS.ACCEPTANCE) || "(none recorded - treat the Description section as the contract)",
    "",
    `You are the worker session bound to this loop. Claim it with: story claim ${story.id}, then follow the stories:work iteration procedure exactly (dispatch planner → kit:build-flow inside the worktree → commit → story done ${story.id}). If the stories:work skill is not in context, invoke it first.`,
    `Blocked on a human decision? story park ${story.id} --question "..." and pick up the next story.`,
    "",
    "Learnings from previous iterations:",
    (learnings ?? "").trim() || "(none yet)",
  ].join("\n");
}

// --------------------------------------------------------- summaries + tick

const indent = (t) => t.split("\n").map((l) => `  ${l}`).join("\n");
const statusLine = (what, state) => `${what} · iteration ${state.iteration} · stalls ${state.stalls}/${state.max_stalls}`;

function endSummary(headline, stories) {
  const done = stories.filter((s) => s.status === STATUS.DONE).length;
  const parked = stories.filter((s) => s.status === STATUS.BLOCKED);
  const lines = [
    `Story loop finished. ${headline}`,
    `Board: ${done}/${stories.length} in scope done, ${parked.length} parked.`,
  ];
  for (const s of parked) {
    const q = readBodySection(s.body, SECTIONS.QUESTIONS);
    lines.push(`- ${s.id} ${s.title} - PARKED${q ? `:\n${indent(q)}` : " (no question recorded)"}`);
  }
  if (parked.length > 0) {
    lines.push("Parked stories need a human decision - answer the question, then: story update <id> --status todo");
  }
  return lines.join("\n");
}

function waitingSummary(open, state) {
  const held = open.filter(isActive);
  return [
    "Story loop idle: nothing is claimable right now.",
    ...held.map((s) => `- ${s.id} ${s.title} (${s.status})`),
    `It resumes when a story becomes ready (review lands, claim released, or dependency completes), but this tick still counts against the stall budget (stalls ${state.stalls}/${state.max_stalls}) and the run ends if the board stays this way that long.`,
  ].join("\n");
}

function attemptsFor(state, id) { return Number(state.attempts?.[id]) || 0; }

// Iteration/attempt increments go through writeLoopState (temp+rename): atomic.
function bump(root, state, storyId) {
  state.iteration += 1;
  if (storyId) state.attempts = { ...state.attempts, [storyId]: attemptsFor(state, storyId) + 1 };
  writeLoopState(root, state);
}

// Stall accounting. Progress is any change in the board's status vector (a
// story claimed, closed, parked, or filed anywhere on the board); a tick that
// sees the same board as the previous one is a stall, and enough stalls in a
// row end the run. Returns true when the budget is spent; the caller ends the
// run. Called from every path that ends a turn without landing a story —
// the healthy path, idle waits, and doctor-repair blocks alike — so an
// unattended run that keeps ending turns with nothing changing terminates.
function recordStall(root, state, all) {
  const marker = progressMarker(all);
  state.stalls = state.progress_marker && marker === state.progress_marker ? state.stalls + 1 : 0;
  state.progress_marker = marker;
  writeLoopState(root, state);
  return state.stalls >= state.max_stalls;
}

function stallExhausted(root, state, scoped) {
  unlinkSync(loopStatePath(root, state.session_id));
  return {
    decision: "allow",
    summary: endSummary(`Stall budget exhausted (${state.stalls} consecutive ticks without board progress).`, scoped),
  };
}

// The turn-end decision engine (design §10). All collaborators injectable for tests.
export async function tick(sessionId, opts = {}) {
  const root = opts.root ?? process.cwd();
  // A corrupt/unreadable config means there is no drivable loop — the tick
  // must NOT hard-crash on it (that would wedge every turn end) and must NOT proceed
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
    withLock(root, LOCK.BOARD, () =>
      runDoctor(root, config, {
        fix: true,
        kinds: AUTOFIX_KINDS,
      })));

  let state;
  try {
    state = readLoopState(root, sessionId);
  } catch {
    unlinkSync(loopStatePath(root, sessionId));
    return {
      decision: "allow",
      summary: 'Story loop state file was corrupt and has been removed. Restart with: story loop start --goal "..."',
    };
  }
  if (!state) return { decision: "allow" };
  // Ownership is assigned at start, NEVER at tick: adopting the first session
  // that stops was the 2026-08-18 incident — a planning session captured the
  // worker's loop. The state file is already session-scoped by path, but keep
  // this check as a defensive belt-and-braces guard against sanitize collisions.
  if (!state.session_id || state.session_id !== sessionId) return { decision: "allow" };

  // The state store (<state root>/local/state.json) is now the single
  // dependency of loadStories/saveStory for EVERY story — unlike the old
  // per-file frontmatter, a corrupt store breaks every story at once, not
  // just one .md file. Give it the same explicit, actionable handling
  // loadConfig gets above: allow-stop with a clear reason, never a silent
  // no-op via the generic hook-mode catch-all in runLoopCommand.
  let report, all, scoped;
  try {
    report = await doctor_(); // auto-fixes land first, then the board is read
    all = await loadStories_();
    scoped = scopeStories(all, state.goal);
  } catch (err) {
    return { decision: "allow", summary: `Story loop cannot run: ${err.message}. Run: story doctor` };
  }

  const hard = (report.issues ?? []).filter((i) => i.hard).map((i) => i.detail ?? i.kind);
  if (hard.length > 0) {
    // A repair block is a turn that landed nothing: it burns the stall budget
    // like any other, so an unrepairable board ends the run instead of
    // re-prompting forever.
    state.iteration += 1;
    if (recordStall(root, state, all)) return stallExhausted(root, state, scoped);
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
      status: statusLine("story doctor", state),
    };
  }

  const open = scoped.filter((s) => s.status !== STATUS.DONE && s.status !== STATUS.BLOCKED);
  if (open.length === 0) {
    unlinkSync(loopStatePath(root, state.session_id));
    return {
      decision: "allow",
      summary: endSummary("Goal complete: every story in scope is done or parked.", scoped),
    };
  }

  // Event-driven continuation: a story already claimed by THIS session is in
  // flight — its background workflow's completion notification re-invokes the
  // session, so the tick must neither prompt the NEXT story (the half-built-
  // story steal) nor block-nag (which forces completion polling). Quiet allow;
  // the loop resumes when the claim clears (done or park). A dead session's
  // claim is reclaimed by the doctor's stale-lease backstop as before. This
  // check runs BEFORE stall accounting: a hold is active work, not a stall,
  // and must never burn the stall budget while the session's own story sits
  // in flight (a board that only changes when someone else moves would
  // otherwise look identical to a genuinely dead run).
  const inFlight = scoped.find((s) => s.status === STATUS.IN_PROGRESS && s.claim?.session === sessionId);
  if (inFlight) {
    return {
      decision: "allow",
      summary: [
        `Story loop holding: ${inFlight.id} is in flight in this session — the loop resumes when it closes (story done ${inFlight.id}) or parks.`,
        `If nothing is actually running for it, resume work on it now, or release it: story update ${inFlight.id} --status todo`,
      ].join("\n"),
    };
  }

  // Idle waits count as stalls too; only the in-flight hold above is exempt.
  if (recordStall(root, state, all)) return stallExhausted(root, state, scoped);

  const ready = await computeReady_(scoped);
  const maxAttempts = config.budgets.maxFixRoundsPerStory;
  const eligible = ready.filter((s) => attemptsFor(state, s.id) < maxAttempts);

  if (ready.length > 0 && eligible.length === 0) {
    unlinkSync(loopStatePath(root, state.session_id));
    return {
      decision: "allow",
      summary: endSummary(`Every ready story has hit the per-story attempt budget (${maxAttempts}).`, scoped),
    };
  }
  if (eligible.length === 0) return { decision: "allow", summary: waitingSummary(open, state) };

  const next = eligible[0];
  bump(root, state, next.id);
  return {
    decision: "block",
    reason: buildBlockReason(next, await readLearnings_(), state),
    status: statusLine(`story ${next.id}`, state),
  };
}

// ------------------------------------------------------------- CLI surface

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
// Trimmed --session flag, or "" when absent/blank.
function sessionFlag(flags) {
  return typeof flags.session === "string" && flags.session.trim() ? flags.session.trim() : "";
}

export async function runLoopCommand({ positionals = [], flags = {} } = {}, opts = {}) {
  const root = opts.root ?? process.cwd();
  const [sub, ...rest] = positionals;

  if (sub === "start") {
    const session = sessionFlag(flags);
    if (!session) {
      throw new CliError(
        "story loop start requires a session id — pass --session <id> or run through the harness adapter, which sets STORY_SESSION_ID",
      );
    }
    if (existsSync(loopStatePath(root, session))) {
      throw new CliError("a story loop is already active for this session - run: story loop stop");
    }
    const state = {
      goal: typeof flags.goal === "string" ? flags.goal : DEFAULT_GOAL,
      session_id: session,
      iteration: 0,
      stalls: 0,
      max_stalls: Number(flags["max-stalls"]) || loadConfig(root).budgets.maxStalls,
      progress_marker: "",
      attempts: {},
    };
    writeLoopState(root, state);
    return { started: true, ...state };
  }

  if (sub === "status") {
    const session = sessionFlag(flags);
    if (session) {
      try {
        const state = readLoopState(root, session);
        return state ? { active: true, ...state } : { active: false };
      } catch {
        return { active: false, corrupt: true };
      }
    }
    // No session: list every active loop on the board (design intent — a
    // human/planner checking overall progress, not one worker's own loop).
    const loops = [];
    for (const p of listLoopStates(root)) {
      try { loops.push(parseLoopStateFile(p)); } catch { /* skip corrupt entries in the list view */ }
    }
    return { active: loops.length > 0, loops };
  }

  if (sub === "stop") {
    if (flags.all) {
      const files = listLoopStates(root);
      for (const p of files) unlinkSync(p);
      return { stopped: files.length > 0 };
    }
    const session = sessionFlag(flags);
    if (!session) {
      throw new CliError("story loop stop requires --session <id> (or --all to stop every loop)");
    }
    const p = loopStatePath(root, session);
    if (!existsSync(p)) return { stopped: false };
    unlinkSync(p);
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
    const session = sessionFlag(flags);
    try {
      return await tick(session, { root, ...(opts.tickDeps ?? {}) });
    } catch (err) {
      // A turn-end hook must never wedge stopping: an unexpected throw allows.
      return { decision: "allow", summary: `Story loop tick failed: ${err.message}` };
    }
  }

  throw new CliError(`unknown loop subcommand: ${sub ?? "(none)"}`);
}
