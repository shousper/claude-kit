# HCL (Terraform / OpenTofu) Standards

Standards for Terraform and OpenTofu configuration written in HCL. These apply to both CLIs — the
language is shared, so the rules below hold whether your project runs `terraform` or `tofu`. Grounded
in the HashiCorp Terraform Style Guide and the OpenTofu language docs.

The kit Stop hook formats and validates HCL automatically (see Tooling). It runs whichever CLI is
detected for the project; override with `/kit:hcl-tool tofu` or `/kit:hcl-tool terraform`.

## File extensions & layout

- `.tf` is the default extension and MUST be used for portable configuration that targets either CLI.
- `.tofu` / `.tofu.json` are OpenTofu-only overrides; use them ONLY when a file must diverge for
  OpenTofu. Prefer `.tf` unless you have a concrete reason to fork.
- `.tfvars` holds variable values, never resource or block definitions.
- Split configuration into conventional files rather than one large file:
  - `main.tf` — resources and data sources.
  - `variables.tf` — `variable` blocks, in alphabetical order.
  - `outputs.tf` — `output` blocks, in alphabetical order.
  - `versions.tf` (or `terraform.tf`) — the single `terraform`/`tofu` block with `required_version`
    and `required_providers`.
  - `providers.tf` — `provider` blocks and their configuration.
  - `locals.tf` — local values shared across multiple files.
- As a configuration grows, group resources into domain files (`network.tf`, `database.tf`) instead
  of letting `main.tf` sprawl.
- NEVER edit `.terraform.lock.hcl` by hand. It is managed by `init` and `providers lock`.
- NEVER commit `.terraform/`, `*.tfstate`, or `*.tfstate.backup` — they hold provider plugins and
  state (often sensitive).

## Formatting

- Code MUST be `fmt`-clean. The kit Stop hook runs `fmt` for you; do not commit unformatted HCL.
- Indent two spaces per nesting level.
- When consecutive single-line arguments share a nesting level, align their `=` signs:

  ```hcl
  ami           = "ami-abc123"
  instance_type = "t3.micro"
  ```

- Place all arguments at the top of a block body, then nested blocks below them, separated by one
  blank line. Separate top-level blocks with a single blank line.
- Use `#` for single-line and multi-line comments. Do NOT use `//` or `/* */`.

## Naming

- Use `snake_case` for the names of all objects: resources, data sources, variables, locals,
  outputs, and modules.
- Use descriptive nouns. Separate words with underscores.
- Do NOT repeat the resource type in the name. Write `resource "aws_instance" "web"`, not
  `resource "aws_instance" "web_instance"`.
- Wrap the resource type and name in double quotes in the block header.

## Variables

- Every `variable` MUST declare an explicit `type` and a `description`.
- Provide a sensible `default` for optional variables; omit `default` to make a variable required.
- Mark secrets with `sensitive = true` (passwords, tokens, private keys). Note: the value is still
  stored in state — see Anti-patterns for secret handling.
- Add a `validation` block ONLY for genuinely restrictive rules, with an actionable `error_message`.
- Avoid the bare `any` type. Prefer rich `object({ ... })` types so callers get real type checking.

```hcl
variable "db_instance_count" {
  type        = number
  description = "Number of database instances. This application requires at least two."

  validation {
    condition     = var.db_instance_count > 1
    error_message = "db_instance_count must be greater than 1."
  }
}

variable "db_password" {
  type        = string
  description = "Database password."
  sensitive   = true
}
```

## Outputs

- Every `output` MUST have a `description`.
- Order the arguments `description`, then `value`, then `sensitive` (when present).
- Mark any output exposing a secret with `sensitive = true`.

```hcl
output "web_public_ip" {
  description = "Public IP of the web instance."
  value       = aws_instance.web.public_ip
}
```

## Resources & meta-arguments

- Prefer `for_each` over `count`. Use `count` only for a simple on/off toggle
  (`count = var.enabled ? 1 : 0`); use `for_each` whenever instances need distinct values.
- Order arguments within a resource block consistently:
  1. `for_each` or `count` meta-argument (if present).
  2. Non-block arguments.
  3. Nested block arguments.
  4. `lifecycle` block (if present).
  5. `depends_on` (if required).
- Let code build on itself: define a data source before the resource that references it.
- Use `dynamic` blocks sparingly — only when the schema requires repeated nested blocks that you
  cannot write out statically.

```hcl
resource "aws_instance" "web" {
  for_each = toset(var.web_roles)

  ami           = data.aws_ami.web.id
  instance_type = "t3.micro"

  tags = {
    Name = "web_${each.key}"
  }
}
```

## Locals

- Use locals for computed or derived values and to name a repeated expression for readability.
- Do NOT use a local to alias a trivial expression that is only referenced once.
- Define a local in `locals.tf` if shared across files, or at the top of a file if local to it.

## Version & provider pinning

- The `terraform` (or `tofu`) block MUST set `required_version` to constrain the CLI version.
- Pin every provider in `required_providers` with an explicit `source` and a pessimistic `~>`
  version constraint.

```hcl
terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.34"
    }
  }
}
```

## Anti-patterns

- NEVER hardcode secrets or credentials in HCL. Source them from a secrets manager or
  provider-specific environment variables; remember Terraform/OpenTofu still write them to state.
- Do NOT declare `provider` blocks inside reusable modules. Pass providers in from the root module.
- Avoid coupling configurations with `terraform_remote_state` when a plain data source can read the
  same value directly.
- Do NOT disable or skip `fmt`.
- Overusing variables and locals harms readability — expose a variable only when the value genuinely
  changes between deployments.

## Tooling

- `fmt` — formats configuration to the canonical style. The kit Stop hook ALWAYS runs this.
- `validate` — checks configuration correctness; requires an initialized directory (`init` first).
  The kit hook runs it only when `.terraform/` already exists, and never runs `init` for you.
- `tflint` — lints against provider rules and best practices; requires a `.tflint.hcl` config. The
  kit hook runs it only when `tflint` is installed and a config is found.
