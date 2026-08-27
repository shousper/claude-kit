#!/usr/bin/env bash
# Neutral helpers shared by every kit hook script, across harnesses. Sourced,
# never executed directly. No top-level side effects. Plain args/env in,
# plain text out — no stdin JSON, no harness protocol of any kind.
#
# The formatter/checker table (gofmt, rustfmt, hcl, eslint, tsc, cargo) lives
# in format-files.sh, not here — that is its single source.

kit_state_dir() {  # KIT_STATE_DIR wins outright; else ~/.kit/state. Each harness's
  printf '%s' "${KIT_STATE_DIR:-$HOME/.kit/state}"   # protocol wrapper sets KIT_STATE_DIR.
}

# Per-agent/session scratch file for touched-file tracking. The caller resolves
# and exports KIT_SCRATCH_KEY (agent_id when inside a subagent, else session_id
# — a harness/protocol decision, made by the wrapper that owns that payload).
kit_scratch_file() {
  printf '%s/touched-%s.txt' "$(kit_state_dir)" "${KIT_SCRATCH_KEY:?KIT_SCRATCH_KEY required}"
}

# Gate at record time: is this a source path we format/check?
kit_is_handled() {  # kit_is_handled <path>
  case "$1" in
    */Cargo.toml|Cargo.toml) return 0 ;;
    *.go|*.rs|*.js|*.jsx|*.ts|*.tsx|*.mjs|*.cjs|*.tf|*.tofu|*.tofu.json|*.tfvars) return 0 ;;
    *) return 1 ;;
  esac
}

# Nearest ancestor dir (inclusive) containing <marker>; prints dir, or returns 1.
kit_nearest_dir() {  # kit_nearest_dir <start-dir> <marker>
  local d="$1"
  while :; do
    [ -e "$d/$2" ] && { printf '%s' "$d"; return 0; }
    [ "$d" = "/" ] && return 1
    d="${d%/*}"; [ -n "$d" ] || d="/"
  done
}

# Drop a leading YAML frontmatter block (--- ... ---) from a markdown file, if
# present; print the rest unchanged. No-op when the file doesn't start with one.
strip_frontmatter() {  # strip_frontmatter <file>
  awk '
    NR==1 && $0=="---" { infm=1; next }
    infm && $0=="---" { infm=0; next }
    infm { next }
    { print }
  ' "$1"
}

# Cheap, cwd-only hint: does <dir> itself (no ancestor walk) pin an HCL tool via
# a version-pin file? Prints the pinned tool name, or returns 1. NOT the
# authoritative resolution — see hcl-tool.sh for that (ancestor-aware, cached,
# also considers tracked *.tofu files and PATH availability).
kit_hcl_pin_hint() {  # kit_hcl_pin_hint <dir>
  local d="$1"
  [ -f "$d/.opentofu-version" ] && { printf 'tofu'; return 0; }
  { [ -f "$d/.terraform-version" ] || [ -f "$d/.tfswitchrc" ]; } && { printf 'terraform'; return 0; }
  return 1
}
