#!/usr/bin/env bash
# Shared helpers for the kit formatter pipeline (record.sh + format-on-stop.sh).
# Sourced, never executed directly. No top-level side effects.

kit_config_dir() { printf '%s' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; }
kit_state_dir()  { printf '%s/kit/state' "$(kit_config_dir)"; }

# Scratch key: agent_id when inside a subagent, else session_id.
kit_scratch_key() {  # kit_scratch_key <input-json>
  local agent session
  agent="$(printf '%s' "$1" | jq -r '.agent_id // ""')"
  session="$(printf '%s' "$1" | jq -r '.session_id // "unknown"')"
  printf '%s' "${agent:-$session}"
}
kit_scratch_file() { printf '%s/touched-%s.txt' "$(kit_state_dir)" "$(kit_scratch_key "$1")"; }

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

# select_files <glob>...  — from KIT_FILES[] (set by the dispatcher), print existing
# files matching any glob, one per line.
select_files() {
  local f g
  for f in "${KIT_FILES[@]}"; do
    [ -f "$f" ] || continue
    # $g is intentionally an unquoted glob pattern (e.g. *.go) for case matching.
    # shellcheck disable=SC2254
    for g in "$@"; do case "$f" in $g) printf '%s\n' "$f"; break ;; esac; done
  done
}

# Handlers: receive a newline-separated file list ($1), print a finding (or nothing).
# Formatters mutate files in place; on success they print nothing. They MUST keep
# tool output off stdout (the dispatcher captures all handler stdout into the
# user-facing systemMessage).
handle_gofmt() {
  [ -n "$1" ] || return 0
  command -v gofmt >/dev/null 2>&1 || return 0
  local fs; mapfile -t fs <<<"$1"
  gofmt -w "${fs[@]}" >/dev/null 2>&1 || true   # formatter: no finding on success
}
handle_rustfmt() {
  [ -n "$1" ] || return 0
  command -v rustfmt >/dev/null 2>&1 || return 0
  local fs; mapfile -t fs <<<"$1"
  rustfmt "${fs[@]}" >/dev/null 2>&1 || true
}
# HCL: fmt touched files (per directory), validate if initialized, tflint if
# configured. Reuses hcl-tool.sh (unchanged) via KIT_HOOKS_DIR for detection/state.
# Ported from hooks/hcl-fmt.sh:31-86 — stdin/scratch plumbing now lives in the
# dispatcher; notice+findings are returned as this handler's printed string.
handle_hcl() {
  [ -n "$1" ] || return 0
  local hcl_tool="${KIT_HOOKS_DIR}/hcl-tool.sh"
  [ -x "$hcl_tool" ] || return 0

  local files dirs
  mapfile -t files <<<"$1"
  mapfile -t dirs < <(printf '%s\n' "${files[@]}" | while IFS= read -r f; do dirname "$f"; done | sort -u)

  local notice="" findings="" dir in_dir f fresh tool other out cfg_found d
  for dir in "${dirs[@]}"; do
    [ -d "$dir" ] || continue

    in_dir=()
    for f in "${files[@]}"; do
      [ "$(dirname "$f")" = "$dir" ] && [ -f "$f" ] && in_dir+=("$f")
    done
    [ "${#in_dir[@]}" -gt 0 ] || continue

    # Atomically claim the first detection (locked check-and-set in hcl-tool.sh):
    # `fresh` is non-empty only for the single invocation that first detects this
    # project, so the notice fires exactly once even under concurrent runs.
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

  # Print notice + findings (the dispatcher folds this into the systemMessage).
  local msg=""
  [ -n "$notice" ] && msg="$notice"
  if [ -n "$findings" ]; then
    [ -n "$msg" ] && msg="${msg}\n\n"
    msg="${msg}HCL checks reported issues:\n${findings}"
  fi
  [ -z "$msg" ] && return 0
  printf '%b' "$msg"
}
# --- eslint discovery (ported from hooks/eslint.sh) ---------------------------

# Does <package.json> declare eslint in (dev)dependencies?
kit_has_eslint_dep() {  # kit_has_eslint_dep <package.json>
  [ -f "$1" ] || return 1
  jq -e '.dependencies.eslint or .devDependencies.eslint' "$1" >/dev/null 2>&1
}

# Walk from <dir> up to <root> (inclusive) for the nearest dir holding an eslint
# config file (v9 flat or legacy). Prints the dir, or returns 1.
kit_nearest_eslint_config() {  # kit_nearest_eslint_config <dir> <root>
  local d="$1" cfg
  while :; do
    for cfg in eslint.config.js eslint.config.mjs eslint.config.cjs \
               .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml .eslintrc.yaml .eslintrc; do
      [ -f "$d/$cfg" ] && { printf '%s' "$d"; return 0; }
    done
    [ "$d" = "$2" ] && return 1
    case "$d" in "$2"/*) ;; *) return 1 ;; esac   # never walk above <root>
    [ "$d" = "/" ] && return 1
    d="${d%/*}"; [ -n "$d" ] || d="/"
  done
}

# Resolve the eslint config dir for a touched file, honoring eslint.sh's gates:
# npm prefix must exist and be within CWD; a package.json with an eslint dep must
# exist between the file dir and CWD; and a config file must exist below that.
# Prints the config dir, or returns 1 (caller skips silently).
kit_eslint_config_dir() {  # kit_eslint_config_dir <file> <cwd>
  local file_dir prefix proj cur
  file_dir="$(dirname "$1")"
  prefix="$(cd "$file_dir" 2>/dev/null && npm prefix 2>/dev/null)"
  [ -n "$prefix" ] || return 1
  case "$prefix" in "$2"|"$2"/*) ;; *) return 1 ;; esac   # within CWD only

  proj=""; cur="$file_dir"
  while :; do
    if [ -f "$cur/package.json" ] && kit_has_eslint_dep "$cur/package.json"; then
      proj="$cur"; break
    fi
    case "$cur" in "$2"|"$2"/*) ;; *) break ;; esac
    [ "$cur" = "$2" ] && break
    [ "$cur" = "/" ] && break
    cur="${cur%/*}"; [ -n "$cur" ] || cur="/"
  done
  [ -n "$proj" ] || return 1

  kit_nearest_eslint_config "$file_dir" "$proj"
}

# eslint: group touched js/ts files by resolved config dir; run `npx eslint --fix`
# once per group (cd into the config dir). Non-zero exit → collect output as a
# finding string (NEVER decision:block). Silent-skip when npx/config/dep absent.
handle_eslint() {
  [ -n "$1" ] || return 0
  command -v npx >/dev/null 2>&1 || return 0

  local cwd files f cfgdir
  cwd="$(pwd)"
  mapfile -t files <<<"$1"

  # Resolve each file's config dir ONCE (npm prefix spawns a Node process), into a
  # file→dir map; collect the unique config-dir set in the same pass.
  local -a cfgdirs=()
  declare -A file2cfg=() seen=()
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    cfgdir="$(kit_eslint_config_dir "$f" "$cwd")" || continue
    file2cfg[$f]="$cfgdir"
    [ -n "${seen[$cfgdir]:-}" ] && continue
    seen[$cfgdir]=1; cfgdirs+=("$cfgdir")
  done
  [ "${#cfgdirs[@]}" -gt 0 ] || return 0

  local findings="" out group
  for cfgdir in "${cfgdirs[@]}"; do
    group=()
    for f in "${!file2cfg[@]}"; do
      [ "${file2cfg[$f]}" = "$cfgdir" ] && group+=("$f")
    done
    [ "${#group[@]}" -gt 0 ] || continue
    if ! out="$(cd "$cfgdir" && npx eslint --fix "${group[@]}" 2>&1)"; then
      [ -n "$out" ] && findings="${findings}eslint (${cfgdir}):\n${out}\n\n"
    fi
  done

  [ -z "$findings" ] && return 0
  printf 'eslint reported issues:\n'
  printf '%b' "$findings"
}
# --- tsc discovery (ported from hooks/typescript.sh) --------------------------

# Does <package.json> declare typescript in (dev)dependencies?
kit_has_typescript_dep() {  # kit_has_typescript_dep <package.json>
  [ -f "$1" ] || return 1
  jq -e '.dependencies.typescript or .devDependencies.typescript' "$1" >/dev/null 2>&1
}

# Walk from <dir> up to <root> (inclusive) for the nearest dir holding tsconfig.json.
kit_nearest_tsconfig() {  # kit_nearest_tsconfig <dir> <root>
  local d="$1"
  while :; do
    [ -f "$d/tsconfig.json" ] && { printf '%s' "$d"; return 0; }
    [ "$d" = "$2" ] && return 1
    case "$d" in "$2"/*) ;; *) return 1 ;; esac
    [ "$d" = "/" ] && return 1
    d="${d%/*}"; [ -n "$d" ] || d="/"
  done
}

# Resolve the tsconfig dir for a touched .ts file, honoring typescript.sh's gates
# (npm prefix within CWD; package.json with typescript dep; tsconfig below it).
# Prints the tsconfig dir, or returns 1 (caller skips silently).
kit_tsc_config_dir() {  # kit_tsc_config_dir <file> <cwd>
  local file_dir prefix proj cur
  file_dir="$(dirname "$1")"
  prefix="$(cd "$file_dir" 2>/dev/null && npm prefix 2>/dev/null)"
  [ -n "$prefix" ] || return 1
  case "$prefix" in "$2"|"$2"/*) ;; *) return 1 ;; esac

  proj=""; cur="$file_dir"
  while :; do
    if [ -f "$cur/package.json" ] && kit_has_typescript_dep "$cur/package.json"; then
      proj="$cur"; break
    fi
    case "$cur" in "$2"|"$2"/*) ;; *) break ;; esac
    [ "$cur" = "$2" ] && break
    [ "$cur" = "/" ] && break
    cur="${cur%/*}"; [ -n "$cur" ] || cur="/"
  done
  [ -n "$proj" ] || return 1

  kit_nearest_tsconfig "$file_dir" "$proj"
}

# tsc: group touched .ts/.tsx by resolved tsconfig project; run `npx tsc --noEmit`
# once per project (cd into the config dir). Non-zero exit → output as a finding
# (NEVER decision:block). Silent-skip when npx/dep/tsconfig absent.
handle_tsc() {
  [ -n "$1" ] || return 0
  command -v npx >/dev/null 2>&1 || return 0

  local cwd files f cfgdir
  cwd="$(pwd)"
  mapfile -t files <<<"$1"

  local -a cfgdirs=()
  declare -A seen=()
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    cfgdir="$(kit_tsc_config_dir "$f" "$cwd")" || continue
    [ -n "${seen[$cfgdir]:-}" ] && continue
    seen[$cfgdir]=1; cfgdirs+=("$cfgdir")
  done
  [ "${#cfgdirs[@]}" -gt 0 ] || return 0

  local findings="" out
  for cfgdir in "${cfgdirs[@]}"; do
    if ! out="$(cd "$cfgdir" && npx tsc --noEmit --pretty false 2>&1)"; then
      [ -n "$out" ] && findings="${findings}tsc (${cfgdir}):\n${out}\n\n"
    fi
  done

  [ -z "$findings" ] && return 0
  printf 'tsc reported issues:\n'
  printf '%b' "$findings"
}

# Rust checks: from touched .rs/Cargo.toml, derive the unique nearest-Cargo.toml
# crate dirs; per crate run `cargo check` and `cargo clippy` once (clippy strict
# with `-D warnings` when a clippy.toml is present, matching hooks/clippy.sh).
# Findings are non-blocking. Skip silently if cargo is absent.
handle_rust_checks() {
  [ -n "$1" ] || return 0
  command -v cargo >/dev/null 2>&1 || return 0

  local files f dir crate
  mapfile -t files <<<"$1"

  # One nearest-Cargo.toml resolution per file → unique crate dir set.
  local -a crates=()
  declare -A seen=()
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    crate="$(kit_nearest_dir "$(dirname "$f")" Cargo.toml)" || continue
    [ -n "${seen[$crate]:-}" ] && continue
    seen[$crate]=1; crates+=("$crate")
  done
  [ "${#crates[@]}" -gt 0 ] || return 0

  local findings="" out
  for dir in "${crates[@]}"; do
    if ! out="$(cd "$dir" && cargo check --message-format=short 2>&1)"; then
      [ -n "$out" ] && findings="${findings}cargo check (${dir}):\n${out}\n\n"
    fi
    local clippy_args=(clippy --message-format=short)
    { [ -f "$dir/.clippy.toml" ] || [ -f "$dir/clippy.toml" ]; } && clippy_args+=(-- -D warnings)
    if ! out="$(cd "$dir" && cargo "${clippy_args[@]}" 2>&1)"; then
      [ -n "$out" ] && findings="${findings}cargo clippy (${dir}):\n${out}\n\n"
    fi
  done

  [ -z "$findings" ] && return 0
  printf 'Rust checks reported issues:\n'
  printf '%b' "$findings"
}
