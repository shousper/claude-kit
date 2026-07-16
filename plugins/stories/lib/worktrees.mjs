// plugins/stories/lib/worktrees.mjs — story worktree + integration lifecycle.
// Every git call goes through the injectable exec (util.run signature).
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { assertValidId } from "./board.mjs";
import { withLock } from "./locks.mjs";
import { CliError, run, runOk } from "./util.mjs";

// Defense in depth: the id is already shape-validated at the load boundary
// (board.loadStories/getStory), but these builders join it straight into
// filesystem paths and git refs, so they re-assert it here — a bad id must
// never be turned into a path even if a caller bypasses the board.
export function worktreePath(root, id) {
  assertValidId(id);
  return join(root, ".worktrees", id);
}

export function branchName(id) {
  assertValidId(id);
  return `story/${id}`;
}

export function branchExists(root, id, exec = run) {
  return (
    exec("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branchName(id)}`], { cwd: root }).code === 0
  );
}

/**
 * Create .worktrees/<id> on branch story/<id> off base. Idempotent: an
 * existing worktree is returned as-is; an existing branch (feedback rounds,
 * stale-lease re-claims) is checked out instead of recreated.
 */
export function createWorktree(root, id, { exec = run, base = "main" } = {}) {
  const path = worktreePath(root, id);
  if (existsSync(path)) return path;
  mkdirSync(join(root, ".worktrees"), { recursive: true });
  const args = branchExists(root, id, exec)
    ? ["worktree", "add", path, branchName(id)]
    : ["worktree", "add", "-b", branchName(id), path, base];
  runOk("git", args, { cwd: root }, exec);
  return path;
}

/**
 * Every path the story has actually touched: working tree vs base commit
 * (covers committed + staged + unstaged) ∪ untracked files. This is what
 * closes the touches-underdeclaration hole in computeReady (design §12).
 */
export function actualDiff(root, id, { exec = run, base = "main" } = {}) {
  const cwd = worktreePath(root, id);
  if (!existsSync(cwd)) return [];
  // A failed git run must NOT masquerade as "no changes" — an empty stdout from
  // exit 0 and from a crash are indistinguishable, and under-reporting a
  // story's footprint silently corrupts computeReady scheduling and cmdDone's
  // reconcileTouches. Fail loud instead (runOk throws CliError on non-zero).
  const tracked = runOk("git", ["diff", "--name-only", base], { cwd }, exec);
  const untracked = runOk("git", ["ls-files", "--others", "--exclude-standard"], { cwd }, exec);
  const paths = new Set(
    [...tracked.stdout.split("\n"), ...untracked.stdout.split("\n")].map((s) => s.trim()).filter(Boolean),
  );
  return [...paths].sort();
}

/**
 * ACTUAL worktree diff of every active story (in-progress / in-review),
 * keyed by story id — the Map board.computeReady takes as opts.diffs.
 * Exported from HERE (not cli.mjs) so Section C's loop tick can import it
 * without a cli ↔ loop import cycle. exceptId skips the story being claimed.
 */
export function activeDiffs(root, config, stories, exec = run, exceptId = null) {
  const diffs = new Map();
  for (const s of stories) {
    if (s.id === exceptId) continue;
    if (s.status !== "in-progress" && s.status !== "in-review") continue;
    diffs.set(s.id, actualDiff(root, s.id, { exec, base: config.baseBranch ?? "main" }));
  }
  return diffs;
}

/**
 * self mode: merge story/<id> into base under the machine-wide merge lock
 * (one integration at a time). Conflict → abort, leave the worktree for the
 * worker to resolve (story goes back to in-progress in cli.mjs), never leave
 * the root checkout mid-merge.
 */
export async function integrateSelf(root, story, { exec = run, base = "main", lock = withLock } = {}) {
  return lock(root, "merge", () => {
    const head = exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root }).stdout.trim();
    if (head !== base) {
      throw new CliError(`self merge requires the root checkout on '${base}' (currently on '${head}')`);
    }
    const merge = exec(
      "git",
      ["merge", "--no-ff", branchName(story.id), "-m", `story ${story.id}: ${story.title}`],
      { cwd: root },
    );
    if (merge.code !== 0) {
      exec("git", ["merge", "--abort"], { cwd: root });
      return { merged: false, conflict: true };
    }
    teardown(root, story.id, { exec });
    return { merged: true, conflict: false };
  });
}

/**
 * self mode: did story/<id>'s integration already land on base? After
 * integrateSelf the branch and worktree are gone, so local mode's
 * branch-based --merged detection cannot work — detect via the merge commit
 * message cmdDone writes (`story <id>: <title>`). Doctor uses this to flip a
 * story stranded in-progress by a crash AFTER the merge straight to done
 * instead of reclaiming it to todo and redoing merged work.
 */
export function isMergedSelf(root, id, { exec = run, base = "main" } = {}) {
  assertValidId(id);
  const r = exec("git", ["log", base, "-1", "--format=%H", "--grep", `^story ${id}:`], { cwd: root });
  return r.code === 0 && r.stdout.trim() !== "";
}

/** local mode: has a human merged story/<id> into base? (git branch --merged) */
export function isMergedLocal(root, id, { exec = run, base = "main" } = {}) {
  if (!branchExists(root, id, exec)) return false;
  const r = exec("git", ["branch", "--merged", base, "--format=%(refname:short)"], { cwd: root });
  return r.stdout.split("\n").map((s) => s.trim()).includes(branchName(id));
}

/** Remove worktree + branch. Only called once the work is merged or abandoned. */
export function teardown(root, id, { exec = run } = {}) {
  const path = worktreePath(root, id); // asserts a valid id
  if (existsSync(path)) {
    const r = exec("git", ["worktree", "remove", "--force", path], { cwd: root });
    // rmSync is the destructive endpoint reachable UNATTENDED (doctor
    // orphan-teardown, self integrate, PR-sweep applyMerged). Before deleting
    // recursively, confirm the REAL path (symlinks followed) is contained in
    // <root>/.worktrees/ — refuse anything that escapes it (belt-and-braces
    // over the id assertion in worktreePath; also blocks a symlinked worktree
    // entry pointing at the wider tree).
    if (r.code !== 0) {
      const base = realpathSync(join(root, ".worktrees")) + sep;
      const resolved = realpathSync(path);
      if (!(resolved + sep).startsWith(base)) {
        throw new CliError(`refusing to remove '${resolved}': outside ${base}`);
      }
      rmSync(resolved, { recursive: true, force: true }); // orphan dir, not registered
    }
    exec("git", ["worktree", "prune"], { cwd: root });
  }
  if (branchExists(root, id, exec)) exec("git", ["branch", "-D", branchName(id)], { cwd: root });
}

/**
 * At done: pin touches to the actual diff so the in-review hold covers
 * exactly the right files (design §7 "reconcile touches"). An empty diff
 * keeps the declared hint.
 */
export function reconcileTouches(story, diffPaths) {
  return diffPaths.length ? { ...story, touches: diffPaths } : story;
}
