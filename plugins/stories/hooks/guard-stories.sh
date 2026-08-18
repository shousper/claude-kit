#!/usr/bin/env bash
# PreToolUse guard for the stories plugin: the story CLI is the only sanctioned
# writer of the board. Denies Edit/Write under the configured storiesDir with a
# corrective reason (reasons teach the model). A hook deny holds even under
# --dangerously-skip-permissions. Bash remains a known loophole (design §10):
# not chased — the CLI-as-sanctioned-path + doctor backstop is the robust pair.
set -euo pipefail
# Resolve the MAIN checkout root — hooks fire with cwd anywhere in the repo,
# including inside story worktrees where the marker is invisible to $PWD.
common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0
root="$(dirname "$common")"
[ -f "$root/.claude/story-workflow.json" ] || exit 0
cd "$root"

input="$(cat)"

# tool_input.file_path from the hook stdin JSON — first match wins; no jq
# dependency so the guard also holds on minimal machines. Best-effort by
# design: a content field containing '"file_path"' before the real key could
# confuse it, but Edit/Write serialize file_path first.
file_path="$(printf '%s' "$input" \
  | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -n1 \
  | sed 's/.*:[[:space:]]*"\(.*\)"$/\1/' || true)"
[ -n "$file_path" ] || exit 0

# storiesDir from the marker file (grep/sed one-liner, no jq); default "stories".
stories_dir="$(sed -n 's/.*"storiesDir"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' .claude/story-workflow.json | head -n1)"
stories_dir="${stories_dir:-stories}"

# Normalize absolute paths inside this project to project-relative (hook cwd = project dir).
rel="$file_path"
case "$rel" in
  "$PWD"/*) rel="${rel#"$PWD"/}" ;;
esac

# Name the exact CLI command for this file in the deny reason. Two families
# of CLI-owned files: the board itself (per-story hint via the id) and the
# CLI-owned local state store (loop/learnings/evidence files, session state).
case "$rel" in
  "$stories_dir"/*|"$stories_dir")
    id="$(basename "$rel" | sed -n 's/^\(st-[0-9a-f][0-9a-f]*\).*/\1/p')"
    if [ -n "$id" ]; then
      hint="story update ${id} --status <status>, story note ${id} --body '...', or story park ${id} --question '...'"
    else
      hint="story create --title '...' --type <type> [--body-file <path>]"
    fi
    reason="Files under ${stories_dir}/ are managed by the story CLI - never hand-edit the board. Use: ${hint}. Read views: story show <id>, story board."
    ;;
  .claude/story-state.local.json|.claude/story-loop.*.local.md|.claude/story-loop.local.md|.claude/story-learnings.local.md|.claude/story-evidence/*)
    hint="the story CLI (story update / story loop … / story loop learn / story record)"
    reason="This file is CLI-owned local execution state - never hand-edit it. Use: ${hint}."
    ;;
  *) exit 0 ;;
esac

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "${reason}"
  }
}
EOF
exit 0
