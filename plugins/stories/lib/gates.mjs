// plugins/stories/lib/gates.mjs — typed verification gates as board data.
//
// Gate definitions live in .claude/story-workflow.json (config.gates). A
// story names its gates in frontmatter (override) or inherits
// config.defaults[type]. Two kinds:
//   command — pass/fail by exit code, run mechanically by the CLI
//   review  — requires a recorded verdict from a persona dispatch (story record)
// Command gates run under the machine-wide 'gate' lock (config.gateLock,
// default true) so parallel workers never fight over ports/build caches;
// a gate with lock:false opts out (design §6).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertValidId } from "./board.mjs";
import { withLock } from "./locks.mjs";
import { CliError, nowISO, run, writeFileAtomic } from "./util.mjs";

// Defense in depth (mirrors worktrees.mjs): the id is validated at the board
// load boundary, but this joins it into an evidence path, so re-assert it.
export function evidenceDir(root, id) {
  assertValidId(id);
  return join(root, ".claude", "story-evidence", id);
}

/** story.gates override → config.defaults[story.type] → []. */
export function resolveGates(story, config) {
  const names = story.gates ?? (config.defaults ?? {})[story.type] ?? [];
  return names.map((name) => {
    const def = (config.gates ?? {})[name];
    if (!def) throw new CliError(`gate '${name}' not defined in .claude/story-workflow.json`);
    return { name, ...def };
  });
}

/**
 * Run every command gate for a story inside its worktree. Failures are
 * returned, not thrown — the caller (story done) decides what to do.
 */
export async function runCommandGates(story, gates, opts) {
  const { root, cwd, exec = run, lock = withLock, gateLock = true } = opts;
  const results = [];
  for (const gate of gates.filter((g) => g.kind === "command")) {
    const runOne = () => {
      const r = exec("sh", ["-c", gate.run], { cwd });
      return { name: gate.name, kind: "command", run: gate.run, exitCode: r.code, pass: r.code === 0 };
    };
    const locked = gateLock && gate.lock !== false;
    results.push(locked ? await lock(root, "gate", runOne) : runOne());
  }
  return results;
}

// ---------------------------------------------------------------- verdicts

export function verdictPath(root, id, gate) {
  return join(evidenceDir(root, id), `verdict-${gate}.json`);
}

export function recordVerdict(root, id, { gate, verdict, evidence, session }) {
  if (!["pass", "fail"].includes(verdict)) {
    throw new CliError(`--verdict must be pass|fail, got '${verdict}'`);
  }
  const record = { story: id, gate, verdict, evidence: evidence ?? null, session: session ?? null, at: nowISO() };
  writeFileAtomic(verdictPath(root, id, gate), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function readVerdict(root, id, gate) {
  const p = verdictPath(root, id, gate);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Review gates whose latest recorded verdict is not a pass. */
export function unmetReviewGates(root, id, gates) {
  return gates.filter((g) => g.kind === "review" && readVerdict(root, id, g.name)?.verdict !== "pass");
}

/** Timestamped evidence file — the record `story done` writes before integrating. */
export function writeEvidence(root, id, payload) {
  const at = nowISO();
  const file = join(evidenceDir(root, id), `${at.replace(/:/g, "-")}.json`);
  writeFileAtomic(file, `${JSON.stringify({ story: id, at, ...payload }, null, 2)}\n`);
  return file;
}

/**
 * Newest evidence payload for a story ({story, at, gates: [...]}) or null.
 * Evidence filenames are ISO timestamps (colons dashed), so a lexicographic
 * sort is chronological; verdict-*.json files are per-gate verdicts, not
 * evidence snapshots, and are excluded.
 */
export function latestEvidence(root, id) {
  const dir = evidenceDir(root, id);
  if (!existsSync(dir)) return null;
  const newest = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("verdict-"))
    .sort()
    .at(-1);
  return newest ? JSON.parse(readFileSync(join(dir, newest), "utf8")) : null;
}
