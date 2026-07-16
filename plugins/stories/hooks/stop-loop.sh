#!/usr/bin/env bash
# Stop hook for the stories plugin: hand the turn-end decision to the story CLI.
# The CLI owns loop state, budgets, and the doctor backstop (story loop tick --hook);
# this script stays a thin, non-fatal pipe that echoes the CLI's JSON verbatim.
# It deliberately ignores stop_hook_active: the tick keeps its own iteration
# counter with global + per-story budgets (design §10). For boards that need
# more than 8 consecutive blocked stops without progress, document
# CLAUDE_CODE_STOP_HOOK_BLOCK_CAP — do not remove the budgets.
set -euo pipefail
[ -f .claude/story-workflow.json ] || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
STORY="$(cd "${SCRIPT_DIR}/.." && pwd)/bin/story"

# The hook's stdin (the Stop event JSON) flows through the command substitution
# into the CLI. Never fail: a broken CLI must not wedge stopping.
out="$("$STORY" loop tick --hook 2>/dev/null || true)"
printf '%s\n' "$out"
exit 0
