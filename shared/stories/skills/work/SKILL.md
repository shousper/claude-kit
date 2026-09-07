---
name: work
description: Runs the story worker loop in a story-workflow project — claim ready stories, implement each in its own worktree, close through verification gates, repeat until the goal is met or the loop stalls. Use when asked to "work the board", "complete all stories", "work on epic st-XXXX", "pick up the next story", "start a worker", or to resume or continue a story run — and when a loop re-prompt names the next story in a session that started the loop. DO NOT TRIGGER without .agents/shousper-stories/config.json (use stories:setup first), for decomposing a spec into stories (stories:plan), or to stop a run (stories:cancel).
---

# Story Worker

You are one worker in a possibly-parallel pool. The `story` CLI arbitrates everything shared — claims, locks, gates, integration. Your job is judgment and implementation.

**Core principle:** the loop is encoded — the CLI and your harness's turn-end hook drive continuation. You execute one story per iteration well; you never improvise orchestration.

## HARD GATE: the CLI is the only writer

Never edit or write files under the configured `storiesDir` (default `stories/`) or under `.agents/shousper-stories/local/` (state, loop files, learnings, evidence). Every board mutation is a `story` command. A hook denies direct writes — treat a denial as a redirect and run the CLI command it names. Do not route around it with the shell (`sed -i`, `echo >>`, heredocs): unlocked writes corrupt the board for every parallel worker.

## Starting a run

1. Parse the goal scope from the ask: whole board ("complete all stories"), an epic (`epic:st-9c01`), an explicit list of ids, or a single story.
2. Multi-story goal → `story loop start --goal "<scope>"`. The CLI binds the loop to YOUR session (your harness adapter supplies the session id as `STORY_SESSION_ID`) — only this session receives its re-prompts, and other sessions' loops never address you. From now on the loop re-prompts you with the next story at each turn end — never "keep going" on your own initiative, and never touch the loop state files.
3. Single-story ask → skip the loop; run one iteration of the procedure below.

While a loop is bound to your session, the guard also denies the ask-the-user tool: a run is unattended by definition. A question only a human can answer is a park (step 6), never a prompt.

## Iteration procedure

One story per iteration, in this order:

### 1. Pick

`story ready --json`. Feedback items rank first — take the top entry. Empty set → summarize why via `story board` (everything done, blocked, or in-review) and end your turn; the loop tick decides whether the goal is met.

### 2. Claim

`story claim <id>` — verifies readiness under lock, writes your lease, creates `.worktrees/st-<id>` on branch `story/st-<id>`. Lost the race (claim error) → re-run `story ready` and take the next. Never work on a story you have not claimed.

### 3. Plan via the bundled planner runner — never inline, never model-choosing

Every claimed story gets an execution-time plan from the bundled planner runner beside this file — even when the story already carries one (prerequisites may have merged since it was written; the planner validates and refreshes against the code as it is NOW). The runner pins the planner tier from story `complexity` in code (routine, hard, frontier — `frontier` is your human partner's explicit opt-in, made at board approval; complexity is locked while the story is in-progress). You never pick, retry at a different tier, or substitute a planner — that decision does not exist in this session.

Launch it exactly as `launch.md` in this skill's directory describes for your harness: it names the runner file, shows the launch call, and says how the result comes back. Pass one entry per claimed story — `{ id, complexity (from story show --json; absent = routine), worktree (absolute path), storyBody (the full body, pasted; the planner must not re-read the board) }`. Claimed several stories? Pass them all in one call; they plan in parallel. Never poll a running planner; `launch.md` says how its completion reaches you.

The result is `{ status, planned, unimplementable, failed }`. Per story:

- `planned` → save its `plan` to a scratch file → `story update <id> --plan-file <file>`; hold its `batches` for step 4.
- `unimplementable` → `story park <id> --question "<its question>"` and move on.
- `failed` → `story park <id> --question "planner failed: <error>"` and move on. A planner failure is never a tier-selection problem — there is no alternative-tier path, and complexity cannot change while the story is in-progress.

### 4. Implement via kit:build-flow — inside the worktree

All implementation happens in `.worktrees/st-<id>`. Three hard rules, each from a real incident:

- **cd into the worktree in your session shell IMMEDIATELY before invoking kit:build-flow, verify with `pwd`, and pass the worktree path as build-flow's `args.worktree`.** The workflow's agents inherit the shell's cwd, not the path named in their prompts — launching from the main repo split-brains the run (agents edit main's tree, reviewers report "no implementation", fixes land in the wrong copy). After the workflow returns, `git -C <repo-root> status --porcelain` must show only board files; anything else is a split brain — port stray changes into the worktree, then restore main.
- **Launch build-flow, then end your turn — continuation is event-driven.** build-flow's completion re-invokes you with its result (its own `launch.md` says exactly how on your harness); gating, committing, and closing happen in that re-invocation. The loop tick holds quietly while this session's claim is in flight, so ending the turn is safe. Never poll a running workflow — polling burns context.
- build-flow's worktree requirement is already satisfied by the story worktree; do NOT create another.

Invoke kit:build-flow with the planner's `<batches>` as `args.batches` — never the raw story as a single fat task. The story body stays the spec; the planner output is the plan.

**Committing — MANDATORY before closing:** `story done` merges the story BRANCH, not the working tree. build-flow leaves its work uncommitted by design, so commit it to the story branch first (message `st-<id>: <what changed>`) — the CLI refuses a dirty worktree or a zero-commit branch (use `--allow-empty` only for a genuinely codeless story). Stage code only, never `stories/**`: board files are CLI-managed — restore them with `git checkout -- stories` instead of committing them. The goal loop is your human partner's standing consent to commit on `story/st-<id>` branches — never to main; integration belongs to the CLI.

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

A failing gate names itself in the output → fix in the worktree (kit:debugging for surprises), re-run `story done`. Gates run in a clean subprocess from the worktree — a fresh worktree may need the project's own toolchain setup before its gates can pass. Never mark done any other way; never weaken a gate to pass it.

### 9. End the iteration

Finish your message normally. At turn end the loop ticks: it either re-prompts you with the next story or ends the run with a summary. Do not restart a stopped loop or edit budgets — a human decides.

## Feedback items (local / pr mode)

`story ready` ranks arrived review feedback above new stories. Claiming a feedback item attaches you to the story's EXISTING worktree and branch. Before changing code, invoke kit:receiving-review on the reviewer comments — verify each against the codebase, implement what survives scrutiny, then re-run gates and close via `story done` (which re-pushes in pr mode).

## Personas

Review-gate verdicts come from subagents dispatched with a filled template (`launch.md` names the dispatch tool on your harness):

- `references/personas/qa-reviewer.md` — AC-by-AC verification against evidence.
- `references/personas/visual-reviewer.md` — judgment on visual captures.
- A gate whose `persona` names a file in `.agents/shousper-stories/personas/` uses that project-generated persona instead.

Fill every placeholder (story file path, worktree, evidence paths — paths, never pasted content), dispatch, and record the single `VERDICT:` line the persona returns. Never record a verdict a persona did not return, and never skip the dispatch because the result "seems obvious" — the recorded verdict is the anti-reward-hacking line.

## Learnings

Learned something the other workers need — a build quirk, a flaky suite, a naming decision? Append it: `story loop learn "<one-liner>"`. The tick injects shared learnings into every worker's re-prompt.

## Context discipline

The board holds ALL state — your session context is disposable, so keep it thin. A worker session that grows to hundreds of turns pays cache reads on its entire context every turn; measured runs show this dwarfs the cost of the actual work.

- The orchestrator touches only: the `story` CLI, skill invocations, and agent dispatches. Probes, gate captures, spike scripts, and verification runs happen inside build-flow or dispatched subagents — never inline in your session.
- Never read implementation files, diffs, or full test output into your context. The story file, gate evidence, and structured agent returns are the record; build-flow's `verification.summary` is the test evidence.
- After `story done`, if your context has grown large, compact before claiming the next story — everything needed to continue (board, learnings, loop state) is on disk.

## Budgets and visibility

Two budgets come from config: the **stall budget** (`budgets.maxStalls`, default 3) ends a run after that many consecutive turn ends with no board progress — a story claimed, closed, parked, or filed resets it, so a run that keeps landing stories never stops; the **per-story fix budget** (`budgets.maxFixRoundsPerStory`, default 3) caps retries on one story. The loop's status line shows `iteration N · stalls a/b` at each turn end — your human partner watches it. Runs end on: goal complete, board drained or blocked, or a budget exhausted. The final summary MUST surface parked questions verbatim and list in-review stories awaiting humans.

## Red Flags

**Never:**

- Hand-edit `stories/**`, loop state, learnings, or evidence files — CLI only.
- Implement outside the story's worktree, or without a claim.
- Run probes, captures, or verification inline in the worker session — dispatch them; read only structured results back.
- Run `story done` with uncommitted work in the worktree — the CLI refuses, but the commit is your job, not a formality.
- Poll or block on a running workflow — completion drives continuation; end your turn instead.
- Claim another story while one is in flight in this session — one story per iteration; the loop resumes when the current one closes.
- Launch build-flow with the shell cwd outside the story worktree, or without `args.worktree`.
- Commit `stories/**` board files into a story branch.
- Close a story any way other than a passing `story done`.
- Fake, infer, or self-author a review-gate verdict.
- Expand a story's scope — file discovered work instead.
- Merge to main yourself — integration is the CLI's.
- Continue past a stopped loop, restart it, or edit budgets.
- Ask your human partner a question mid-run — park the story instead.
- Swallow parked questions from the final summary.
- Skip the planner runner, plan inline in the worker session, or pass the raw story to build-flow as one fat task.
- Dispatch a planner yourself as a plain subagent, at a self-chosen tier, or "fall back" to a lesser tier on failure — planning goes through the bundled runner only; failures park.
- Self-assign `frontier` complexity — that escalation belongs to your human partner at approval time.
- Unpark a story (`--status todo`) then downgrade its `complexity` to reclaim and re-plan at a cheaper tier — the CLI stamps and enforces the parked tier, but the loophole is closed at the board level: only your human partner clears it (`--clear-park-lock`).

## Integration

- kit:build-flow — per-story implementation (TDD + review), run inside the story worktree.
- kit:receiving-review — before acting on PR or review feedback.
- kit:debugging — gate failures with a non-obvious cause.
- stories:plan — files the work this skill drains; stories:cancel — the stop lever.
- `references/personas/` — bundled persona templates.
- `launch.md` — harness-specific launch mechanics for the planner runner, build-flow's result delivery, and persona dispatch; read on demand.
