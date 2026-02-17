# claude-kit Plugin Design

## Overview

A personal Claude Code plugin that consolidates skills, commands, hooks, agents, and code standards into a single repository. Replaces the `superpowers` and `episodic-memory` plugins with a self-maintained, publicly distributable package.

**Plugin name:** `kit`
**Repository:** `shousper/claude-kit`
**License:** MIT (public)

## Phases

### Phase 1: Foundation (This PR)

Fork all superpowers skills, migrate personal commands and hooks, bundle code standards. Result: a fully functional plugin that replaces superpowers + scattered personal config.

### Phase 2: Team Experiments

Explore team-aware skills. Modify existing skills to optionally leverage Claude Code teams. Experiment with multi-agent patterns.

### Phase 3: Memory System

Build custom memory MCP server (informed by real-world claude-mem experience). Bootstrap from existing conversation history. Add memory skill + agent.

## Plugin Structure

```
claude-kit/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── skills/
│   ├── brainstorming/SKILL.md
│   ├── tdd/SKILL.md
│   ├── debugging/SKILL.md
│   ├── writing-plans/SKILL.md
│   ├── executing-plans/SKILL.md
│   ├── code-review/SKILL.md
│   ├── receiving-review/SKILL.md
│   ├── finish-branch/SKILL.md
│   ├── git-worktrees/SKILL.md
│   ├── parallel-agents/SKILL.md
│   ├── subagent-dev/SKILL.md
│   ├── verify/SKILL.md
│   ├── writing-skills/SKILL.md
│   └── using-kit/SKILL.md
├── commands/
│   ├── commit-staged.md
│   ├── create-pr.md
│   └── github-work-summary.md
├── agents/
│   └── code-reviewer.md
├── hooks/
│   ├── hooks.json
│   ├── session-start.sh
│   ├── gofmt.sh
│   ├── eslint.sh
│   ├── typescript.sh
│   ├── clippy.sh
│   ├── cargo-check.sh
│   └── rustfmt.sh
├── code-standards/
│   ├── go/CLAUDE.md
│   ├── rust/CLAUDE.md
│   ├── python/CLAUDE.md
│   └── tailwindcss/CLAUDE.md
├── README.md
└── LICENSE
```

## Skills

14 skills forked from superpowers with the following changes:

| Superpowers Name | Kit Name | Changes |
|---|---|---|
| brainstorming | brainstorming | Remove auto-git-commit of design docs |
| test-driven-development | tdd | Rename only |
| systematic-debugging | debugging | Rename only |
| writing-plans | writing-plans | No change |
| executing-plans | executing-plans | No change |
| requesting-code-review | code-review | Rename only |
| receiving-code-review | receiving-review | Rename only |
| finishing-a-development-branch | finish-branch | Rename only |
| using-git-worktrees | git-worktrees | Rename only |
| dispatching-parallel-agents | parallel-agents | Rename only |
| subagent-driven-development | subagent-dev | Rename only |
| verification-before-completion | verify | Rename only |
| writing-skills | writing-skills | No change |
| using-superpowers | using-kit | Update all internal references |

### Cross-cutting changes across all skills

- Replace all `superpowers:` references with `kit:`
- Replace all `using-superpowers` references with `using-kit`
- Remove any auto-commit behavior (user commits when they want)

## Commands

3 commands migrated from `~/.claude/commands/`:

- **commit-staged** — Commit only staged files, don't add anything else
- **create-pr** — Create PR using repo template, push branch if needed
- **github-work-summary** — Fetch GitHub activity for a period, summarize contributions

## Agents

- **code-reviewer** — Forked from superpowers, reviews code against plan and standards

## Hooks

### hooks.json

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/gofmt.sh" }] },
      { "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/eslint.sh" }] },
      { "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/typescript.sh" }] },
      { "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/clippy.sh" }] },
      { "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/cargo-check.sh" }] },
      { "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/rustfmt.sh" }] }
    ],
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh" }] }
    ]
  }
}
```

### Hook scripts

All 6 code standards hooks migrated from `~/.claude/hooks/ethpandaops/`. The `always-ultrathink.sh` hook is dropped (redundant with Opus 4.6).

### Session start hook

Forked from superpowers session-start.sh. Handles plugin initialization.

## Code Standards

Bundled inside the plugin at `code-standards/`. Contains CLAUDE.md files for:
- Go
- Rust
- Python
- Tailwind CSS

The session-start hook or CLAUDE.md injection references `${CLAUDE_PLUGIN_ROOT}/code-standards/` for language-specific standards loading.

## Distribution

Self-hosted marketplace in the same repository.

**marketplace.json:**
```json
{
  "name": "shousper-kit",
  "description": "Personal Claude Code toolkit",
  "plugins": [{
    "name": "kit",
    "description": "Skills, commands, hooks, and agents for my workflow",
    "version": "1.0.0",
    "source": "./"
  }]
}
```

**Install:**
```bash
/plugin marketplace add shousper/claude-kit
/plugin install kit
```

## Post-Install Cleanup

After installing kit:
1. Uninstall `superpowers@superpowers-marketplace`
2. Uninstall `episodic-memory@superpowers-marketplace`
3. Remove ethpandaops hooks from `~/.claude/settings.json`
4. Remove `~/.claude/ethpandaops/` directory
5. Remove ethpandaops CLAUDE.md injection block from `~/.claude/CLAUDE.md`
6. Remove personal commands from `~/.claude/commands/` (commit-staged, create-pr, github-work-summary)
7. Install claude-mem for memory (Phase 3 experiment)

## Dependencies

- `claude-code-plugins` marketplace — kept installed separately (default plugins)
- `rust-analyzer-lsp` + `typescript-lsp` — kept installed separately (official LSP plugins)
- No runtime dependencies for Phase 1 (all hooks are shell scripts)

## Future Work (Phase 2+)

- Team workflow skills leveraging Claude Code teams
- Modified existing skills to optionally use multi-agent patterns
- Custom memory MCP server (Phase 3, after evaluating claude-mem)
