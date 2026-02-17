# Phase 1: Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use kit:executing-plans to implement this plan task-by-task.

**Goal:** Create the `kit` plugin with all forked skills, migrated commands/hooks/agents, and bundled code standards — ready to install and replace superpowers + scattered personal config.

**Architecture:** Single Claude Code plugin repo with `.claude-plugin/plugin.json` manifest, skills/commands/agents/hooks directories, and bundled code standards. All `superpowers:` references replaced with `kit:`. No runtime dependencies.

**Tech Stack:** Markdown (skills/commands/agents), Bash (hooks), JSON (config)

---

### Task 1: Plugin Manifest & Marketplace Config

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `LICENSE`
- Create: `.gitignore`

**Step 1: Create plugin manifest**

```json
// .claude-plugin/plugin.json
{
  "name": "kit",
  "description": "Personal Claude Code toolkit - skills, commands, hooks, and agents",
  "version": "1.0.0",
  "author": {
    "name": "shousper"
  },
  "homepage": "https://github.com/shousper/claude-kit",
  "repository": "https://github.com/shousper/claude-kit",
  "license": "MIT",
  "keywords": ["skills", "tdd", "debugging", "workflows", "code-standards"]
}
```

**Step 2: Create marketplace manifest**

```json
// .claude-plugin/marketplace.json
{
  "name": "shousper-kit",
  "description": "Personal Claude Code toolkit",
  "owner": {
    "name": "shousper"
  },
  "plugins": [
    {
      "name": "kit",
      "description": "Skills, commands, hooks, and agents for my workflow",
      "version": "1.0.0",
      "source": "./"
    }
  ]
}
```

**Step 3: Create LICENSE (MIT)**

Standard MIT license with "shousper" as copyright holder, year 2026.

**Step 4: Create .gitignore**

```
node_modules/
.DS_Store
*.swp
```

**Step 5: Verify structure**

Run: `ls -la .claude-plugin/`
Expected: `plugin.json` and `marketplace.json` present

**Step 6: Commit**

```bash
git add .claude-plugin/ LICENSE .gitignore
git commit -m "feat: add plugin manifest, marketplace config, and license"
```

---

### Task 2: Fork Skills from Superpowers (Batch 1 — Core Workflow)

Fork the 7 core workflow skills. For each, copy the SKILL.md (and supporting files), then apply cross-cutting changes:
- Replace `superpowers:` with `kit:` in all references
- Replace `using-superpowers` with `using-kit`
- Replace `superpowers:test-driven-development` with `kit:tdd`
- Replace `superpowers:systematic-debugging` with `kit:debugging`
- Replace `superpowers:requesting-code-review` with `kit:code-review`
- Replace `superpowers:receiving-code-review` with `kit:receiving-review`
- Replace `superpowers:finishing-a-development-branch` with `kit:finish-branch`
- Replace `superpowers:verification-before-completion` with `kit:verify`
- Replace `superpowers:using-git-worktrees` with `kit:git-worktrees`
- Replace `superpowers:dispatching-parallel-agents` with `kit:parallel-agents`
- Replace `superpowers:subagent-driven-development` with `kit:subagent-dev`
- Replace `superpowers:executing-plans` with `kit:executing-plans`
- Replace `superpowers:writing-plans` with `kit:writing-plans`
- Replace `superpowers:writing-skills` with `kit:writing-skills`
- Replace `superpowers:brainstorming` with `kit:brainstorming`
- Replace `superpowers:code-reviewer` with `kit:code-reviewer`
- Update `name:` in frontmatter to match new skill directory name
- Update `description:` in frontmatter to remove any `superpowers` references

**Files:**
- Create: `skills/using-kit/SKILL.md` (from `using-superpowers`)
- Create: `skills/brainstorming/SKILL.md` (from `brainstorming`)
- Create: `skills/tdd/SKILL.md` (from `test-driven-development`)
- Create: `skills/tdd/testing-anti-patterns.md`
- Create: `skills/debugging/SKILL.md` (from `systematic-debugging`)
- Create: `skills/debugging/condition-based-waiting.md`
- Create: `skills/debugging/condition-based-waiting-example.ts`
- Create: `skills/debugging/defense-in-depth.md`
- Create: `skills/debugging/root-cause-tracing.md`
- Create: `skills/writing-plans/SKILL.md`
- Create: `skills/executing-plans/SKILL.md`

**Step 1: Copy and transform each skill**

For each skill above:
1. Copy the source SKILL.md from the superpowers cache
2. Apply ALL the reference replacements listed above (globally)
3. Update the `name:` frontmatter field to match the new directory name
4. Write to the target location

**Special changes for brainstorming:**
- In the "After the Design" section, change:
  ```
  - Commit the design document to git
  ```
  to:
  ```
  - Save the design document (user will commit when ready)
  ```
- Remove any other auto-commit references

**Special changes for using-kit:**
- Replace all instances of "superpowers" (lowercase) in prose with "kit" where it refers to the plugin name
- The "How to Access Skills" section stays the same (it's generic)
- In skill priority, replace `frontend-design, mcp-builder` references with just general examples

**Step 2: Copy supporting files for debugging**

Copy these from `systematic-debugging/` directory:
- `condition-based-waiting.md`
- `condition-based-waiting-example.ts`
- `defense-in-depth.md`
- `root-cause-tracing.md`

Do NOT copy test files (`test-*.md`, `CREATION-LOG.md`) — those are development artifacts.

Apply the same `superpowers:` → `kit:` replacement to all supporting files.

**Step 3: Copy supporting file for tdd**

Copy `testing-anti-patterns.md` from `test-driven-development/`.

**Step 4: Verify skills load correctly**

Run: `ls -la skills/*/SKILL.md`
Expected: 7 SKILL.md files for using-kit, brainstorming, tdd, debugging, writing-plans, executing-plans

Run: `grep -r "superpowers:" skills/` to confirm no remaining references
Expected: Zero matches

**Step 5: Commit**

```bash
git add skills/
git commit -m "feat: fork core workflow skills from superpowers (batch 1)"
```

---

### Task 3: Fork Skills from Superpowers (Batch 2 — Review & Integration)

**Files:**
- Create: `skills/code-review/SKILL.md` (from `requesting-code-review`)
- Create: `skills/code-review/code-reviewer.md` (the template)
- Create: `skills/receiving-review/SKILL.md` (from `receiving-code-review`)
- Create: `skills/finish-branch/SKILL.md` (from `finishing-a-development-branch`)
- Create: `skills/git-worktrees/SKILL.md` (from `using-git-worktrees`)
- Create: `skills/verify/SKILL.md` (from `verification-before-completion`)

**Step 1: Copy and transform each skill**

Same process as Task 2 — copy, apply all reference replacements, update frontmatter `name:`.

**Special changes for git-worktrees:**
- Replace `~/.config/superpowers/worktrees` with `~/.config/kit/worktrees`

**Step 2: Verify**

Run: `grep -r "superpowers" skills/` to confirm no remaining references
Expected: Zero matches

**Step 3: Commit**

```bash
git add skills/
git commit -m "feat: fork review and integration skills from superpowers (batch 2)"
```

---

### Task 4: Fork Skills from Superpowers (Batch 3 — Agents & Development)

**Files:**
- Create: `skills/parallel-agents/SKILL.md` (from `dispatching-parallel-agents`)
- Create: `skills/subagent-dev/SKILL.md` (from `subagent-driven-development`)
- Create: `skills/subagent-dev/implementer-prompt.md`
- Create: `skills/subagent-dev/spec-reviewer-prompt.md`
- Create: `skills/subagent-dev/code-quality-reviewer-prompt.md`
- Create: `skills/writing-skills/SKILL.md`
- Create: `skills/writing-skills/anthropic-best-practices.md`
- Create: `skills/writing-skills/testing-skills-with-subagents.md`
- Create: `skills/writing-skills/persuasion-principles.md`
- Create: `skills/writing-skills/graphviz-conventions.dot`
- Create: `skills/writing-skills/render-graphs.js`

**Step 1: Copy and transform each skill**

Same process — copy, apply all reference replacements, update frontmatter.

**Special changes for subagent-dev:**
- In `code-quality-reviewer-prompt.md`, replace `superpowers:code-reviewer` with `kit:code-reviewer`
- In `code-quality-reviewer-prompt.md`, replace `requesting-code-review/code-reviewer.md` with `code-review/code-reviewer.md`

**Special changes for writing-skills:**
- Replace `~/.config/superpowers/skills` with `~/.config/kit/skills`
- In the "Personal skills live in..." line, keep the generic paths

**Step 2: Copy writing-skills supporting files**

Copy from `writing-skills/` directory:
- `anthropic-best-practices.md`
- `testing-skills-with-subagents.md`
- `persuasion-principles.md`
- `graphviz-conventions.dot`
- `render-graphs.js`

Copy `examples/` subdirectory if it exists.

Apply `superpowers:` → `kit:` replacement to all files.

**Step 3: Verify**

Run: `grep -r "superpowers" skills/`
Expected: Zero matches

Run: `ls skills/*/SKILL.md | wc -l`
Expected: 14

**Step 4: Commit**

```bash
git add skills/
git commit -m "feat: fork agent and development skills from superpowers (batch 3)"
```

---

### Task 5: Fork Agent Definition

**Files:**
- Create: `agents/code-reviewer.md`

**Step 1: Copy and transform agent**

Copy from superpowers `agents/code-reviewer.md`. Apply `superpowers:` → `kit:` replacements.

**Step 2: Verify**

Run: `grep "superpowers" agents/code-reviewer.md`
Expected: Zero matches

**Step 3: Commit**

```bash
git add agents/
git commit -m "feat: fork code-reviewer agent from superpowers"
```

---

### Task 6: Migrate Commands

**Files:**
- Create: `commands/commit-staged.md`
- Create: `commands/create-pr.md`
- Create: `commands/github-work-summary.md`

**Step 1: Copy commands**

Copy these files from `~/.claude/commands/`:
- `commit-staged.md` → `commands/commit-staged.md`
- `create-pr.md` → `commands/create-pr.md`
- `github-work-summary.md` → `commands/github-work-summary.md`

These are user-authored commands, so they should be copied as-is (no `superpowers:` references to replace).

**Step 2: Verify**

Run: `ls commands/*.md`
Expected: 3 files

**Step 3: Commit**

```bash
git add commands/
git commit -m "feat: migrate personal commands"
```

---

### Task 7: Migrate Hook Scripts

**Files:**
- Create: `hooks/hooks.json`
- Create: `hooks/session-start.sh`
- Create: `hooks/gofmt.sh`
- Create: `hooks/eslint.sh`
- Create: `hooks/typescript.sh`
- Create: `hooks/clippy.sh`
- Create: `hooks/cargo-check.sh`
- Create: `hooks/rustfmt.sh`

**Step 1: Create hooks.json**

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
      { "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh", "async": false }] }
    ]
  }
}
```

**Step 2: Create session-start.sh**

Fork from superpowers `hooks/session-start.sh`. Changes:
- Replace `using-superpowers` with `using-kit`
- Replace `superpowers:using-superpowers` with `kit:using-kit`
- Replace "You have superpowers" with "You have kit"
- Replace `superpowers` in the legacy check path with `kit` (`~/.config/kit/skills`)
- Keep the JSON escape function and context injection structure identical

**Step 3: Copy code standards hooks**

Copy these 6 files from `~/.claude/hooks/ethpandaops/` as-is (they don't reference superpowers):
- `gofmt.sh`
- `eslint.sh`
- `typescript.sh`
- `clippy.sh`
- `cargo-check.sh`
- `rustfmt.sh`

**Step 4: Make all hook scripts executable**

Run: `chmod +x hooks/*.sh`

**Step 5: Verify**

Run: `ls -la hooks/`
Expected: `hooks.json` + 7 `.sh` files, all executable

Run: `grep "superpowers" hooks/session-start.sh`
Expected: Zero matches

**Step 6: Commit**

```bash
git add hooks/
git commit -m "feat: migrate hooks (session-start + 6 code standards)"
```

---

### Task 8: Bundle Code Standards

**Files:**
- Create: `code-standards/go/CLAUDE.md`
- Create: `code-standards/rust/CLAUDE.md`
- Create: `code-standards/python/CLAUDE.md`
- Create: `code-standards/tailwindcss/CLAUDE.md`

**Step 1: Copy code standards files**

Copy from `~/.claude/ethpandaops/code-standards/`:
- `go/CLAUDE.md` → `code-standards/go/CLAUDE.md`
- `rust/CLAUDE.md` → `code-standards/rust/CLAUDE.md`
- `python/CLAUDE.md` → `code-standards/python/CLAUDE.md`
- `tailwindcss/CLAUDE.md` → `code-standards/tailwindcss/CLAUDE.md`

Copy as-is — these are language standard docs, no `superpowers` references.

**Step 2: Verify**

Run: `ls code-standards/*/CLAUDE.md`
Expected: 4 files

**Step 3: Commit**

```bash
git add code-standards/
git commit -m "feat: bundle code standards (go, rust, python, tailwind)"
```

---

### Task 9: Create README

**Files:**
- Create: `README.md`

**Step 1: Write README**

```markdown
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
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with install instructions and contents"
```

---

### Task 10: Final Verification & Push

**Step 1: Verify complete plugin structure**

Run: `find . -not -path './.git/*' -not -path './node_modules/*' -type f | sort`

Expected output should show:
- `.claude-plugin/marketplace.json`
- `.claude-plugin/plugin.json`
- `.gitignore`
- `agents/code-reviewer.md`
- `code-standards/go/CLAUDE.md`
- `code-standards/python/CLAUDE.md`
- `code-standards/rust/CLAUDE.md`
- `code-standards/tailwindcss/CLAUDE.md`
- `commands/commit-staged.md`
- `commands/create-pr.md`
- `commands/github-work-summary.md`
- `docs/plans/2026-02-17-claude-kit-design.md`
- `docs/plans/2026-02-17-phase1-implementation.md`
- `hooks/cargo-check.sh`
- `hooks/clippy.sh`
- `hooks/eslint.sh`
- `hooks/gofmt.sh`
- `hooks/hooks.json`
- `hooks/rustfmt.sh`
- `hooks/session-start.sh`
- `hooks/typescript.sh`
- `LICENSE`
- `README.md`
- `skills/brainstorming/SKILL.md`
- `skills/code-review/SKILL.md`
- `skills/code-review/code-reviewer.md`
- `skills/debugging/SKILL.md` (+ supporting files)
- `skills/executing-plans/SKILL.md`
- `skills/finish-branch/SKILL.md`
- `skills/git-worktrees/SKILL.md`
- `skills/parallel-agents/SKILL.md`
- `skills/receiving-review/SKILL.md`
- `skills/subagent-dev/SKILL.md` (+ prompt templates)
- `skills/tdd/SKILL.md` (+ testing-anti-patterns.md)
- `skills/using-kit/SKILL.md`
- `skills/verify/SKILL.md`
- `skills/writing-plans/SKILL.md`
- `skills/writing-skills/SKILL.md` (+ supporting files)

**Step 2: Verify no remaining superpowers references**

Run: `grep -r "superpowers" --include="*.md" --include="*.json" --include="*.sh" . | grep -v ".git/" | grep -v "docs/plans/"`

Expected: Zero matches (plan files can reference superpowers as history, but all active plugin files should be clean)

**Step 3: Test plugin loads**

Run: `claude --plugin-dir . --print-system-prompt 2>/dev/null | head -20`

This confirms Claude Code can parse the plugin structure.

**Step 4: Push branch**

```bash
git push -u origin feature/baseline
```

**Step 5: Report complete**

Plugin is ready for local testing. Next: install via `--plugin-dir` and verify all skills/commands/hooks work, then create PR to merge to main.
