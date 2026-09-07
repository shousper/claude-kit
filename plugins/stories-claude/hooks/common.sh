# Sourced by the three hook wrappers. Everything here is Claude Code protocol
# plumbing: resolve the MAIN checkout root (hooks fire with cwd anywhere in the
# repo, including inside story worktrees where the marker is invisible to $PWD),
# test the marker, pull a field out of the hook's stdin JSON, escape for JSON.
# Every decision lives in the story CLI; a wrapper only translates.
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORY="${PLUGIN_ROOT}/bin/story"

# Prints the main checkout root, or fails outside a git repository.
stories_root() {
  local common
  common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  dirname "$common"
}

# True when the project runs the stories workflow (current or legacy layout —
# the CLI explains the migration on the legacy one).
stories_enabled() {
  [ -f "$1/.agents/shousper-stories/config.json" ] || [ -f "$1/.claude/story-workflow.json" ]
}

# First occurrence of a string-valued JSON field (no jq dependency; hook
# payloads serialize these fields before any free-text content). Known limit:
# the match is not escape-aware, so a value holding a literal `"` (\" in the
# JSON) is truncated at that quote. The truncated value keeps its directory
# prefix, which is all the guard classifies on, so the verdict is unaffected.
json_field() {
  printf '%s' "$1" \
    | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
    | head -n1 \
    | sed 's/.*:[[:space:]]*"\(.*\)"$/\1/' || true
}

escape_for_json() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}
