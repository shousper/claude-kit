---
name: cancel
description: Stops an active story loop and reports where the board stands. Use when asked to "stop the loop", "cancel the story run", "halt autonomous story work", "kill the worker loop", or when a runaway run must be shut down. DO NOT TRIGGER for closing a single story (that is story done inside stories:work), for deleting or archiving stories, or for removing the story workflow from a project.
---

# Cancel Story Run

The escape hatch. Stopping is cheap, safe, and never loses work — say so, then do it.

## Process

### 1. Stop the loop

Loops are per-session — stopping one worker's loop needs its session id (or run this from that worker's own session, which supplies it automatically via `CLAUDE_SESSION_ID`); stopping every loop on the board needs `--all`.

```bash
story loop status --json                # no session: lists every active loop on the board
story loop status --session <id> --json # one worker's loop — capture goal + iterations used vs budget BEFORE stopping
story loop stop --session <id>          # stop that one worker's loop — returns {stopped: true|false}
story loop stop --all                   # stop every loop on the board
```

Report the goal and iterations-vs-budget from the status output. If status reports no active loop (`{active: false}`), say so and continue to the report — the human still wants the picture.

### 2. Settle the in-flight story

If this session has a claimed in-progress story, ask your human partner which of:

1. **Finish it** — one last pass through gates and `story done`.
2. **Park it** — `story park <id> --question "Cancelled mid-work: <current state, what remains>"`.
3. **Release it** — `story update <id> --status todo` (work stays on the story branch; the worktree remains for the next claimant).

Never decide silently, and never leave it dangling without asking — a dead lease is reclaimable, but the next worker wastes time re-discovering state.

### 3. Report the board

From `story board` (and `story list --json` where detail helps):

- Counts: done / in-progress / in-review / blocked / todo.
- **Parked questions, verbatim, with story ids** — these are the human's inbox.
- In-review stories awaiting human review or PR merge.
- Other sessions' active claims — do NOT touch them; their leases expire on their own.

## What cancel is not

- Not rollback: completed stories stay done; merged code stays merged.
- Not teardown: worktrees, branches, config, and learnings remain — a future stories:work run resumes cleanly.
- Not cleanup of other workers: parallel sessions keep running; stopping them means cancelling in THEIR sessions.

## Red Flags

**Never:**

- Delete or edit `.claude/story-loop.*.local.md` by hand — `story loop stop` owns it.
- Un-claim another session's story.
- Bury parked questions — they are the point of the report.
