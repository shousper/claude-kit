// plugins/stories/lib/locks.mjs — machine-wide advisory locks via O_EXCL lockfiles.
//
// SAME-MACHINE ONLY. Lockfiles under .claude/locks/ are atomic on local
// filesystems; they silently break across machines and on network mounts.
//
// Lock names used by the plugin: board, merge, gate, sweep.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { CliError } from "./util.mjs";

export const LOCK_NAMES = ["board", "merge", "gate", "sweep"];

export function lockPath(root, name) {
  return join(root, ".claude", "locks", `${name}.lock`);
}

/**
 * Run fn while holding the named lock. The lockfile records {pid, at}.
 * Stale reclaim: a lockfile is removed only when it is older than staleMs
 * AND its pid is dead (or the file is unreadable). Two waiters may race the
 * reclaim unlink — worst case both unlink an already-stale file, then race
 * the O_EXCL create, which only one can win.
 */
export async function withLock(root, name, fn, opts = {}) {
  const { timeoutMs = 10_000, staleMs = 30_000, pollMs = 50 } = opts;
  mkdirSync(join(root, ".claude", "locks"), { recursive: true });
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
