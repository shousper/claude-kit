---
name: using-stories
description: Compressed story-workflow rulebook, injected automatically at SessionStart (including after compaction) in projects with .claude/story-workflow.json. Use when unsure of the workflow rules mid-session, when asked "how does the story workflow work here", or for a story CLI quick reference. DO NOT TRIGGER in projects without .claude/story-workflow.json, to set up the workflow (stories:setup), to file stories (stories:plan), or to run the loop (stories:work).
---

# Using Stories

This project runs the story workflow. The board is `stories/*.md`; the `story` CLI is the ONLY way to change it.

## Rules

1. **Never hand-edit board or loop files** (`stories/**`, `.claude/story-loop.*.local.md`, `.claude/story-state.local.json` (execution state), learnings, evidence). Every mutation is a `story` command — a hook denies direct writes and names the command to run instead. Do not route around it with Bash. Story loops are per-session: a loop only ever re-prompts the session that started it.
2. **`done` is evidence- and plan-gated.** `story done` refuses a story with no `## Implementation Plan` on record (<10 words = thin), runs command gates, and checks review verdicts itself. Never declare a story complete — the CLI decides.
3. **Ready is computed, never stored.** Trust `story ready`, not file contents or memory.
4. **Park, don't stall.** Human-only decision → `story park <id> --question "…"`, take the next story. Parked questions surface at run end — never bury them.
5. **Discovered work is filed, not done.** `story create --discovered-from <id>`, then back to the claimed story.
6. **One worktree per story.** Claimed work lives in `.worktrees/st-<id>` on branch `story/st-<id>`. Commit there; never merge to main yourself — integration is the CLI's job.
7. **Budgets are visible and final.** The Stop hook shows `iteration N/M`. Never restart a stopped loop or edit loop state; a human decides.

## CLI quick reference

```bash
story ready --json                 # claim-safe workable set; feedback items first
story claim <id>                   # claim + create worktree
story show <id> | story board      # read views
story update <id> --… [--complexity hard|frontier]   # field changes (legal transitions only); absent = routine
story note <id> --body "…"         # append an implementation note
story create --title "…" --type <t> [--complexity hard|frontier] [--discovered-from <id>] [--depends-on …] [--touches …]
story park <id> --question "…"     # blocked on a human
story record <id> --gate <g> --verdict pass|fail --evidence <path>
story done <id> [--allow-empty] [--allow-unplanned]   # gates → plan check → evidence → integrate
story loop status | story loop stop
story doctor [--fix]               # board integrity + adoption of hand-written stories
```

Every read takes `--json`; every mutation locks — safe with parallel workers.

## Skills

- stories:work — the worker loop (claim → plan via the bundled planning workflow, which pins the planner model by story complexity → story update --plan-file → build-flow gets the planner's batches → done)
- stories:plan — spec → stories · stories:setup — onboarding · stories:cancel — stop + report
