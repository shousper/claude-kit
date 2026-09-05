#!/usr/bin/env bash
# Lints one documentation file with Vale and prints a compact summary an agent
# can act on, or nothing at all. Neutral contract: plain args in, plain text out.
#
#   vale-lint.sh FILE [write|edit]
#
# edit mode keeps only findings on lines that differ from HEAD, so a small edit
# to a legacy file does not report that file's whole history. Always exits 0;
# a missing vale or jq binary is a silent no-op.
set -uo pipefail

file="${1:-}"; mode="${2:-write}"
[ -n "$file" ] && [ -f "$file" ] || exit 0
command -v vale >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0
case "$file" in *.md|*.mdx|*.rst|*.adoc|*.txt|*.html) ;; *) exit 0 ;; esac
abs="$(cd "$(dirname "$file")" && pwd -P)/$(basename "$file")"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
config="${WRITING_VALE_CONFIG:-$script_dir/../vale/.vale.ini}"
max_rules="${WRITING_VALE_MAX_RULES:-6}"
max_refs="${WRITING_VALE_MAX_REFS:-3}"

alerts="$(vale --config="$config" --no-global --no-exit --output=JSON "$file" 2>/dev/null)" || exit 0
[ -n "$alerts" ] || exit 0

# null = no filter (write mode, untracked file); a JSON array = only these lines.
lines="null"
if [ "$mode" = "edit" ]; then
  dir="$(dirname "$abs")"
  if git -C "$dir" ls-files --error-unmatch "$file" >/dev/null 2>&1; then
    lines="$(git -C "$dir" diff -U0 HEAD -- "$file" 2>/dev/null \
      | sed -n 's/^@@ -[0-9,]* +\([0-9]*\)\(,\([0-9]*\)\)\{0,1\} @@.*/\1 \3/p' \
      | jq -R -s -c '[splits("\n") | select(length > 0) | split(" ") | (.[0] | tonumber) as $s | (if .[1] == "" then 1 else (.[1] | tonumber) end) as $n | range($s; $s + $n)]')"
  fi
fi

cwd="$(pwd -P)"
rel="$abs"
case "$abs" in "$cwd"/*) rel="${abs#"$cwd"/}" ;; esac

printf '%s' "$alerts" | jq -r --arg rel "$rel" --argjson lines "$lines" --argjson maxRules "$max_rules" --argjson maxRefs "$max_refs" '
  [ to_entries[0].value[]? | select($lines == null or (.Line as $l | $lines | index($l) != null)) ]
  | if length == 0 then empty else
      (group_by(.Check)
        | map({rule: (.[0].Check | sub("^[^.]*\\."; "")), count: length,
               refs: (.[:$maxRefs] | map("line \(.Line) \"\(.Match)\"") | join("; ")),
               message: .[0].Message})
        | sort_by(-.count)) as $groups
      | "vale: \(length) findings in \($rel)",
        ($groups[:$maxRules][] | "  \(.rule) x\(.count)  \(.refs)\n      \(.message)"),
        (if ($groups | length) > $maxRules
         then "  +\([$groups[$maxRules:][].count] | add) more findings across \(($groups | length) - $maxRules) rules"
         else empty end)
    end'
exit 0
