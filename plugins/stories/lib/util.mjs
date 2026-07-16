// plugins/stories/lib/util.mjs — exec wrapper, error type, and file helpers.
// Zero runtime dependencies; node: builtins only.
import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
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

/** run() that throws CliError on non-zero exit. */
export function runOk(cmd, args = [], opts = {}, exec = run) {
  const r = exec(cmd, args, opts);
  if (r.code !== 0) {
    throw new CliError(`${cmd} ${args.join(" ")} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
  }
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
