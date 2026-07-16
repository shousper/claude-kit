#!/usr/bin/env bash
# Stop + SubagentStop: run every formatter/checker handler once on the files edited
# this turn/agent. Formatters run after all edits (no desync). Strictly non-blocking.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=lib.sh disable=SC1091
. "${script_dir}/lib.sh"
export KIT_HOOKS_DIR="$script_dir"   # handlers that shell out to hcl-tool.sh use this

input="$(cat)"
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

scratch="$(kit_scratch_file "$input")"
[ -f "$scratch" ] || exit 0
mapfile -t KIT_FILES < <(sort -u "$scratch" | sed '/^$/d')
rm -f "$scratch"
[ "${#KIT_FILES[@]}" -gt 0 ] || exit 0

findings=""
add() { [ -n "$1" ] && findings="${findings}${1}"$'\n\n'; }

add "$(handle_gofmt       "$(select_files '*.go')")"
add "$(handle_rustfmt     "$(select_files '*.rs')")"
add "$(handle_hcl         "$(select_files '*.tf' '*.tofu' '*.tofu.json' '*.tfvars')")"
add "$(handle_eslint      "$(select_files '*.js' '*.jsx' '*.ts' '*.tsx' '*.mjs' '*.cjs')")"
add "$(handle_tsc         "$(select_files '*.ts' '*.tsx')")"
add "$(handle_rust_checks "$(select_files '*.rs' '*Cargo.toml')")"

findings="${findings%$'\n\n'}"
[ -z "$findings" ] && exit 0
jq -n --arg m "$findings" '{systemMessage:$m, suppressOutput:true}'
exit 0
