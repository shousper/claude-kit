#!/usr/bin/env bash
# Claude Code PostToolUse (Write|Edit) hook: reads the tool event JSON from
# stdin, runs the neutral shared/writing/hooks/vale-lint.sh on the touched
# file, and returns any summary as additionalContext. Silent otherwise, and
# never blocks the write.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
input="$(cat)"

case "$(printf '%s' "$input" | jq -r '.tool_name // ""')" in
  Write) mode=write ;;
  Edit|MultiEdit) mode=edit ;;
  *) exit 0 ;;
esac

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
[ -n "$file_path" ] || exit 0

# "shared" is a symlink into shared/writing/hooks; resolve it physically so
# vale-lint.sh's own BASH_SOURCE-relative lookups (its sibling ../vale/.vale.ini)
# resolve against the real tree instead of the symlink's parent.
lint_dir="$(cd -P "$script_dir/shared" 2>/dev/null && pwd)"
[ -n "$lint_dir" ] || exit 0

summary="$(bash "$lint_dir/vale-lint.sh" "$file_path" "$mode")"
[ -n "$summary" ] || exit 0

jq -n --arg ctx "$summary" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $ctx}}'
exit 0
