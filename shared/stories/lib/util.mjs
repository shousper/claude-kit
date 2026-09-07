// shared/stories/lib/util.mjs — exec wrapper, error type, and file helpers.
// Zero runtime dependencies; node: builtins only.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export class CliError extends Error {
  constructor(message, { exitCode = 1, code = null } = {}) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.code = code; // machine-readable discriminator (e.g. "LOCK_TIMEOUT") for programmatic catches
  }
}

/**
 * Synchronous exec wrapper. Everything in gates.mjs / worktrees.mjs / cli.mjs
 * shells out through an injectable `exec` parameter that defaults to this,
 * so tests can fake git/gh/gate commands.
 */
export function run(cmd, args = [], opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.error) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Prefer stderr over stdout from a failed exec result; trimmed. */
export function failureOutput(r) {
  return (r.stderr || r.stdout).trim();
}

/** Build the CliError a failed exec result should throw. */
export function execError(cmd, args, r) {
  return new CliError(`${cmd} ${args.join(" ")} failed (exit ${r.code}): ${failureOutput(r)}`);
}

/** run() that throws CliError on non-zero exit. */
export function runOk(cmd, args = [], opts = {}, exec = run) {
  const r = exec(cmd, args, opts);
  if (r.code !== 0) throw execError(cmd, args, r);
  return r;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function nowISO() {
  return new Date().toISOString();
}

/** Atomic write: temp file in the same directory, then rename over the target. */
export function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

/** Parse a JSON file. Callers wrap with their own CliError message on failure. */
export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Pretty-print and atomically write a JSON value, newline-terminated. */
export function writeJsonAtomic(path, value) {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

// ---------------------------------------------------------------- exit codes
//
// Shared by cli.mjs (emitTick/cmdGuard/main) and main.mjs's top-level catch —
// both plugins' bin/story exec main.mjs, so this is the one spelling for both
// harnesses. 0 allow, 1 CLI failure (adapters treat as allow), 2 block/deny.
export const EXIT = Object.freeze({ OK: 0, ERROR: 1, DENY: 2 });

// ---------------------------------------------------------------- state root
//
// Everything the plugin owns project-side lives under .agents/shousper-stories/,
// namespaced by plugin and author inside the general-purpose .agents/ directory
// so it never collides with another tool's files there:
//   config.json    tracked   the marker; merge mode, gates, defaults, budgets
//   personas/      tracked   project-generated review personas
//   local/         ignored   state.json, loop.<session>.md, learnings.md,
//                            sweep.json, evidence/<id>/, locks/<name>.lock
// These helpers live in the dependency leaf so board.mjs, locks.mjs, loop.mjs,
// and doctor.mjs's migration table all share one spelling.
export const STATE_DIR = ".agents/shousper-stories";
export const LOCAL_DIR = `${STATE_DIR}/local`;
export const WORKTREES_DIR = ".worktrees";
export const ARCHIVE_DIR = "archive";
export const LOCKS_DIR = "locks";
export const EVIDENCE_DIR = "evidence";

// Canonical project-side ignore block — MUST stay byte-identical across the four
// writers: cmdInit, the stories:setup skill, the eval fixture, and the README.
export const GITIGNORE_BLOCK = `${WORKTREES_DIR}/\n${LOCAL_DIR}/\n`;

export function stateDir(root) {
  return join(root, STATE_DIR);
}

export function configPath(root) {
  return join(stateDir(root), "config.json");
}

export function localDir(root) {
  return join(root, LOCAL_DIR);
}

export function hasMarker(root) {
  return existsSync(configPath(root));
}

// ------------------------------------------------------------- local state

export function stateStorePath(root) {
  return join(localDir(root), "state.json");
}

export function learningsPath(root) {
  return join(localDir(root), "learnings.md");
}

export function sweepStatePath(root) {
  return join(localDir(root), "sweep.json");
}

export function locksDir(root) {
  return join(localDir(root), LOCKS_DIR);
}

export function lockPath(root, name) {
  return join(locksDir(root), `${name}.lock`);
}

// Evidence root for every story; gates.mjs keeps evidenceDir(root, id) because
// it asserts the id before joining it in — this stays id-less.
export function evidenceRoot(root) {
  return join(localDir(root), EVIDENCE_DIR);
}

// Session ids come from the harness; sanitize defensively since the id lands
// in a filename.
const SESSION_ID_UNSAFE = /[^A-Za-z0-9_-]/g;

export function loopStateFileName(sessionId) {
  return `loop.${String(sessionId ?? "").replace(SESSION_ID_UNSAFE, "_")}.md`;
}

export function loopStatePath(root, sessionId) {
  return join(localDir(root), loopStateFileName(sessionId));
}

export const LOOP_STATE_FILE_RE = /^loop\..+\.md$/;

// Pre-split layout (everything under .claude/). Read only by findRoot's
// detection and doctor's one-shot migration; nothing else may name these paths.
export const LEGACY_CONFIG = ".claude/story-workflow.json";

export function legacyConfigPath(root) {
  return join(root, LEGACY_CONFIG);
}

export function hasLegacyMarker(root) {
  return existsSync(legacyConfigPath(root));
}
