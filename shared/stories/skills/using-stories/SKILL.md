---
name: using-stories
description: Compressed story-workflow rulebook, injected automatically at session start (including after compaction) in projects with .agents/shousper-stories/config.json. Use when unsure of the workflow rules mid-session, when asked "how does the story workflow work here", or for a story CLI quick reference. DO NOT TRIGGER in projects without .agents/shousper-stories/config.json, to set up the workflow (stories:setup), to file stories (stories:plan), or to run the loop (stories:work).
---

# Using Stories

This project runs the story workflow. The board is `stories/*.md`; the `story` CLI is the ONLY way to change it.

## Rules

1. **Never hand-edit board or loop files** (`stories/**` and everything under `.agents/shousper-stories/local/`: execution state, loop files, learnings, evidence). Every mutation is a `story` command — a hook denies direct writes and names the command to run instead. Do not route around it with the shell. Story loops are per-session: a loop only ever re-prompts the session that started it.
2. **`done` is evidence- and plan-gated.** `story done` refuses a story with no `## Implementation Plan` on record (<10 words = thin), runs command gates, and checks review verdicts itself. Never declare a story complete — the CLI decides.
3. **Ready is computed, never stored.** Trust `story ready`, not file contents or memory.
4. **Park, don't stall.** Human-only decision → `story park <id> --question "…"`, take the next story. Parked questions surface at run end — never bury them. While a loop is bound to your session the ask-the-user tool is denied: a question is a park.
5. **Discovered work is filed, not done.** `story create --title "…" --description "…" --ac "…" --discovered-from <id>`, then back to the claimed story. The CLI refuses a story without a description and at least one acceptance criterion — write the spec at filing time, never "fill it in later".
6. **One worktree per story.** Claimed work lives in `.worktrees/st-<id>` on branch `story/st-<id>`. Commit there; never merge to main yourself — integration is the CLI's job.
7. **Budgets are visible and final.** The loop shows `iteration N · stalls a/b` at each turn end; a run ends after `b` consecutive turn ends without board progress. Never restart a stopped loop or edit loop state; a human decides.

## CLI quick reference

```bash
story ready --json                 # claim-safe workable set; feedback items first
story claim <id>                   # claim + create worktree
story show <id> | story board      # read views
story update <id> --… [--complexity hard|frontier]   # field changes (legal transitions only); absent = routine
story note <id> --body "…"         # append an implementation note
story create --title "…" --description "…" --ac "…" [--ac "…"] --type <t> [--complexity hard|frontier] [--discovered-from <id>] [--depends-on …] [--touches …]   # or --body-file <path>
story park <id> --question "…"     # blocked on a human
story record <id> --gate <g> --verdict pass|fail --evidence <path>
story done <id> [--allow-empty] [--allow-unplanned]   # gates → plan check → evidence → integrate
story loop status | story loop stop
story doctor [--fix]               # board integrity + adoption of hand-written stories (+ layout migration)
```

Every read takes `--json`; every mutation locks — safe with parallel workers.

## Skills

- stories:work — the worker loop (claim → plan via the bundled planner runner, which pins the planner tier by story complexity → story update --plan-file → build-flow gets the planner's batches → done)
- stories:plan — spec → stories · stories:setup — onboarding · stories:cancel — stop + report
