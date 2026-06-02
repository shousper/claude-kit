#!/usr/bin/env bash
# Stop hook: format (and optionally validate/lint) the HCL files edited this turn.
# Runs once at end of turn, after all edits — nothing re-reads afterward, so the
# "file modified since last read" desync is structurally impossible.
# Non-blocking: surfaces output via `systemMessage`, never `decision: block`.
set -uo pipefail

input="$(cat)"

# Loop guard: if Claude Code is already continuing from a stop hook, do nothing.
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ]; then
  exit 0
fi

session_id="$(printf '%s' "$input" | jq -r '.session_id // "unknown"')"
agent_id="$(printf '%s' "$input" | jq -r '.agent_id // ""')"
key="${agent_id:-$session_id}"
config_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
scratch="${config_dir}/kit/state/hcl-touched-${key}.txt"
[ -f "$scratch" ] || exit 0

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
hcl_tool="${script_dir}/hcl-tool.sh"

# Touched files (deduped); drop the scratch file immediately. Group by directory:
# fmt the specific files, but run validate/tflint per-dir (whole-module operations).
mapfile -t files < <(sort -u "$scratch" | sed '/^$/d')
rm -f "$scratch"
[ "${#files[@]}" -gt 0 ] || exit 0

mapfile -t dirs < <(printf '%s\n' "${files[@]}" | while IFS= read -r f; do dirname "$f"; done | sort -u)

notice=""
findings=""

for dir in "${dirs[@]}"; do
  [ -d "$dir" ] || continue

  in_dir=()
  for f in "${files[@]}"; do
    [ "$(dirname "$f")" = "$dir" ] && [ -f "$f" ] && in_dir+=("$f")
  done
  [ "${#in_dir[@]}" -gt 0 ] || continue

  # Atomically claim the first detection (locked check-and-set in hcl-tool.sh):
  # `fresh` is non-empty only for the single invocation that first detects this
  # project, so the notice fires exactly once even under concurrent SubagentStop runs.
  fresh="$("$hcl_tool" first-detect "$dir")"
  tool="$("$hcl_tool" resolve "$dir")"
  command -v "$tool" >/dev/null 2>&1 || continue

  if [ -n "$fresh" ] && [ -z "$notice" ]; then
    other="terraform"; [ "$tool" = "terraform" ] && other="tofu"
    notice="Detected ${tool} for this project. Override with /kit:hcl-tool ${other}."
  fi

  # 1. fmt — the touched files only (in place; safe at end of turn).
  "$tool" fmt "${in_dir[@]}" >/dev/null 2>&1 || true

  # 2. validate — only if already initialized (never run init ourselves).
  if [ -d "$dir/.terraform" ]; then
    out="$("$tool" -chdir="$dir" validate 2>&1)" || findings="${findings}validate (${dir}):\n${out}\n\n"
  fi

  # 3. tflint — only if installed and configured nearby.
  if command -v tflint >/dev/null 2>&1; then
    cfg_found=""
    d="$dir"
    while :; do
      [ -f "$d/.tflint.hcl" ] && { cfg_found="$d/.tflint.hcl"; break; }
      [ "$d" = "/" ] && break
      d="${d%/*}"
      [ -n "$d" ] || d="/"
    done
    if [ -n "$cfg_found" ]; then
      out="$(tflint --chdir="$dir" 2>&1)" || findings="${findings}tflint (${dir}):\n${out}\n\n"
    fi
  fi
done

# Build the user-facing message (non-blocking). Stdout must be JSON-only when present.
msg=""
[ -n "$notice" ] && msg="$notice"
if [ -n "$findings" ]; then
  [ -n "$msg" ] && msg="${msg}\n\n"
  msg="${msg}HCL checks reported issues:\n${findings}"
fi
[ -z "$msg" ] && exit 0

jq -n --arg m "$(printf '%b' "$msg")" '{systemMessage:$m, suppressOutput:true}'
exit 0
