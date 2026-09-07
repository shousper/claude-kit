// shared/stories/lib/gates.mjs — typed verification gates as board data.
//
// Gate definitions live in <state root>/config.json (config.gates). A
// story names its gates in frontmatter (override) or inherits
// config.defaults[type]. Two kinds:
//   command — pass/fail by exit code, run mechanically by the CLI
//   review  — requires a recorded verdict from a persona dispatch (story record)
// Command gates run under the machine-wide 'gate' lock (config.gateLock,
// default true) so parallel workers never fight over ports/build caches;
// a gate with lock:false opts out (design §6).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assertValidId } from "./board.mjs";
import { LOCK, withLock } from "./locks.mjs";
import { CliError, evidenceRoot, nowISO, readJson, run, STATE_DIR, writeJsonAtomic } from "./util.mjs";

// Defense in depth (mirrors worktrees.mjs): the id is validated at the board
// load boundary, but this joins it into an evidence path, so re-assert it.
export function evidenceDir(root, id) {
  assertValidId(id);
  return join(evidenceRoot(root), id);
}

/** story.gates override → config.defaults[story.type] → []. */
export function resolveGates(story, config) {
  const names = story.gates ?? (config.defaults ?? {})[story.type] ?? [];
  return names.map((name) => {
    const def = (config.gates ?? {})[name];
    if (!def) throw new CliError(`gate '${name}' not defined in ${STATE_DIR}/config.json`);
    return { name, ...def };
  });
}

// Gate kinds — command gates run mechanically, review gates need a recorded
// verdict. Shared here so runCommandGates/unmetReviewGates spell them once.
export const GATE_KIND = Object.freeze({ COMMAND: "command", REVIEW: "review" });

/**
 * Run every command gate for a story inside its worktree. Failures are
 * returned, not thrown — the caller (story done) decides what to do.
 */
export async function runCommandGates(story, gates, opts) {
  const { root, cwd, exec = run, lock = withLock, gateLock = true } = opts;
  const results = [];
  for (const gate of gates.filter((g) => g.kind === GATE_KIND.COMMAND)) {
    const runOne = () => {
      const r = exec("sh", ["-c", gate.run], { cwd });
      return { name: gate.name, kind: GATE_KIND.COMMAND, run: gate.run, exitCode: r.code, pass: r.code === 0 };
    };
    const locked = gateLock && gate.lock !== false;
    results.push(locked ? await lock(root, LOCK.GATE, runOne) : runOne());
  }
  return results;
}

// ---------------------------------------------------------------- verdicts

export const VERDICTS = Object.freeze({ PASS: "pass", FAIL: "fail" });
const VERDICT_VALUES = Object.values(VERDICTS);

// Shared by verdictPath (filename) and latestEvidence's filter (per-gate
// verdicts are not evidence snapshots, and are excluded from that scan).
const VERDICT_FILE_PREFIX = "verdict-";

export function verdictPath(root, id, gate) {
  return join(evidenceDir(root, id), `${VERDICT_FILE_PREFIX}${gate}.json`);
}

export function recordVerdict(root, id, { gate, verdict, evidence, session }) {
  if (!VERDICT_VALUES.includes(verdict)) {
    throw new CliError(`--verdict must be pass|fail, got '${verdict}'`);
  }
  const record = { story: id, gate, verdict, evidence: evidence ?? null, session: session ?? null, at: nowISO() };
  writeJsonAtomic(verdictPath(root, id, gate), record);
  return record;
}

export function readVerdict(root, id, gate) {
  const p = verdictPath(root, id, gate);
  if (!existsSync(p)) return null;
  return readJson(p);
}

/** Review gates whose latest recorded verdict is not a pass. */
export function unmetReviewGates(root, id, gates) {
  return gates.filter((g) => g.kind === GATE_KIND.REVIEW && readVerdict(root, id, g.name)?.verdict !== VERDICTS.PASS);
}

// Evidence filenames are ISO timestamps (colons dashed), so a lexicographic
// sort is chronological.
function evidenceFileName(at) {
  return `${at.replace(/:/g, "-")}.json`;
}

/** Timestamped evidence file — the record `story done` writes before integrating. */
export function writeEvidence(root, id, payload) {
  const at = nowISO();
  const file = join(evidenceDir(root, id), evidenceFileName(at));
  writeJsonAtomic(file, { story: id, at, ...payload });
  return file;
}

/**
 * Newest evidence payload for a story ({story, at, gates: [...]}) or null.
 * verdict-*.json files are per-gate verdicts, not evidence snapshots, and
 * are excluded.
 */
export function latestEvidence(root, id) {
  const dir = evidenceDir(root, id);
  if (!existsSync(dir)) return null;
  const newest = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith(VERDICT_FILE_PREFIX))
    .sort()
    .at(-1);
  return newest ? readJson(join(dir, newest)) : null;
}
