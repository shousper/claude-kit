#!/usr/bin/env bash
# Stop: hand the turn-end decision to the story CLI. Exit 2 = block (stdout:
# status line, blank line, reason); exit 0 = allow (stdout: summary or empty);
# anything else = allow silently. Never fails: a broken CLI must not wedge
# stopping. stop_hook_active is deliberately ignored — the loop keeps its own
# stall budget and the CLI, not this script, decides when a run ends.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
root="$(stories_root)" || exit 0
stories_enabled "$root" || exit 0
input="$(cat)"
session="$(json_field "$input" session_id)"
if [ -z "$session" ]; then echo '{}'; exit 0; fi
set +e
out="$("$STORY" loop tick --session "$session" 2>/dev/null)"
code=$?
set -e
case "$code" in
  2)
    status="$(printf '%s\n' "$out" | head -n1)"
    reason="$(printf '%s\n' "$out" | tail -n +3)"
    printf '{"decision":"block","reason":"%s","systemMessage":"%s"}\n' "$(escape_for_json "$reason")" "$(escape_for_json "$status")"
    ;;
  0)
    if [ -n "$out" ]; then
      printf '{"systemMessage":"%s"}\n' "$(escape_for_json "$out")"
    else
      echo '{}'
    fi
    ;;
  *) echo '{}' ;;
esac
exit 0
