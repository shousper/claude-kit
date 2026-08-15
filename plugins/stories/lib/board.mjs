// plugins/stories/lib/board.mjs — story file format, ids, schema, readiness.
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
import { CliError, nowISO, todayISO, writeFileAtomic } from "./util.mjs";
import { withLock } from "./locks.mjs";

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

/**
 * Hash-based ids: st-XXXX (4 hex chars), widening to 6 then 8 on collision
 * pressure. Sequential ids collide when stories are created on parallel
 * branches (beads lesson) — random hex does not.
 */
export function generateId(existingIds, rand = randomBytes) {
  const taken = new Set(existingIds);
  for (const bytes of [2, 3, 4]) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const id = `st-${rand(bytes).toString("hex")}`;
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

/**
 * Load .claude/story-workflow.json. Throws CliError on a missing/corrupt file
 * — the single config reader for the whole plugin (cli.mjs, github.mjs, and
 * loop.mjs all route through this; loop.tick catches the throw so a corrupt
 * config allows-stop rather than crashing the hook).
 */
export function loadConfig(root) {
  try {
    return JSON.parse(readFileSync(join(root, ".claude", "story-workflow.json"), "utf8"));
  } catch (err) {
    throw new CliError(`unreadable .claude/story-workflow.json: ${err.message}`);
  }
}

// ---------------------------------------------------------------- schema

export const STATUSES = ["backlog", "todo", "in-progress", "in-review", "done", "blocked"];
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
  backlog: ["todo"],
  todo: ["in-progress", "backlog", "blocked"],
  "in-progress": ["in-review", "done", "blocked", "todo"],
  "in-review": ["done", "in-progress", "blocked"],
  blocked: ["todo"],
  done: [],
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
  s.status ??= "todo";
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

// ---------------------------------------------------------------- board io

export function slugify(title) {
  return (
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "story"
  );
}

export function storiesDir(root, config) {
  return join(root, config.storiesDir ?? "stories");
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
  if (includeArchive) dirs.push(join(storiesDir(root, config), "archive"));
  const stories = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".md") || name.startsWith("_")) continue;
      const file = join(dir, name);
      const story = { ...parseStory(readFileSync(file, "utf8"), file), file };
      if (!ID_PATTERN.test(story.id)) continue; // malformed id → skip; doctor surfaces it
      // read-time default/repair — omitted on disk when routine (serializeStory);
      // an out-of-range value (hand-edited or malicious) is coerced here too, since
      // this value drives stories:work's planner model/effort pick. `story doctor`
      // reports+repairs the on-disk file separately (see adoptStory).
      if (!COMPLEXITIES.includes(story.complexity)) story.complexity = "routine";
      stories.push(story);
    }
  }
  return stories;
}

/** Atomic write; new stories are named <id>-<slug>.md under storiesDir. */
export function saveStory(root, config, story) {
  const file = story.file ?? join(storiesDir(root, config), `${story.id}-${slugify(story.title)}.md`);
  writeFileAtomic(file, serializeStory(story));
  return { ...story, file };
}

export function getStory(stories, id) {
  assertValidId(id); // reject a malformed requested id before it reaches any path builder
  const found = stories.find((s) => s.id === id);
  if (!found) throw new CliError(`no story '${id}'`);
  return found;
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
  return withLock(root, "board", () => {
    const story = { ...getStory(loadStories(root, config), id) };
    const next = fn(story, config, root) ?? story;
    next.updated = todayISO();
    if (heartbeat && next.claim) next.claim = { ...next.claim, lease: nowISO() };
    return saveStory(root, config, next);
  });
}

// ---------------------------------------------------------------- body sections

/**
 * Read the body of the `## <heading>` section, case-INSENSITIVELY, stopping at
 * the next "## " heading. Returns "" for a missing section or empty body.
 * `heading` is the bare text ("Acceptance Criteria"), NOT prefixed with "## ".
 * The single body-section reader — PR-body and loop-reprompt builders share it
 * so a '## acceptance criteria' heading is never silently skipped by one path.
 */
export function readBodySection(body, heading) {
  const lines = String(body ?? "").split("\n");
  const target = `## ${heading}`.toLowerCase();
  const start = lines.findIndex((l) => l.trim().toLowerCase() === target);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return rest.slice(0, end === -1 ? rest.length : end).join("\n").trim();
}

/**
 * Append `entry` at the end of the `heading` section (before the next "## "),
 * creating the section at the end of the body when missing. Never touches
 * other sections — append-only implementation logs (task-master lesson).
 * `heading` is the full "## Implementation Notes" form.
 */
export function appendToSection(body, heading, entry) {
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => l.trim() === heading);
  if (idx === -1) return `${body.replace(/\n*$/, "\n")}\n${heading}\n\n${entry}\n`;
  let insertAt = idx + 1;
  for (let i = idx + 1; i < lines.length && !lines[i].startsWith("## "); i++) {
    if (lines[i].trim() !== "") insertAt = i + 1;
  }
  lines.splice(insertAt, 0, ...(insertAt === idx + 1 ? ["", entry] : [entry]));
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
  const idx = lines.findIndex((l) => l.trim() === heading);
  if (idx === -1) return `${body.replace(/\n*$/, "\n")}\n${block.join("\n")}`.replace(/\n*$/, "\n");
  let end = idx + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end++;
  lines.splice(idx, end - idx, ...block);
  return lines.join("\n").replace(/\n*$/, "\n");
}

/**
 * READ the content of the `heading` section (or null when the heading is
 * absent), trimmed. Symmetric with setSection's parsing: same exact-match
 * heading line, same "next '## ' heading or end of body" boundary.
 * `heading` is the full "## Implementation Plan" form.
 */
export function getSection(body, heading) {
  const lines = String(body ?? "").split("\n");
  const idx = lines.findIndex((l) => l.trim() === heading);
  if (idx === -1) return null;
  let end = idx + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end++;
  return lines.slice(idx + 1, end).join("\n").trim();
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

const ACTIVE_STATUSES = new Set(["in-progress", "in-review"]);

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
  const active = stories.filter((s) => ACTIVE_STATUSES.has(s.status));
  const held = active.flatMap((s) => [...(s.touches ?? []), ...(diffs.get(s.id) ?? [])]);
  const exclusiveActive = active.some((s) => s.exclusive === true);

  const feedback = stories.filter(
    (s) =>
      s.status === "in-review" &&
      s.feedback === true &&
      !s.claim &&
      (!exclusiveActive || s.exclusive === true),
  );

  const todo = stories.filter((s) => {
    if (s.status !== "todo" || s.claim) return false;
    if (!(s.depends_on ?? []).every((d) => byId.get(d)?.status === "done")) return false;
    if (exclusiveActive) return false;
    if (s.exclusive === true) return active.length === 0;
    return !touchesOverlap(s.touches ?? [], held);
  });

  const rank = (s) => PRIORITIES.indexOf(s.priority ?? "P2");
  const cmp = (a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return [...feedback.sort(cmp), ...todo.sort(cmp)];
}
