#!/usr/bin/env bash
# SessionStart hook for the stories plugin: re-inject workflow rules + a live
# board snapshot on startup, resume, clear, and - critically - compact (long
# autonomous runs compact and silently drop workflow rules).
set -euo pipefail
[ -f .claude/story-workflow.json ] || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
STORY="${PLUGIN_ROOT}/bin/story"

using_stories_content=$(cat "${PLUGIN_ROOT}/skills/using-stories/SKILL.md" 2>/dev/null \
  || echo "(stories:using-stories skill body unavailable - load it with the Skill tool)")
ready_json=$("$STORY" ready --json 2>/dev/null \
  || echo '{"error":"story ready failed - run story doctor"}')
loop_json=$("$STORY" loop status --json 2>/dev/null \
  || echo '{"active":false}')

# Escape string for JSON embedding using bash parameter substitution.
# Same single-pass pattern as plugins/kit/hooks/session-start.sh.
escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

using_stories_escaped=$(escape_for_json "$using_stories_content")
ready_escaped=$(escape_for_json "$ready_json")
loop_escaped=$(escape_for_json "$loop_json")

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<EXTREMELY_IMPORTANT>\nThis project uses the stories workflow. The board (story files) is CLI-managed: never hand-edit it - every mutation goes through the story CLI.\n\n**Below is the full content of your 'stories:using-stories' skill - the operating rules for this board:**\n\n${using_stories_escaped}\n\n**Ready stories right now (story ready --json):**\n${ready_escaped}\n\n**Active loop (story loop status --json):**\n${loop_escaped}\n</EXTREMELY_IMPORTANT>"
  }
}
EOF

exit 0
