#!/usr/bin/env bash
# PreToolUse (Edit|MultiEdit|NotebookEdit|Write|AskUserQuestion): ask the story
# CLI whether this call is allowed. Exit 2 from `story guard` means deny, with
# the corrective reason on stdout; anything else (allow, or a broken CLI) lets
# the call through.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
root="$(stories_root)" || exit 0
stories_enabled "$root" || exit 0
input="$(cat)"
tool="$(json_field "$input" tool_name)"
[ -n "$tool" ] || exit 0
path="$(json_field "$input" file_path)"
[ -n "$path" ] || path="$(json_field "$input" notebook_path)" # NotebookEdit's target field
session="$(json_field "$input" session_id)"
set +e
reason="$(STORY_SESSION_ID="$session" "$STORY" guard --tool "$tool" ${path:+--path "$path"} 2>/dev/null)"
code=$?
set -e
[ "$code" -eq 2 ] || exit 0
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$(escape_for_json "$reason")"
