#!/usr/bin/env bash
# PostToolUse recorder: append edited handled-source paths to a per-agent scratch
# file. Never reads/writes the edited file (so it cannot cause the read-before-edit
# desync). Consumed by format-on-stop.sh.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=lib.sh disable=SC1091
. "${script_dir}/lib.sh"

input="$(cat)"
case "$(printf '%s' "$input" | jq -r '.tool_name // ""')" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
[ -n "$file_path" ] || exit 0
kit_is_handled "$file_path" || exit 0

scratch="$(kit_scratch_file "$input")"
mkdir -p "$(dirname "$scratch")"
printf '%s\n' "$file_path" >> "$scratch"
exit 0
