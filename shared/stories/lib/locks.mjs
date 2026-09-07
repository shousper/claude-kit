// shared/stories/lib/locks.mjs — machine-wide advisory locks via O_EXCL lockfiles.
//
// SAME-MACHINE ONLY. Lockfiles under <state root>/local/locks/ are atomic on
// local filesystems; they silently break across machines and on network mounts.
//
// Lock names used by the plugin: board, merge, gate, sweep, learnings.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { CliError, lockPath, locksDir } from "./util.mjs";

export const LOCK = Object.freeze({
  BOARD: "board",
  MERGE: "merge",
  GATE: "gate",
  SWEEP: "sweep",
  LEARNINGS: "learnings",
});
export const LOCK_NAMES = Object.values(LOCK);

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_POLL_MS = 50;

/**
 * Run fn while holding the named lock. The lockfile records {pid, at}.
 * Stale reclaim: a lockfile is removed only when it is older than staleMs
 * AND its pid is dead (or the file is unreadable). Two waiters may race the
 * reclaim unlink — worst case both unlink an already-stale file, then race
 * the O_EXCL create, which only one can win.
 */
export async function withLock(root, name, fn, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, staleMs = DEFAULT_STALE_MS, pollMs = DEFAULT_POLL_MS } = opts;
  mkdirSync(locksDir(root), { recursive: true });
  const file = lockPath(root, name);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      reclaimIfStale(file, staleMs);
      if (Date.now() >= deadline) {
        throw new CliError(`timed out waiting for '${name}' lock (${file})`, { code: "LOCK_TIMEOUT" });
      }
      await sleep(pollMs);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(file);
    } catch {
      // already gone — fine
    }
  }
}

function reclaimIfStale(file, staleMs) {
  let info = null;
  try {
    info = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // corrupt or vanished — treat as stale
  }
  if (info && Date.now() - info.at < staleMs) return;
  if (info && pidAlive(info.pid)) return;
  try {
    unlinkSync(file);
  } catch {
    // raced another reclaimer — fine
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists but not ours
  }
}
