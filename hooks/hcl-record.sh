#!/usr/bin/env bash
# PostToolUse recorder: log edited HCL file paths to a per-session scratch file.
# Never reads or writes the edited file, so it cannot cause Claude's
# "file modified since last read" desync. The Stop hook (hcl-fmt.sh) consumes this.
set -uo pipefail

input="$(cat)"
tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
case "$tool_name" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
if [ -z "$file_path" ] || [[ ! "$file_path" =~ \.(tf|tofu|tfvars)$ ]]; then
  exit 0
fi

session_id="$(printf '%s' "$input" | jq -r '.session_id // "unknown"')"
agent_id="$(printf '%s' "$input" | jq -r '.agent_id // ""')"
key="${agent_id:-$session_id}"
config_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
scratch_dir="${config_dir}/kit/state"
mkdir -p "$scratch_dir"
printf '%s\n' "$file_path" >> "${scratch_dir}/hcl-touched-${key}.txt"
exit 0
