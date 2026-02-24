#!/usr/bin/env bash
# SessionStart hook for kit plugin

set -euo pipefail

# Determine plugin root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

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

# Output context injection as JSON
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<EXTREMELY_IMPORTANT>\nYou have kit.\n\n**Below is the full content of your 'kit:using-kit' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${using_kit_escaped}\n\n</EXTREMELY_IMPORTANT>\nBefore editing Go, Rust, Python, or Tailwind CSS files, invoke the kit:code-standards skill to load language-specific coding standards."
  }
}
EOF

exit 0
