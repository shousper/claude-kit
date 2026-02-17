#!/usr/bin/env bash
# SessionStart hook for kit plugin

set -euo pipefail

# Determine plugin root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Check if legacy skills directory exists and build warning
warning_message=""
legacy_skills_dir="${HOME}/.config/kit/skills"
if [ -d "$legacy_skills_dir" ]; then
    warning_message="\n\n<important-reminder>IN YOUR FIRST REPLY AFTER SEEING THIS MESSAGE YOU MUST TELL THE USER:⚠️ **WARNING:** Kit now uses Claude Code's skills system. Custom skills in ~/.config/kit/skills will not be read. Move custom skills to ~/.claude/skills instead. To make this message go away, remove ~/.config/kit/skills</important-reminder>"
fi

# Read using-kit content
using_kit_content=$(cat "${PLUGIN_ROOT}/skills/using-kit/SKILL.md" 2>&1 || echo "Error reading using-kit skill")

# Escape string for JSON embedding using bash parameter substitution.
# Each ${s//old/new} is a single C-level pass - orders of magnitude
# faster than the character-by-character loop this replaces.
escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

using_kit_escaped=$(escape_for_json "$using_kit_content")
warning_escaped=$(escape_for_json "$warning_message")

# Output context injection as JSON
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<EXTREMELY_IMPORTANT>\nYou have kit.\n\n**Below is the full content of your 'kit:using-kit' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${using_kit_escaped}\n\n${warning_escaped}\n</EXTREMELY_IMPORTANT>"
  }
}
EOF

exit 0
