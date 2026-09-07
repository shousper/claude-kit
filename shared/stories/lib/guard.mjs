// shared/stories/lib/guard.mjs — the tool-call policy behind `story guard`.
//
// One place decides what the harness adapters deny: hand-edits to the board or
// to CLI-owned local state, and ask-the-user calls while a loop is bound to
// the session. Harness adapters translate protocol only; every reason string
// lives here so the corrective hint is identical on both harnesses. The shell
// remains a known loophole (design §10): not chased — the CLI-as-sanctioned-
// path + doctor backstop is the robust pair.
import { existsSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { ID_PREFIX, storiesDir } from "./board.mjs";
import { LOCAL_DIR, loopStatePath, WORKTREES_DIR } from "./util.mjs";

export const WRITE_TOOLS = new Set(["edit", "write", "multiedit", "notebookedit", "apply_patch"]);
export const ASK_TOOLS = new Set(["ask", "askuserquestion"]);

const LOCAL_STATE_REASON =
  "This file is CLI-owned local execution state - never hand-edit it. Use: the story CLI (story update / story loop … / story loop learn / story record).";
const ASK_REASON =
  "A story loop is bound to this session - it runs unattended, so do not ask your human partner mid-run. Park the story instead: story park <id> --question \"...\" and continue with the next ready story; parked questions surface in the end-of-run summary.";

// Sniff a story id off a board filename; ID_PREFIX ties this to board.mjs's
// id shape so the two can't drift.
const ID_SNIFF = new RegExp(`^(${ID_PREFIX}[0-9a-f]+)`);

/** "write" for file-writing tools, "ask" for ask-the-user tools, null otherwise. Harness tool names differ in case only. */
export function toolClass(tool) {
  const t = String(tool ?? "").toLowerCase();
  if (WRITE_TOOLS.has(t)) return "write";
  if (ASK_TOOLS.has(t)) return "ask";
  return null;
}

/**
 * Project-relative form of a tool path, with a story-worktree prefix stripped so
 * the board copy inside .worktrees/<id>/ is judged like the main copy (it is
 * never the source of truth). Relative paths resolve against the root first so
 * an embedded `..` (src/../stories/x.md) cannot slip past the prefix checks.
 * Paths that resolve outside the project return null.
 */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORKTREE_PREFIX = new RegExp(`^${escapeRegExp(WORKTREES_DIR)}/[^/]+/`);

export function projectRelative(root, path) {
  const rel = relative(root, resolve(root, String(path)));
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.replace(WORKTREE_PREFIX, "");
}

const under = (rel, dir) => rel === dir || rel.startsWith(`${dir}/`);

/** { allow: true } | { allow: false, reason }. */
export function classifyGuard(root, config, { tool, path, session }) {
  const cls = toolClass(tool);
  if (cls === null) return { allow: true };
  if (cls === "ask") {
    if (!session || !existsSync(loopStatePath(root, session))) return { allow: true };
    return { allow: false, reason: ASK_REASON };
  }
  if (typeof path !== "string" || !path) return { allow: true };
  const rel = projectRelative(root, path);
  if (rel === null) return { allow: true };
  const stories = relative(root, storiesDir(root, config));
  if (under(rel, stories)) {
    const id = ID_SNIFF.exec(basename(rel))?.[1];
    const hint = id
      ? `story update ${id} --status <status>, story note ${id} --body '...', or story park ${id} --question '...'`
      : "story create --title '...' --type <type> [--body-file <path>]";
    return {
      allow: false,
      reason: `Files under ${stories}/ are managed by the story CLI - never hand-edit the board. Use: ${hint}. Read views: story show <id>, story board.`,
    };
  }
  if (under(rel, LOCAL_DIR)) return { allow: false, reason: LOCAL_STATE_REASON };
  return { allow: true };
}
