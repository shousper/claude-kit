#!/usr/bin/env bash
# PreToolUse guard for the stories plugin: the story CLI is the only sanctioned
# writer of the board. Denies Edit/Write under the configured storiesDir with a
# corrective reason (reasons teach the model). A hook deny holds even under
# --dangerously-skip-permissions. Bash remains a known loophole (design §10):
# not chased — the CLI-as-sanctioned-path + doctor backstop is the robust pair.
set -euo pipefail
[ -f .claude/story-workflow.json ] || exit 0

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

case "$rel" in
  "$stories_dir"/*|"$stories_dir") ;;
  *) exit 0 ;;
esac

# Name the exact CLI command for this file in the deny reason.
id="$(basename "$rel" | sed -n 's/^\(st-[0-9a-f][0-9a-f]*\).*/\1/p')"
if [ -n "$id" ]; then
  hint="story update ${id} --status <status>, story note ${id} --body '...', or story park ${id} --question '...'"
else
  hint="story create --title '...' --type <type> [--body-file <path>]"
fi

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Files under ${stories_dir}/ are managed by the story CLI - never hand-edit the board. Use: ${hint}. Read views: story show <id>, story board."
  }
}
EOF
exit 0
