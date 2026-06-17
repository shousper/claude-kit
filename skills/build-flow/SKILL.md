---
name: build-flow
description: The default vehicle for implementing a coherent batch of code changes — a feature, refactor, bug fixes, or remediation from an audit/review — via a background TDD workflow with an independent spec+quality review gate and staged fix-loop (pausing only when blocked). Use it the moment you are about to edit source files for such a batch, whether the plan came from kit:writing-plans, a docs/plans/*.md file, an audit/analysis you just ran, or asks like "execute the plan", "implement this", "do the refactor", or "remediate the findings" — even for small batches. In ultracode mode, implement via build-flow rather than hand-editing or a one-off workflow. DO NOT TRIGGER for a new feature with no design yet (use kit:brainstorming first), for pure analysis/research/review that changes no code (author a plain workflow), or for a single trivial edit.
---

# Build Flow

Execute an approved plan via a bundled dynamic workflow. The main session is the durable orchestrator (it holds the plan, the decisions ledger, and the human checkpoints); the workflow's ephemeral subagents are disposable muscle. No persistent teams.

**Core principle:** Orchestrator + ephemeral workflow agents + an explicit ledger = high quality, low token overhead, autonomous until genuinely blocked.

## When to Use

- You have an implementation plan (from kit:writing-plans, an @-mentioned file, or describable from context).
- Tasks are mostly independent and batchable.
- DO NOT use without a plan (brainstorm first), or for unrelated ad-hoc fan-out (use kit:parallel-agents).

## Inputs

- **Markdown plan** (preferred): from kit:writing-plans, or an @-mentioned `docs/plans/*.md`.
- **Inferred**: reconstruct the task set from conversation context if no plan file exists.

Markdown stays the human format — you parse it into structure at runtime.

## Process

1. **Worktree.** Ensure you are in an isolated worktree (kit:git-worktrees). Never build on main without explicit consent.
2. **Parse the plan into batches.** Extract tasks (id, title, full prompt text, dependencies). Group into dependency-ordered batches where tasks within a batch are independent (topological layers). Default batch size ~3; smaller for large/complex tasks. Carry each task's FULL text — do not make agents re-read the plan file.
3. **Seed the ledger.** `{ decisions: [], conventions: [], deviations: [] }` — the compact cross-batch record that replaces persistent reviewer memory.
4. **Locate the workflow.** This skill is loaded with its base directory. The runner is `<base>/build.workflow.js`.
5. **Launch one background workflow per run segment:**
   - `Workflow({ scriptPath: "<base>/build.workflow.js", args: { batches, ledger, startBatch, maxFixRounds: 3 } })`
   - If `scriptPath` rejects a bundled path, read the file and pass its contents as inline `script` instead.
   - It runs in the background; you are notified on completion.
6. **Handle the result:**
   - `status: 'done'` → merge the returned `ledger`, present a final summary, then the iteration choice below.
   - `status: 'blocked'` → surface `reason`, `blockedAtBatch`, and any `findings`, resolve with your human partner, then re-launch with `startBatch = blockedAtBatch` and the updated `ledger`.

## Autonomous Until Blocked

The workflow runs batches back-to-back without pausing. It returns `blocked` ONLY when:
- the review fix-loop can't converge after `maxFixRounds` (staged Sonnet→Opus fixing), or
- an agent set `needsHumanInput` — task ambiguous/underspecified, contradicts the codebase, an unplanned decision, or a destructive/irreversible action.

Otherwise it drives to `done`. Do not insert routine human checkpoints.

## Model & Effort (pinned in the workflow)

| Stage | Model | Effort |
|---|---|---|
| Implementation | Sonnet | high |
| Spec review | Sonnet | high |
| Quality review | Opus | xhigh |
| Fix (staged) | Sonnet → Opus | high |

Planning (kit:brainstorming, kit:writing-plans) runs in the main session — run those in an Opus max/xhigh session. The workflow pins the above regardless of session model.

## Interruptibility

Background execution keeps this session live — watch progress via `/workflows` and interject anytime. To stop, `TaskStop` the workflow; relaunch with `resumeFromRunId` to resume from cached agent results (same session). Small batches keep work-at-risk low.

## Observability

The workflow emits `log()` progress and descriptive labels; every batch returns schema-structured results and findings, surfaced at each return. The ledger is the durable, human-readable execution record.

## After Completion

Ask your human partner explicitly:

```
Implementation complete. What would you like to do?

1. Finish the branch — finalize this work (kit:finish-branch presents options)
2. Quick iteration — describe what needs changing, I'll continue
3. New brainstorming cycle — restart design on this worktree (kit:brainstorming)
```

**Always ask. Never decide automatically.**

## Standalone vs. Continuing

Invocable either way. The only difference is a reminder: if continuing in a long session, check how much context you've burned — a fresh session may be cleaner. The orchestrator's own context stays compact; heavy work runs in clean-context background workflows.

## Red Flags

**Never:**
- Commit during implementation (commits are your human partner's decision).
- Build on main/master without explicit consent.
- Insert routine pauses — drive until done or genuinely blocked.
- Make agents re-read the plan file — pass full task text via `args`.
- Drop the ledger between segments — cross-batch awareness depends on it.
- Re-author the workflow inline when the bundled `build.workflow.js` exists.

## Integration

- **kit:git-worktrees** — REQUIRED: isolated workspace before starting.
- **kit:writing-plans** — Creates the plan this skill executes.
- **kit:code-review** — Standalone review; build-flow's review gate covers in-flight batches.
- **kit:finish-branch** — Complete development after approval.
- **kit:brainstorming** — Re-entry for design changes.
- **kit:tdd** — The workflow's implementer agents follow TDD.
- `./build.workflow.js` — The bundled batch runner this skill launches.
