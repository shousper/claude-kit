#!/usr/bin/env bash
# Shared Terraform/OpenTofu tool detection + per-project state for kit HCL hooks.
# Invoked as a subprocess (never sourced):
#   hcl-tool.sh root <dir>         print project root (git toplevel or <dir>)
#   hcl-tool.sh detect <dir>       print detected tool from signals (no cache)
#   hcl-tool.sh get <dir>          print cached tool for project ("" if none)
#   hcl-tool.sh set <dir> <tool>   cache <tool> as an override (tofu|terraform)
#   hcl-tool.sh resolve <dir>      print cached tool, else detect + cache (atomic)
#   hcl-tool.sh first-detect <dir> print tool iff THIS call first-detected it (atomic)
#   hcl-tool.sh is-hcl <dir>       exit 0 if project tracks .tf/.tofu/.tfvars
#   hcl-tool.sh command [tool]     slash-command helper (show, or set from cwd)
set -uo pipefail

config_dir() { printf '%s' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; }
state_file() { printf '%s/kit/hcl-tool.json' "$(config_dir)"; }

# Serialize state read-modify-write across concurrent hook processes (e.g. many
# SubagentStop runs editing HCL). mkdir is atomic and portable (no flock needed
# on macOS); held only for the brief check-and-set. A ~3s ceiling then proceeds
# anyway so a stale lock from a killed process can't deadlock the Stop hook.
with_lock() {  # with_lock <fn> [args...] — run fn while holding the state lock
  local lock tries=0; lock="$(state_file).lock"
  mkdir -p "$(dirname "$lock")"
  until mkdir "$lock" 2>/dev/null; do
    tries=$((tries + 1)); [ "$tries" -gt 60 ] && break
    sleep 0.05
  done
  "$@"; local rc=$?
  rmdir "$lock" 2>/dev/null || true
  return "$rc"
}

project_root() {
  git -C "$1" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$1"
}

ancestors() {
  local dir
  dir="$(cd "$1" 2>/dev/null && pwd)" || return 0
  while :; do
    printf '%s\n' "$dir"
    [ "$dir" = "/" ] && break
    dir="${dir%/*}"          # strip last path segment (avoids external dirname)
    [ -n "$dir" ] || dir="/"
  done
}

detect_from_pins() {
  local dir
  while IFS= read -r dir; do
    if [ -f "$dir/.opentofu-version" ]; then echo tofu; return 0; fi
    if [ -f "$dir/.terraform-version" ] || [ -f "$dir/.tfswitchrc" ]; then echo terraform; return 0; fi
    if [ -f "$dir/.tool-versions" ]; then
      if grep -qE '^opentofu[[:space:]]' "$dir/.tool-versions"; then echo tofu; return 0; fi
      if grep -qE '^terraform[[:space:]]' "$dir/.tool-versions"; then echo terraform; return 0; fi
    fi
    local m
    for m in "$dir/mise.toml" "$dir/.mise.toml"; do
      [ -f "$m" ] || continue
      if grep -q 'opentofu' "$m"; then echo tofu; return 0; fi
      if grep -q 'terraform' "$m"; then echo terraform; return 0; fi
    done
  done < <(ancestors "$1")
  return 1
}

detect_from_tofu_files() {
  local root found
  root="$(project_root "$1")"
  if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    found="$(git -C "$root" ls-files '*.tofu' '*.tofu.json' 2>/dev/null | head -n1)"
  else
    found="$(find "$root" \( -name .git -o -name .terraform \) -prune -o -type f \( -name '*.tofu' -o -name '*.tofu.json' \) -print 2>/dev/null | head -n1)"
  fi
  [ -n "$found" ] || return 1
  echo tofu
}

detect_from_path() {
  local have_tofu=0 have_tf=0
  command -v tofu >/dev/null 2>&1 && have_tofu=1
  command -v terraform >/dev/null 2>&1 && have_tf=1
  if [ "$have_tofu" = 1 ] && [ "$have_tf" = 0 ]; then echo tofu; return 0; fi
  if [ "$have_tf" = 1 ] && [ "$have_tofu" = 0 ]; then echo terraform; return 0; fi
  return 1
}

detect() {
  detect_from_pins "$1" && return 0
  detect_from_tofu_files "$1" && return 0
  detect_from_path "$1" && return 0
  echo tofu  # fallback (OpenTofu-motivated; fmt output is identical, user can override)
}

ensure_state() {
  local f; f="$(state_file)"
  mkdir -p "$(dirname "$f")"
  [ -f "$f" ] || printf '{"projects":{}}' > "$f"
  printf '%s' "$f"
}

get_tool() {
  local f; f="$(state_file)"
  [ -f "$f" ] || return 0
  jq -r --arg p "$(project_root "$1")" '.projects[$p].tool // ""' "$f" 2>/dev/null || true
}

put_tool() {  # put_tool <root> <tool> <source>
  local f tmp; f="$(ensure_state)"; tmp="$(mktemp)"
  if jq --arg p "$1" --arg t "$2" --arg s "$3" '.projects[$p] = {tool:$t, source:$s}' "$f" > "$tmp"; then
    mv "$tmp" "$f"
  else
    rm -f "$tmp"; return 1
  fi
}

set_tool() {  # set_tool <dir> <tool>
  case "$2" in
    tofu|terraform) ;;
    *) echo "invalid tool: $2 (use tofu|terraform)" >&2; return 2 ;;
  esac
  with_lock put_tool "$(project_root "$1")" "$2" override && echo "$2"
}

_resolve_locked() {
  local cached; cached="$(get_tool "$1")"
  if [ -n "$cached" ]; then printf '%s\n' "$cached"; return 0; fi
  local t; t="$(detect "$1")"
  put_tool "$(project_root "$1")" "$t" detected
  printf '%s\n' "$t"
}
resolve_tool() { with_lock _resolve_locked "$1"; }

# Atomic claim of the first detection: prints the tool ONLY if THIS call performed
# it (else prints nothing). Lets a hook fire the "detected" notice exactly once per
# project, even when concurrent invocations race.
_first_detect_locked() {
  [ -n "$(get_tool "$1")" ] && return 0   # already decided → not the first
  local t; t="$(detect "$1")"
  put_tool "$(project_root "$1")" "$t" detected
  printf '%s\n' "$t"
}
first_detect() { with_lock _first_detect_locked "$1"; }

is_hcl() {
  local root found; root="$(project_root "$1")"
  if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    found="$(git -C "$root" ls-files '*.tf' '*.tofu' '*.tfvars' 2>/dev/null | head -n1)"
  else
    found="$(find "$root" \( -name .git -o -name .terraform \) -prune -o -type f \( -name '*.tf' -o -name '*.tofu' -o -name '*.tfvars' \) -print 2>/dev/null | head -n1)"
  fi
  [ -n "$found" ]
}

cmd_command() {  # slash-command helper; runs from the user's cwd
  local dir cur; dir="$(pwd)"
  if [ -z "${1:-}" ]; then
    cur="$(get_tool "$dir")"
    if [ -n "$cur" ]; then echo "HCL tool for this project: $cur"
    else echo "HCL tool not set; detected: $(detect "$dir")"; fi
    return 0
  fi
  set_tool "$dir" "$1" >/dev/null && echo "HCL tool for this project set to: $1"
}

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    root)    project_root "${1:?dir required}" ;;
    detect)  detect "${1:?dir required}" ;;
    get)     get_tool "${1:?dir required}" ;;
    set)     set_tool "${1:?dir required}" "${2:?tool required}" ;;
    resolve) resolve_tool "${1:?dir required}" ;;
    first-detect) first_detect "${1:?dir required}" ;;
    is-hcl)  is_hcl "${1:?dir required}" ;;
    command) cmd_command "${1:-}" ;;
    *) echo "usage: hcl-tool.sh {root|detect|get|set|resolve|first-detect|is-hcl|command} ..." >&2; exit 2 ;;
  esac
}

main "$@"
