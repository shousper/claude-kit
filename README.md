# kit

A Claude Code plugin that provides a complete development workflow — from brainstorming ideas through design, implementation, code review, and branch completion.

**Philosophy:** You control when work enters git history. Kit accumulates changes locally, lets you review holistically, and commits only when you say so. Planning documents stay out of version control. PRs are always created as drafts.

## Install

```bash
/install-plugin shousper/claude-kit
```

## Recommended Plugins

None are required, but these complement kit well:

| Plugin | Provides | Install |
|--------|----------|---------|
| [commit-commands](https://github.com/anthropics/claude-code-plugins) | `/commit` command for conventional commits | `/install-plugin commit-commands` |
| [claude-mem](https://github.com/thedotmack/claude-mem) | Persistent memory across sessions via automatic observation capture and semantic search | `/install-plugin thedotmack/claude-mem` |
| [pr-review-toolkit](https://github.com/anthropics/claude-code-plugins) | PR-focused review agents (silent failure hunting, type analysis, test coverage) | `/install-plugin pr-review-toolkit` |
| [code-review](https://github.com/anthropics/claude-code-plugins) | General code quality review agent | `/install-plugin code-review` |

## Workflow

Kit's default workflow chain:

```
brainstorming → writing-plans → team-dev → finish-branch
```

1. **Brainstorm** — Explore the idea, refine requirements, approve design
2. **Write plan** — Detailed implementation plan with TDD steps (no commit steps)
3. **Team dev** — Persistent teammates implement tasks in batches with review gates
4. **Finish branch** — Commit approved work, push, create draft PR

Each stage flows into the next automatically. You can enter at any point if you already have what the earlier stages produce.

## Skills (18)

### Core Workflow

| Skill | Description |
|---|---|
| `brainstorming` | Design exploration before implementation — creates worktree on approval |
| `writing-plans` | Create bite-sized implementation plans with TDD steps |
| `team-dev` | Execute plans with persistent teammates and batch-boundary reviews |
| `executing-plans` | Execute plans in a separate session (alternative to team-dev) |
| `finish-branch` | Complete development — commit, push, create draft PR |

### Development Practices

| Skill | Description |
|---|---|
| `tdd` | Test-driven development — write failing test first, implement minimally |
| `debugging` | Systematic debugging before proposing fixes |
| `code-review` | Verify implementation meets requirements at review checkpoints |
| `receiving-review` | Handle code review feedback with technical rigor |
| `verify` | Run verification before claiming work is complete |

### Infrastructure

| Skill | Description |
|---|---|
| `git-worktrees` | Create isolated git workspaces with smart directory selection |
| `worktree-cleanup` | Clean up worktrees when done — user-triggered only |
| `create-pr` | Create pull requests — drafts by default, uses repo PR template |
| `team-orchestration` | Set up team-based workflows with persistent teammates |
| `parallel-agents` | Dispatch independent tasks to parallel subagents |
| `github-work-summary` | Generate GitHub activity summaries for standups or reports |

### Meta

| Skill | Description |
|---|---|
| `using-kit` | Skill discovery and usage patterns — loaded at session start |
| `writing-skills` | Create, edit, and test skills |

## Hooks

| Event | Hook | Trigger |
|-------|------|---------|
| PostToolUse | gofmt | Write/Edit on `.go` files |
| PostToolUse | eslint | Write/Edit on JS/TS files |
| PostToolUse | typescript | Write/Edit on `.ts`/`.tsx` files |
| PostToolUse | clippy | Write/Edit on `.rs` files |
| PostToolUse | cargo-check | Write/Edit on `.rs` files |
| PostToolUse | rustfmt | Write/Edit on `.rs` files |
| SessionStart | session-start | Session startup, resume, clear, compact |

## Agents

| Agent | Description |
|-------|-------------|
| `code-reviewer` | Reviews completed project steps against plans and coding standards |

## Code Standards

Bundled coding standards for automatic reference when working with:

- **Go** — formatting, error handling, project structure
- **Rust** — clippy lints, formatting, idiomatic patterns
- **Python** — style, type hints, project conventions
- **Tailwind CSS** — utility classes, component patterns

## Tools

### claude-mem Backfill

`tools/claude-mem-backfill.mjs` — Backfills [claude-mem](https://github.com/thedotmack/claude-mem) with your historical Claude Code session logs. This is a workaround for claude-mem's currently broken import system.

**Requirements:** Node.js 18+, claude-mem installed and running. Zero external dependencies.

```bash
# List discoverable sessions
node tools/claude-mem-backfill.mjs --list

# Dry run — see what would be processed
node tools/claude-mem-backfill.mjs --dry-run

# Run backfill (5 concurrent by default)
node tools/claude-mem-backfill.mjs

# Only sessions after a date
node tools/claude-mem-backfill.mjs --after 2025-01-01

# Single session
node tools/claude-mem-backfill.mjs --session <uuid>
```

Resumable — tracks state in `~/.claude-mem/backfill-state.json`. Safe to interrupt with Ctrl+C and re-run.

## Credits

- [superpowers](https://github.com/obra/superpowers) by Jesse Vincent — kit's skill framework is heavily inspired by superpowers. MIT licensed.
- [ethpandaops/ai-cookbook](https://github.com/ethpandaops/ai-cookbook) — code standards and hook patterns for Go, Rust, Python, and Tailwind CSS.

## License

MIT

Note: The code standards bundled from ethpandaops/ai-cookbook currently have no upstream license; they are included with attribution.
