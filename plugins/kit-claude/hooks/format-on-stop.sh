#!/usr/bin/env bash
# Claude Code Stop + SubagentStop hook: honours the stop_hook_active guard,
# reads and clears this session/agent's scratch list (via shared/lib.sh), then
# hands the files to shared/format-files.sh and wraps its plain-text summary
# (if any) in {systemMessage, suppressOutput:true}. Strictly non-blocking.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export KIT_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "${script_dir}/.." && pwd)}"
export KIT_STATE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kit/state"
# shellcheck source=shared/lib.sh disable=SC1091
. "${script_dir}/shared/lib.sh"

input="$(cat)"
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

agent_id="$(printf '%s' "$input" | jq -r '.agent_id // ""')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // "unknown"')"
export KIT_SCRATCH_KEY="${agent_id:-$session_id}"

scratch="$(kit_scratch_file)"
[ -f "$scratch" ] || exit 0
mapfile -t files < <(sort -u "$scratch" | sed '/^$/d')
rm -f "$scratch"
[ "${#files[@]}" -gt 0 ] || exit 0

output="$("${script_dir}/shared/format-files.sh" "${files[@]}")"
[ -z "$output" ] && exit 0
jq -n --arg m "$output" '{systemMessage:$m, suppressOutput:true}'
exit 0
