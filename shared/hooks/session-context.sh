#!/usr/bin/env bash
# Neutral SessionStart body: the using-kit governance content, followed by an
# HCL toolchain pin hint when <cwd> pins one. Plain text on stdout — no JSON,
# no escaping; the caller (a harness-specific wrapper) embeds this verbatim.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=lib.sh disable=SC1091
. "${script_dir}/lib.sh"

plugin_root="${KIT_PLUGIN_ROOT:?KIT_PLUGIN_ROOT is required}"
cwd="${1:-$PWD}"

using_kit_content="$(strip_frontmatter "${plugin_root}/skills/using-kit/SKILL.md" 2>/dev/null)"
[ -n "$using_kit_content" ] || using_kit_content="Error reading using-kit skill"

cat <<EOF
<EXTREMELY_IMPORTANT>
You have kit.

**Below is the full content of your 'kit:using-kit' skill - your introduction to using skills. For all other skills, load them through your environment's skill-loading mechanism:**

${using_kit_content}

</EXTREMELY_IMPORTANT>
Before editing Go, Rust, Python, Tailwind CSS, or HCL (Terraform/OpenTofu) files, invoke the kit:code-standards skill to load language-specific coding standards.
EOF

if tool="$(kit_hcl_pin_hint "$cwd")"; then
  printf '\nThis project pins its HCL tool to %s (detected from a version-pin file in %s).\n' "$tool" "$cwd"
fi
