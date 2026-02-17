# kit

Personal Claude Code plugin — skills, commands, hooks, and agents.

## Install

```bash
/plugin marketplace add shousper/claude-kit
/plugin install kit
```

## What's Included

### Skills (14)

| Skill | Description |
|---|---|
| `using-kit` | Establishes how to find and use skills |
| `brainstorming` | Design exploration before implementation |
| `tdd` | Test-driven development |
| `debugging` | Systematic debugging |
| `writing-plans` | Create implementation plans |
| `executing-plans` | Execute plans with checkpoints |
| `code-review` | Request code review |
| `receiving-review` | Handle code review feedback |
| `finish-branch` | Complete development branches |
| `git-worktrees` | Isolated git workspaces |
| `parallel-agents` | Dispatch parallel subagents |
| `subagent-dev` | Subagent-driven development |
| `verify` | Verification before completion |
| `writing-skills` | Create and test skills |

### Commands (3)

- `/kit:commit-staged` — Commit staged files only
- `/kit:create-pr` — Create pull request
- `/kit:github-work-summary` — GitHub activity summary

### Hooks

- **PostToolUse**: gofmt, eslint, typescript, clippy, cargo-check, rustfmt
- **SessionStart**: Plugin initialization and context injection

### Agents (1)

- **code-reviewer** — Reviews code against plan and standards

### Code Standards

Bundled standards for Go, Rust, Python, and Tailwind CSS.

## Post-Install Cleanup

After installing kit, remove the replaced plugins and config:

1. `/plugin uninstall superpowers`
2. `/plugin uninstall episodic-memory`
3. Remove ethpandaops hooks from `~/.claude/settings.json`
4. Remove `~/.claude/ethpandaops/` directory
5. Remove ethpandaops block from `~/.claude/CLAUDE.md`
6. Remove personal commands from `~/.claude/commands/` (commit-staged, create-pr, github-work-summary)

## License

MIT
