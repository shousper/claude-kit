#!/usr/bin/env bash
# SessionStart (startup|resume|clear|compact): inject the story CLI's context
# block — rules, ready set, loop status, CLI path — as additionalContext.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
root="$(stories_root)" || exit 0
stories_enabled "$root" || exit 0
context="$("$STORY" context 2>/dev/null)" || exit 0
[ -n "$context" ] || exit 0
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$(escape_for_json "$context")"
