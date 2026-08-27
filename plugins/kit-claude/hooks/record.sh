#!/usr/bin/env bash
# Claude Code PostToolUse (Write|Edit) hook: parses the tool_input JSON off
# stdin, then owns scratch-file persistence itself (separate hook processes
# need cross-process state) via the neutral shared/lib.sh helpers. Never
# reads/writes the edited file (so it cannot cause the read-before-edit
# desync). Consumed by format-on-stop.sh.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export KIT_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "${script_dir}/.." && pwd)}"
export KIT_STATE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kit/state"
# shellcheck source=shared/lib.sh disable=SC1091
. "${script_dir}/shared/lib.sh"

input="$(cat)"
case "$(printf '%s' "$input" | jq -r '.tool_name // ""')" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
[ -n "$file_path" ] || exit 0
kit_is_handled "$file_path" || exit 0

# Scratch key: agent_id when inside a subagent, else session_id.
agent_id="$(printf '%s' "$input" | jq -r '.agent_id // ""')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // "unknown"')"
export KIT_SCRATCH_KEY="${agent_id:-$session_id}"

scratch="$(kit_scratch_file)"
mkdir -p "$(dirname "$scratch")"
printf '%s\n' "$file_path" >> "$scratch"
exit 0
