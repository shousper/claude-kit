---
description: Show or override the Terraform/OpenTofu CLI detected for this project
argument-hint: "[tofu|terraform]"
allowed-tools: Bash(*/hooks/shared/hcl-tool.sh:*)
---

The user wants to view or override which CLI (`tofu` or `terraform`) kit uses to format and validate
HCL in this project.

Run the kit helper with the user's argument (empty = show current; `tofu`/`terraform` = set override):

!`"${CLAUDE_PLUGIN_ROOT}/hooks/shared/hcl-tool.sh" command "$ARGUMENTS"`

Report the result to the user in one short sentence. If they passed no argument, tell them the
current/detected tool and that they can override it with `/kit:hcl-tool tofu` or
`/kit:hcl-tool terraform`.
