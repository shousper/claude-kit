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
5. **Launch one workflow per run segment.** Workflows always run in the background — you're notified on completion. Match this shape exactly:

   ```
   Workflow({
     scriptPath: "<base>/build.workflow.js",
     args: {
       startBatch: 0,
       maxFixRounds: 3,
       ledger: { decisions: [], conventions: [], deviations: [] },
       batches: [
         // Batch 0 — independent tasks; implemented sequentially, then reviewed together
         [
           { id: "T1", title: "Add rate-limit config",
             prompt: "Add a `rateLimit` field (requests-per-minute, default 60) to config/server.ts and validate it is a positive integer on load." },
           { id: "T2", title: "Add logging middleware",
             prompt: "Create middleware/logging.ts that logs method, path, and duration per request. Wire it in server.ts before the router." }
         ],
         // Batch 1 — depends on batch 0
         [
           { id: "T3", title: "Enforce rate limit",
             prompt: "In middleware/rateLimit.ts, reject requests over the configured rateLimit with HTTP 429, using the config field from T1." }
         ]
       ]
     }
   })
   ```

   - Every task carries its FULL `prompt` text — agents never re-read the plan. Never abbreviate or summarize a prompt to shrink the call.
   - `args` may be this object **or** a valid JSON string of it — the runner normalizes either. There is no `run_in_background` param (it's already background); unknown params error out. The only launches that fail are a **truncated/malformed payload** or **zero batches**.
   - If `scriptPath` rejects a bundled path, read the file and pass its contents as inline `script` instead.
   - **Sanity-check the launch.** A real run spawns agents and takes seconds-to-minutes. An almost-instant `blocked` with a "no batches" reason means an empty or truncated payload — fix `args` and relaunch; never report a no-op as success.
6. **Handle the result:**
   - `status: 'done'` → merge the returned `ledger`, report `verification.summary` as the test evidence (the workflow already ran the full suite + linter — do NOT re-run it or read test output yourself), present a final summary, then the iteration choice below.
   - `status: 'blocked'` → surface `reason`, `blockedAtBatch`, and any `findings`, resolve with your human partner, then re-launch with `startBatch = blockedAtBatch` and the updated `ledger`.

## Autonomous Until Blocked

The workflow runs batches back-to-back without pausing. It returns `blocked` ONLY when:
- the review fix-loop can't converge after `maxFixRounds` (staged Sonnet→Opus fixing),
- the final full-suite verification still fails after its bounded fix rounds, or
- an agent set `needsHumanInput` — task ambiguous/underspecified, contradicts the codebase, an unplanned decision, or a destructive/irreversible action.

Otherwise it drives to `done`. Do not insert routine human checkpoints.

## Model & Effort (pinned in the workflow)

| Stage | Model | Effort |
|---|---|---|
| Implementation | Sonnet | high |
| Spec review | Sonnet | high |
| Quality review | Sonnet (Opus on the final batch — its cumulative diff review is the whole-run safety net) | high (xhigh on final) |
| Fix (staged) | Sonnet → Opus | high |
| Post-fix re-check (scoped to the findings) | Sonnet | high |
| Final verification (full suite + lint, once per run) | Sonnet | low |

Planning (kit:brainstorming, kit:writing-plans) runs in the main session — run those in an Opus max/xhigh session. The workflow pins the above regardless of session model. Reviews are deliberately Sonnet-first: transcript analysis showed 69% of review gates return zero actionable findings, so Opus is reserved for the one review whose diff covers the entire run.

## Interruptibility

Background execution keeps this session live — watch progress via `/workflows` and interject anytime. To stop, `TaskStop` the workflow; relaunch with `resumeFromRunId` to resume from cached agent results (same session). Small batches keep work-at-risk low.

## Observability

The workflow emits `log()` progress and descriptive labels; every batch returns schema-structured results and findings, surfaced at each return. The ledger is the durable, human-readable execution record.

## Orchestrator Context Discipline

A long main session pays cache reads on its ENTIRE context every turn — the orchestrator's frugality matters more than the agents'. While a workflow runs and after it returns:

- Consume only the structured returns (`results`, `findings`, `ledger`, `verification`). Never Read implementation files, diffs, or test output into the main session to "double-check" the workflow — that's what the review gate and final verification are for.
- On `blocked`, read the minimum needed to resolve the blocker: the findings/reason text, not the files they mention.
- `verification.summary` IS the test evidence. Do not re-run the suite in the main session.
- After completion, recommend a fresh session (`/clear`) before the next feature — the plan, ledger, worktree, and branch all survive on disk; a bloated session is the only thing that doesn't need to.

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
- Read implementation files, diffs, or full test output into the orchestrator session — structured returns are the record.
- Build on main/master without explicit consent.
- Insert routine pauses — drive until done or genuinely blocked.
- Make agents re-read the plan file — pass full task text via `args`.
- Drop the ledger between segments — cross-batch awareness depends on it.
- Re-author the workflow inline when the bundled `build.workflow.js` exists.
- Truncate, summarize, or abbreviate the batch payload — a cut-off JSON blob is the one thing that makes the runner block. (A whole object or a whole valid JSON string both parse fine; incompleteness is the enemy, not stringification.)
- Pass `run_in_background` or other unknown Workflow params — it always runs in background and errors on unexpected parameters.
- Treat an instant `blocked` return with no agents / empty `results` as success — that's a malformed or empty payload; fix `args` and relaunch.
- Patch the runner to work around a no-op launch — fix the payload first; the runner blocks loudly to point you there.

## Integration

- **kit:git-worktrees** — REQUIRED: isolated workspace before starting.
- **kit:writing-plans** — Creates the plan this skill executes.
- **kit:code-review** — Standalone review; build-flow's review gate covers in-flight batches.
- **kit:finish-branch** — Complete development after approval.
- **kit:brainstorming** — Re-entry for design changes.
- **kit:tdd** — The workflow's implementer agents follow TDD.
- `./build.workflow.js` — The bundled batch runner this skill launches.
