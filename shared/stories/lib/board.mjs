// shared/stories/lib/board.mjs — story file format, ids, schema, readiness.
//
// The frontmatter format is a deliberate YAML *subset*: scalar values,
// flow-style string arrays [a, b], and one-level flow maps {k: v}. It is NOT
// a YAML parser and never will be — the subset is pinned by round-trip tests
// so humans and real YAML tools can read the files, while the plugin stays
// zero-dependency. Body markdown (checkbox sections etc.) is preserved
// byte-for-byte.
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARCHIVE_DIR,
  CliError,
  STATE_DIR,
  configPath,
  nowISO,
  readJson,
  stateStorePath,
  todayISO,
  writeFileAtomic,
  writeJsonAtomic,
} from "./util.mjs";
import { LOCK, withLock } from "./locks.mjs";

// ---------------------------------------------------------------- format

const FIELD_ORDER = [
  "id", "title", "type", "epic", "status", "priority", "complexity", "depends_on",
  "discovered_from", "touches", "exclusive", "gates", "feedback",
  "claim", "pr", "created", "updated",
];

export function parseStory(text, path = "story") {
  if (!text.startsWith("---\n")) throw new CliError(`${path}: missing frontmatter open '---'`);
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) throw new CliError(`${path}: missing frontmatter close '---'`);
  const story = {};
  for (const line of text.slice(4, end + 1).split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):(?:\s(.*))?$/);
    if (!m) throw new CliError(`${path}: unparseable frontmatter line: ${JSON.stringify(line)}`);
    story[m[1]] = parseValue((m[2] ?? "").trim(), path);
  }
  story.body = text.slice(end + 5);
  return story;
}

function parseValue(v, path) {
  if (v === "") return "";
  if (v.startsWith("[")) {
    if (!v.endsWith("]")) throw new CliError(`${path}: unterminated array: ${v}`);
    return splitFlow(v.slice(1, -1)).map(parseScalar);
  }
  if (v.startsWith("{")) {
    if (!v.endsWith("}")) throw new CliError(`${path}: unterminated map: ${v}`);
    const map = {};
    for (const pair of splitFlow(v.slice(1, -1))) {
      const i = pair.indexOf(":");
      if (i === -1) throw new CliError(`${path}: unparseable map entry: ${pair}`);
      map[pair.slice(0, i).trim()] = parseScalar(pair.slice(i + 1).trim());
    }
    return map;
  }
  return parseScalar(v);
}

/** Split a flow-collection body on top-level commas, respecting double quotes. */
function splitFlow(s) {
  if (!s.trim()) return [];
  const parts = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && s[i - 1] !== "\\") inQuote = !inQuote;
    if (ch === "," && !inQuote) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

function parseScalar(s) {
  if (s.startsWith('"')) return JSON.parse(s);
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

export function serializeStory(story) {
  // "routine" is the read-time default (applyDefaults) — omit it from the
  // file so only non-default complexity ever shows up on disk.
  const s = story.complexity === "routine" ? { ...story, complexity: undefined } : story;
  const known = FIELD_ORDER.filter((k) => s[k] !== undefined && s[k] !== null);
  const unknown = Object.keys(s).filter(
    (k) => k !== "body" && k !== "file" && !FIELD_ORDER.includes(k) && s[k] !== undefined && s[k] !== null,
  );
  const lines = [...known, ...unknown].map((k) => `${k}: ${serializeValue(s[k])}`);
  return `---\n${lines.join("\n")}\n---\n${s.body ?? ""}`;
}

function serializeValue(v) {
  if (Array.isArray(v)) return `[${v.map(serializeScalar).join(", ")}]`;
  if (typeof v === "object") {
    return `{${Object.entries(v)
      .map(([k, x]) => `${k}: ${serializeScalar(x)}`)
      .join(", ")}}`;
  }
  return serializeScalar(v);
}

// Quote when a bare rendering would parse back differently (or break the
// line/flow grammar): colon-space, flow/comment/quote characters, commas,
// newlines, leading/trailing space, or a value that reads as bool/null/number.
const NEEDS_QUOTE = /(: )|[,#[\]{}"\n]|^\s|\s$|^(true|false|null|~)$|^-?\d+$/;

function serializeScalar(v) {
  if (typeof v !== "string") return String(v);
  return v === "" || NEEDS_QUOTE.test(v) ? JSON.stringify(v) : v;
}

// ---------------------------------------------------------------- ids

// st- prefix shared by generateId and ID_PATTERN.
export const ID_PREFIX = "st-";

// generateId widens through 2, 3, then 4 random bytes (4/6/8 hex chars),
// retrying ID_ATTEMPTS_PER_WIDTH times at each width before giving up.
const ID_BYTE_WIDTHS = [2, 3, 4];
const ID_ATTEMPTS_PER_WIDTH = 16;

/**
 * Hash-based ids: st-XXXX (4 hex chars), widening to 6 then 8 on collision
 * pressure. Sequential ids collide when stories are created on parallel
 * branches (beads lesson) — random hex does not.
 */
export function generateId(existingIds, rand = randomBytes) {
  const taken = new Set(existingIds);
  for (const bytes of ID_BYTE_WIDTHS) {
    for (let attempt = 0; attempt < ID_ATTEMPTS_PER_WIDTH; attempt++) {
      const id = `${ID_PREFIX}${rand(bytes).toString("hex")}`;
      if (!taken.has(id)) return id;
    }
  }
  throw new CliError("could not generate a unique story id (board too dense — run `story archive`)");
}

// Canonical story-id shape: st- followed by 4–8 hex chars (the width-widening
// generateId space). Reused by doctor's adoptStory; Stage 2 wires this in at
// load time. Kept here so every module validates ids the same way.
export const ID_PATTERN = /^st-[0-9a-f]{4,8}$/;

export function assertValidId(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new CliError(`invalid story id '${id}' — expected st- followed by 4–8 hex chars`);
  }
  return id;
}

// ---------------------------------------------------------------- config

// Defaults merged onto a parsed config.json by normalizeConfig, so downstream
// code reads config.baseBranch / config.merge / config.storiesDir /
// config.gateLock / config.budgets.* without `??` fallbacks scattered around.
export const CONFIG_DEFAULTS = Object.freeze({
  version: 1,
  storiesDir: "stories",
  merge: "self",
  baseBranch: "main",
  gateLock: true,
  budgets: Object.freeze({ maxStalls: 3, maxFixRoundsPerStory: 3 }),
});

export const MERGE_MODES = ["self", "local", "pr"];

/** Merge a raw parsed config onto CONFIG_DEFAULTS, deep-merging `budgets` one level. */
export function normalizeConfig(raw) {
  return { ...CONFIG_DEFAULTS, ...raw, budgets: { ...CONFIG_DEFAULTS.budgets, ...(raw.budgets ?? {}) } };
}

/**
 * Load the marker config (.agents/shousper-stories/config.json), normalized
 * against CONFIG_DEFAULTS. Throws CliError on a missing/corrupt file — the
 * single config reader for the whole plugin (cli.mjs, github.mjs, and
 * loop.mjs all route through this; loop.tick catches the throw so a corrupt
 * config allows-stop rather than crashing the hook).
 */
export function loadConfig(root) {
  try {
    return normalizeConfig(readJson(configPath(root)));
  } catch (err) {
    throw new CliError(`unreadable ${STATE_DIR}/config.json: ${err.message}`);
  }
}

// Execution state (status/claim/feedback/pr) is CLI-owned and LOCAL — it lives
// in <state root>/local/state.json (covered by the local/ ignore line), never
// in the git-replicated story files. Rationale (2026-08-18 incident):
// frontmatter state is copied into every worktree, where `git restore stories/`
// silently wipes claims, uncommitted claims are not durable, and board-file
// merges conflict. Story .md files carry only
// shareable content; this store is the single source of execution truth.
// All access happens under the board lock via loadStories/saveStory callers.

export const STATE_FIELDS = ["status", "claim", "feedback", "pr"];

export function readStateStore(root) {
  const p = stateStorePath(root);
  if (!existsSync(p)) return { version: 1, stories: {} };
  try {
    const store = readJson(p);
    return { version: 1, stories: {}, ...store };
  } catch (err) {
    throw new CliError(`corrupt story state store (${err.message}): ${p}`);
  }
}

export function writeStateStore(root, store) {
  writeJsonAtomic(stateStorePath(root), store);
}

// ---------------------------------------------------------------- schema

export const STATUS = Object.freeze({
  BACKLOG: "backlog",
  TODO: "todo",
  IN_PROGRESS: "in-progress",
  IN_REVIEW: "in-review",
  DONE: "done",
  BLOCKED: "blocked",
});
export const STATUSES = Object.values(STATUS);
export const PRIORITIES = ["P0", "P1", "P2", "P3"];
export const COMPLEXITIES = ["routine", "hard", "frontier"];

export function assertComplexity(v) {
  if (!COMPLEXITIES.includes(v)) {
    throw new CliError(`invalid complexity "${v}" — expected one of: ${COMPLEXITIES.join(", ")}`);
  }
  return v;
}

// Stored-status state machine (design §6). "ready" is computed, never stored.
// done is terminal — no silent reopens; blocked only unparks to todo.
export const LEGAL_TRANSITIONS = {
  [STATUS.BACKLOG]: [STATUS.TODO],
  [STATUS.TODO]: [STATUS.IN_PROGRESS, STATUS.BACKLOG, STATUS.BLOCKED],
  [STATUS.IN_PROGRESS]: [STATUS.IN_REVIEW, STATUS.DONE, STATUS.BLOCKED, STATUS.TODO],
  [STATUS.IN_REVIEW]: [STATUS.DONE, STATUS.IN_PROGRESS, STATUS.BLOCKED],
  [STATUS.BLOCKED]: [STATUS.TODO],
  [STATUS.DONE]: [],
};

export function assertTransition(from, to) {
  if (!STATUSES.includes(to)) throw new CliError(`unknown status '${to}'`);
  if (!(LEGAL_TRANSITIONS[from] ?? []).includes(to)) {
    throw new CliError(`illegal transition ${from} → ${to}`);
  }
}

export function applyDefaults(story) {
  const s = { ...story };
  s.type ??= "feature";
  s.status ??= STATUS.TODO;
  s.priority ??= "P2";
  s.complexity ??= "routine";
  s.depends_on ??= [];
  s.touches ??= [];
  s.exclusive ??= false;
  s.created ??= todayISO();
  s.updated ??= todayISO();
  s.body ??= "";
  if (!STATUSES.includes(s.status)) throw new CliError(`unknown status '${s.status}'`);
  if (!PRIORITIES.includes(s.priority)) {
    throw new CliError(`priority must be one of ${PRIORITIES.join(", ")}, got '${s.priority}'`);
  }
  assertComplexity(s.complexity);
  return s;
}

// The two statuses computeReady treats as "holding" a claim on the board:
// in-progress work and in-review work both keep their touches/diffs live.
export const ACTIVE_STATUSES = new Set([STATUS.IN_PROGRESS, STATUS.IN_REVIEW]);
export const isActive = (story) => ACTIVE_STATUSES.has(story.status);

// ---------------------------------------------------------------- board io

const SLUG_MAX = 40;

export function slugify(title) {
  return (
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX)
      .replace(/-+$/, "") || "story"
  );
}

export function storiesDir(root, config) {
  return join(root, config.storiesDir);
}

export function archiveDir(root, config) {
  return join(storiesDir(root, config), ARCHIVE_DIR);
}

/**
 * Absolute, sorted paths of every non-template story .md file directly under
 * `dir` (files starting with "_" are templates). Empty array when `dir` is
 * missing. The single directory-listing filter — doctor's raw-story pass
 * shares it so the two board walks never drift apart.
 */
export function storyFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Overlay the state store's entry for `story.id` onto a freshly-parsed story
 * (mutates and returns it). The store is the source of truth for execution
 * state; frontmatter state is only a pre-migration fallback. A story with
 * state in neither place is a fresh/hand-dropped file — treat as todo.
 */
export function overlayState(story, stateStories) {
  Object.assign(story, stateStories[story.id]);
  story.status ??= STATUS.TODO;
  return story;
}

/**
 * Load every story on the board. Files starting with "_" (templates) are
 * skipped; the archive/ subdir is included only on request (deps of active
 * stories may point at archived-done stories).
 * Attaches a runtime-only `file` property (never serialized).
 *
 * SECURITY: a story `id` read from a .md file flows straight into filesystem
 * paths (worktreePath, evidenceDir, verdictPath) and git refs (branchName), so
 * a malformed id like '../../../tmp/evil' would escape the project. Story files
 * are lower-trust (they arrive via branches/PRs/clones; the PreToolUse guard is
 * in-session only), so ids are shape-validated at THIS load boundary. A story
 * whose id fails assertValidId is SKIPPED — never returned — so it can never
 * reach a path builder; `story doctor` reports it as an `invalid-id` issue.
 * (A single malformed story must not crash the whole loop, hence skip, not
 * throw. `getStory` still throws for a specifically-requested bad id.)
 */
export function loadStories(root, config, { includeArchive = false } = {}) {
  const dirs = [storiesDir(root, config)];
  if (includeArchive) dirs.push(archiveDir(root, config));
  const state = readStateStore(root).stories;
  const stories = [];
  for (const dir of dirs) {
    for (const file of storyFiles(dir)) {
      const story = { ...parseStory(readFileSync(file, "utf8"), file), file };
      if (!ID_PATTERN.test(story.id)) continue; // malformed id → skip; doctor surfaces it
      // read-time default/repair — omitted on disk when routine (serializeStory);
      // an out-of-range value (hand-edited or malicious) is coerced here too, since
      // this value drives stories:work's planner model/effort pick. `story doctor`
      // reports+repairs the on-disk file separately (see adoptStory).
      if (!COMPLEXITIES.includes(story.complexity)) story.complexity = "routine";
      stories.push(overlayState(story, state));
    }
  }
  return stories;
}

/** Atomic write; new stories are named <id>-<slug>.md under storiesDir.
 *  Execution state never reaches the .md file: it is split into the state
 *  store (absent/null state fields clear the store entry — a story whose
 *  every state field is default-only still records status, the store is
 *  the source of truth once a story has been saved). */
export function saveStory(root, config, story) {
  const file = story.file ?? join(storiesDir(root, config), `${story.id}-${slugify(story.title)}.md`);
  const content = { ...story };
  const entry = {};
  for (const k of STATE_FIELDS) {
    if (content[k] !== undefined && content[k] !== null) entry[k] = content[k];
    delete content[k];
  }
  const store = readStateStore(root); // read before mutating the .md file: a corrupt/unreadable
  // store must abort the save before any on-disk mutation, so the old .md content (and its state
  // fields, for unmigrated stories) survives as a recovery fallback.
  writeFileAtomic(file, serializeStory(content));
  store.stories[story.id] = entry;
  writeStateStore(root, store);
  return { ...story, file };
}

export function getStory(stories, id) {
  assertValidId(id); // reject a malformed requested id before it reaches any path builder
  const found = stories.find((s) => s.id === id);
  if (!found) throw new CliError(`no story '${id}'`);
  return found;
}

/** Load the board and look up `id` in one call — the common read-only lookup shape. */
export function findStory(root, config, id, opts) {
  return getStory(loadStories(root, config, opts), id);
}

/** The `pr.number` frontmatter field, coerced to a Number, or null when absent/invalid. */
export function prNumber(story) {
  return Number(story.pr?.number) || null;
}

/**
 * Board-locked read-modify-write on one story. Loads the board fresh under the
 * lock, hands fn a COPY (fn edits it or returns a replacement), stamps
 * `updated`, then saves. `heartbeat: true` also refreshes claim.lease — worker
 * mutations (cli.mjs's mutateStory) are heartbeats; sweep mutations
 * (github.mjs's mutateBoard) are NOT. The single lock+load+copy+stamp+save
 * skeleton both call sites share.
 */
export async function mutateStory(root, config, id, fn, { heartbeat = false } = {}) {
  return withLock(root, LOCK.BOARD, () => {
    const story = { ...getStory(loadStories(root, config), id) };
    const next = fn(story, config, root) ?? story;
    next.updated = todayISO();
    if (heartbeat && next.claim) next.claim = { ...next.claim, lease: nowISO() };
    return saveStory(root, config, next);
  });
}

/** Transition to done, clearing claim/feedback (mutateStory stamps `updated`). */
export function closeStory(story) {
  assertTransition(story.status, STATUS.DONE);
  const next = { ...story, status: STATUS.DONE };
  delete next.claim;
  delete next.feedback;
  return next;
}

/** Transition to blocked: clear the claim and record `question` in the Questions section. */
export function parkStory(story, question) {
  assertTransition(story.status, STATUS.BLOCKED);
  const next = { ...story, status: STATUS.BLOCKED, body: appendQuestion(story.body, question) };
  delete next.claim;
  return next;
}

/** Release a claim by transitioning to `to` (doctor's reclaim-to-todo / reclaim-to-in-review). */
export function releaseClaim(story, to) {
  assertTransition(story.status, to);
  const next = { ...story, status: to };
  delete next.claim;
  return next;
}

// ---------------------------------------------------------------- body sections

// Canonical "## Heading" forms — every section function below takes one of
// these (or an equivalent full heading string) as its `heading` argument.
export const SECTIONS = Object.freeze({
  DESCRIPTION: "## Description",
  ACCEPTANCE: "## Acceptance Criteria",
  PLAN: "## Implementation Plan",
  NOTES: "## Implementation Notes",
  QUESTIONS: "## Questions",
});

const ensureTrailingNewline = (s) => s.replace(/\n*$/, "\n");

/**
 * Locate `heading` in `lines` and the boundary before the next "## " heading
 * (or end of body). Returns { start, end } (line indices into `lines`), or
 * null when `heading` is absent. The single "next '## ' heading" scan —
 * readBodySection, appendToSection, setSection, and getSection all resolve
 * their section boundary through this.
 */
function sectionBounds(lines, heading, { caseInsensitive = false } = {}) {
  const target = caseInsensitive ? heading.toLowerCase() : heading;
  const matches = (l) => (caseInsensitive ? l.trim().toLowerCase() : l.trim()) === target;
  const start = lines.findIndex(matches);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end])) end++;
  return { start, end };
}

/**
 * Read the body of the `heading` section, case-INSENSITIVELY, stopping at the
 * next "## " heading. Returns "" for a missing section or empty body.
 * `heading` is the full "## Acceptance Criteria" form (see SECTIONS). The
 * single body-section reader — PR-body and loop-reprompt builders share it so
 * a '## acceptance criteria' heading is never silently skipped by one path.
 */
export function readBodySection(body, heading) {
  const lines = String(body ?? "").split("\n");
  const bounds = sectionBounds(lines, heading, { caseInsensitive: true });
  if (!bounds) return "";
  return lines.slice(bounds.start + 1, bounds.end).join("\n").trim();
}

/**
 * Append `entry` at the end of the `heading` section (before the next "## "),
 * creating the section at the end of the body when missing. Never touches
 * other sections — append-only implementation logs (task-master lesson).
 * `heading` is the full "## Implementation Notes" form.
 */
export function appendToSection(body, heading, entry) {
  const lines = body.split("\n");
  const bounds = sectionBounds(lines, heading);
  if (!bounds) return `${ensureTrailingNewline(body)}\n${heading}\n\n${entry}\n`;
  let insertAt = bounds.start + 1;
  for (let i = bounds.start + 1; i < bounds.end; i++) {
    if (lines[i].trim() !== "") insertAt = i + 1;
  }
  lines.splice(insertAt, 0, ...(insertAt === bounds.start + 1 ? ["", entry] : [entry]));
  return lines.join("\n");
}

/**
 * REPLACE the entire content of the `heading` section (or create the section
 * at the end when missing). The sanctioned writer of a story's
 * '## Implementation Plan' section: `story update <id> --plan-file <file>`
 * (the PreToolUse guard denies direct edits of story files).
 * `heading` is the full "## Implementation Plan" form.
 */
export function setSection(body, heading, content) {
  const block = [heading, "", ...String(content).split("\n"), ""];
  const lines = body.split("\n");
  const bounds = sectionBounds(lines, heading);
  if (!bounds) return ensureTrailingNewline(`${ensureTrailingNewline(body)}\n${block.join("\n")}`);
  lines.splice(bounds.start, bounds.end - bounds.start, ...block);
  return ensureTrailingNewline(lines.join("\n"));
}

/**
 * READ the content of the `heading` section (or null when the heading is
 * absent), trimmed. Symmetric with setSection's parsing: same exact-match
 * heading line, same "next '## ' heading or end of body" boundary.
 * `heading` is the full "## Implementation Plan" form.
 */
export function getSection(body, heading) {
  const lines = String(body ?? "").split("\n");
  const bounds = sectionBounds(lines, heading);
  if (!bounds) return null;
  return lines.slice(bounds.start + 1, bounds.end).join("\n").trim();
}

/** Format a timestamped log entry: "- <ISO timestamp>: <text>" (the note/question line shape). */
export function noteEntry(text) {
  return `- ${nowISO()}: ${text}`;
}

/** Append a timestamped `text` entry to the Implementation Notes section. */
export function appendNote(body, text) {
  return appendToSection(body, SECTIONS.NOTES, noteEntry(text));
}

/** Append a timestamped `text` entry to the Questions section. */
export function appendQuestion(body, text) {
  return appendToSection(body, SECTIONS.QUESTIONS, noteEntry(text));
}

// ---------------------------------------------------------------- readiness

/**
 * Conservative glob overlap between two path patterns (either side may be a
 * literal path or contain * / **). "Possible overlap counts as overlap":
 *   - ** matches the rest of any path
 *   - a segment containing * matches any single segment
 *   - one pattern being a segment-prefix of the other counts as overlap
 *     (a declared dir literal like "src" must block "src/deep/x.ts")
 * touches is a scheduler HINT that reduces conflict probability; correctness
 * always comes from merge-conflict handling + gates + review (design §7).
 */
export function patternsOverlap(a, b) {
  const as = String(a).split("/");
  const bs = String(b).split("/");
  for (let i = 0; ; i++) {
    const x = as[i];
    const y = bs[i];
    if (x === "**" || y === "**") return true;
    if (x === undefined || y === undefined) return true; // both done, or prefix
    if (x !== y && !x.includes("*") && !y.includes("*")) return false;
  }
}

export function touchesOverlap(a, b) {
  return a.some((x) => b.some((y) => patternsOverlap(x, y)));
}

/**
 * The claim-safe workable set. Pure — never touches the filesystem; callers
 * pass actual worktree diffs via opts.diffs (Map<storyId, string[]>).
 *
 * ready = status todo ∧ all depends_on done ∧ unclaimed
 *         ∧ touches disjoint from every active story's (declared ∪ actual diff)
 *         ∧ exclusive semantics
 * plus feedback items (in-review + feedback: true + unclaimed), ranked first.
 * Ordering: feedback first, then priority P0→P3, then id.
 */
export function computeReady(stories, opts = {}) {
  const diffs = opts.diffs ?? new Map();
  const byId = new Map(stories.map((s) => [s.id, s]));
  const active = stories.filter(isActive);
  const held = active.flatMap((s) => [...(s.touches ?? []), ...(diffs.get(s.id) ?? [])]);
  const exclusiveActive = active.some((s) => s.exclusive === true);

  const feedback = stories.filter(
    (s) =>
      s.status === STATUS.IN_REVIEW &&
      s.feedback === true &&
      !s.claim &&
      (!exclusiveActive || s.exclusive === true),
  );

  const todo = stories.filter((s) => {
    if (s.status !== STATUS.TODO || s.claim) return false;
    if (!(s.depends_on ?? []).every((d) => byId.get(d)?.status === STATUS.DONE)) return false;
    if (exclusiveActive) return false;
    if (s.exclusive === true) return active.length === 0;
    return !touchesOverlap(s.touches ?? [], held);
  });

  const rank = (s) => PRIORITIES.indexOf(s.priority ?? "P2");
  const cmp = (a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return [...feedback.sort(cmp), ...todo.sort(cmp)];
}
