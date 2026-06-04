#!/usr/bin/env bash
# SessionStart hook: one-time per-project notice naming the detected HCL tool.
# Silent unless the project tracks HCL AND no decision is cached yet.
set -uo pipefail

input="$(cat)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
[ -n "$cwd" ] || cwd="$(pwd)"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
hcl_tool="${script_dir}/hcl-tool.sh"

# Prune scratch buckets left by dead sessions/agents (within-session leftovers
# self-heal on the next Stop). Runs regardless of cwd, before the early-exits.
config_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
state_dir="${config_dir}/kit/state"
[ -d "$state_dir" ] && find "$state_dir" -name 'touched-*.txt' -mtime +1 -delete 2>/dev/null || true

# Already decided? stay silent.
[ -n "$("$hcl_tool" get "$cwd")" ] && exit 0
# Not an HCL project? stay silent.
"$hcl_tool" is-hcl "$cwd" || exit 0

# Atomically claim the first detection; only the winner notifies (avoids a
# duplicate notice if a SubagentStop hook races this at session start).
tool="$("$hcl_tool" first-detect "$cwd")"
[ -n "$tool" ] || exit 0
other="terraform"; [ "$tool" = "terraform" ] && other="tofu"
jq -n --arg m "Detected ${tool} for this project. Override with /kit:hcl-tool ${other}." \
  '{systemMessage:$m}'
exit 0
