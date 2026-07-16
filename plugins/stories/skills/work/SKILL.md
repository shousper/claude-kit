---
name: work
description: Runs the story worker loop in a story-workflow project — claim ready stories, implement each in its own worktree, close through verification gates, repeat until the goal is met or budgets run out. Use when asked to "work the board", "complete all stories", "work on epic st-XXXX", "pick up the next story", "start a worker", or to resume or continue a story run — and when a Stop-hook re-prompt names the next story. DO NOT TRIGGER without .claude/story-workflow.json (use stories:setup first), for decomposing a spec into stories (stories:plan), or to stop a run (stories:cancel).
---

# Story Worker

You are one worker in a possibly-parallel pool. The `story` CLI arbitrates everything shared — claims, locks, gates, integration. Your job is judgment and implementation.

**Core principle:** the loop is encoded — CLI + Stop hook drive continuation. You execute one story per iteration well; you never improvise orchestration.

## HARD GATE: the CLI is the only writer

Never Edit/Write files under the configured `storiesDir` (default `stories/`), `.claude/story-loop.local.md`, `.claude/story-learnings.local.md`, or `.claude/story-evidence/`. Every board mutation is a `story` command. A PreToolUse hook denies direct writes — treat a denial as a redirect and run the CLI command it names. Do not route around it with Bash (`sed -i`, `echo >>`, heredocs): unlocked writes corrupt the board for every parallel worker.

## Starting a run

1. Parse the goal scope from the ask: whole board ("complete all stories"), an epic (`epic:st-9c01`), an explicit list of ids, or a single story.
2. Multi-story goal → `story loop start --goal "<scope>"`. The Stop hook now re-prompts you with the next story after each iteration — never "keep going" on your own initiative, and never touch the loop state file.
3. Single-story ask → skip the loop; run one iteration of the procedure below.

## Iteration procedure

One story per iteration, in this order:

### 1. Pick

`story ready --json`. Feedback items rank first — take the top entry. Empty set → summarize why via `story board` (everything done, blocked, or in-review) and end your turn; the loop tick decides whether the goal is met.

### 2. Claim

`story claim <id>` — verifies readiness under lock, writes your lease, creates `.worktrees/st-<id>` on branch `story/st-<id>`. Lost the race (claim error) → re-run `story ready` and take the next. Never work on a story you have not claimed.

### 3. Plan on the record

`story show <id>` — read the description and acceptance criteria. Write a short implementation plan into the story before coding: `story update <id> --plan-file <scratch-file>`. Future workers and reviewers get context from the story file, not from your session.

### 4. Implement via kit:build-flow — inside the worktree

All implementation happens in `.worktrees/st-<id>` — cd there and stay there. Invoke kit:build-flow with the story as the plan: the story body (description, ACs, your implementation plan) is the task prompt — usually a single batch with one task. build-flow's worktree requirement is already satisfied by the story worktree; do NOT create another.

**Committing:** commit completed work to the story branch (message `st-<id>: <what changed>`) before closing. The goal loop is your human partner's standing consent to commit on `story/st-<id>` branches — never to main; integration belongs to the CLI.

### 5. Discovered work

Out-of-scope work you uncover → file it, don't do it:

```bash
story create --title "…" --type bug --discovered-from <id> [--touches …]
```

Then return to the claimed story. Scope creep breaks the sizing contract.

### 6. Park, don't stall

A decision only a human can make — product choice, contradictory spec, missing access or credentials, destructive/irreversible action:

```bash
story park <id> --question "Specific, answerable question — include the options you see"
```

…then go back to step 1 for the next story. Parked questions surface in the end-of-run summary. Do NOT park for technical difficulty — that is kit:debugging territory.

### 7. Review gates

`story show <id>` lists the story's gates. For each `kind: review` gate, before closing:

1. Run its `capture` command from the worktree; note the artifact paths.
2. Dispatch the gate's persona as a subagent (see Personas) with the story file path + artifact paths.
3. Persist the returned verdict: `story record <id> --gate <name> --verdict pass|fail --evidence <artifact-path>`.
4. On `fail` → fix per the persona's notes, re-capture, re-dispatch — within the per-story fix budget.

### 8. Close

`story done <id>`. The CLI runs every command gate in the worktree (serialized machine-wide), verifies review verdicts, writes the evidence file, reconciles `touches` to the actual diff, then integrates per merge mode:

- `self` — merged to main, worktree torn down. Merge conflict → the story returns to in-progress with an integration-fix note: resolve in the worktree, re-gate, re-run `story done`.
- `local` / `pr` — the story goes in-review (worktree or PR awaits a human); move on.

A failing gate names itself in the output → fix in the worktree (kit:debugging for surprises), re-run `story done`. Never mark done any other way; never weaken a gate to pass it.

### 9. End the iteration

Finish your message normally. The Stop hook ticks the loop: it either re-prompts you with the next story or ends the run with a summary. Do not restart a stopped loop or edit budgets — a human decides.

## Feedback items (local / pr mode)

`story ready` ranks arrived review feedback above new stories. Claiming a feedback item attaches you to the story's EXISTING worktree and branch. Before changing code, invoke kit:receiving-review on the reviewer comments — verify each against the codebase, implement what survives scrutiny, then re-run gates and close via `story done` (which re-pushes in pr mode).

## Personas

Review-gate verdicts come from subagents dispatched with the Task tool using templates:

- `references/agents/qa-reviewer.md` — AC-by-AC verification against evidence.
- `references/agents/visual-reviewer.md` — judgment on visual captures.
- A gate whose `persona` names a file in `.claude/agents/` uses that project-generated persona instead.

Fill every placeholder (story file path, worktree, evidence paths — paths, never pasted content), dispatch, and record the single `VERDICT:` line the persona returns. Never record a verdict a persona did not return, and never skip the dispatch because the result "seems obvious" — the recorded verdict is the anti-reward-hacking line.

## Learnings

Learned something the other workers need — a build quirk, a flaky suite, a naming decision? Append it: `story loop learn "<one-liner>"`. The tick injects shared learnings into every worker's re-prompt.

## Context discipline

The board holds ALL state — your session context is disposable, so keep it thin. A worker session that grows to hundreds of turns pays cache reads on its entire context every turn; measured runs show this dwarfs the cost of the actual work.

- The orchestrator touches only: the `story` CLI, skill invocations, and agent dispatches. Probes, gate captures, spike scripts, and verification runs happen inside build-flow or dispatched subagents — never inline in your session.
- Never Read implementation files, diffs, or full test output into your context. The story file, gate evidence, and structured agent returns are the record; build-flow's `verification.summary` is the test evidence.
- After `story done`, if your context has grown large, compact before claiming the next story — everything needed to continue (board, learnings, loop state) is on disk.

## Budgets and visibility

Global iterations and per-story fix rounds come from config (defaults 10 / 3). The Stop hook's system message shows `iteration N/M` — your human partner watches it. Runs end on: goal complete, board drained or blocked, or budget exhausted. The final summary MUST surface parked questions verbatim and list in-review stories awaiting humans.

## Red Flags

**Never:**

- Hand-edit `stories/**`, loop state, learnings, or evidence files — CLI only.
- Implement outside the story's worktree, or without a claim.
- Run probes, captures, or verification inline in the worker session — dispatch them; read only structured results back.
- Close a story any way other than a passing `story done`.
- Fake, infer, or self-author a review-gate verdict.
- Expand a story's scope — file discovered work instead.
- Merge to main yourself — integration is the CLI's.
- Continue past a stopped loop, restart it, or edit budgets.
- Swallow parked questions from the final summary.

## Integration

- kit:build-flow — per-story implementation (TDD + review), run inside the story worktree.
- kit:receiving-review — before acting on PR or review feedback.
- kit:debugging — gate failures with a non-obvious cause.
- stories:plan — files the work this skill drains; stories:cancel — the stop lever.
- `references/agents/` — bundled persona templates (Task D5).
