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
5. **Launch one workflow per run segment, in the background.** Read `launch.md` in this skill's directory for your harness's exact launch mechanics.
   - Every task carries its FULL `prompt` text — agents never re-read the plan. Never abbreviate or summarize a prompt to shrink the call.
   - **Always pass `worktree` AND `cd` into it in your session shell immediately before launching (verify with `pwd`).** The workflow's agents inherit the shell's cwd — not the path you had in mind. A wrong cwd split-brains the run across checkouts: some agents edit the main tree, reviewers report "no implementation", fixes land in the orphaned copy. After the run, `git status --porcelain` on the MAIN checkout must show no source changes — anything else means a split brain: port stray fixes into the worktree, then restore main.
   - **Sanity-check the launch.** A real run spawns agents and takes seconds-to-minutes. An almost-instant `blocked` with a "no batches" reason means an empty or truncated payload — fix the args and relaunch; never report a no-op as success.
6. **Handle the result.** The workflow returns `{ status, results, ledger, findings, verification }`; your harness's launch doc explains exactly how to extract this from the completion payload.
   - `status === 'done'` → merge the returned `ledger`, report `verification.summary` as the test evidence (the workflow already ran the full suite + linter — do NOT re-run it or read test output yourself), present a final summary, then the iteration choice below.
   - `status === 'blocked'` → surface `reason`, `blockedAtBatch`, and any `findings`, resolve with your human partner, then re-launch with `startBatch = blockedAtBatch` and the updated `ledger`.

## Autonomous Until Blocked

The workflow runs batches back-to-back without pausing. It returns `blocked` ONLY when:
- the review fix-loop can't converge after `maxFixRounds` (staged worker→arbiter fixing),
- the final full-suite verification still fails after its bounded fix rounds, or
- an agent set `needsHumanInput` — task ambiguous/underspecified, contradicts the codebase, an unplanned decision, or a destructive/irreversible action.

Otherwise it drives to `done`. Do not insert routine human checkpoints.

## Model & Effort (pinned in the workflow)

| Stage | Tier | Effort |
|---|---|---|
| Implementation | worker | high |
| Spec review | worker | high |
| Quality review | worker (arbiter on the final batch — its cumulative diff review is the whole-run safety net) | high (xhigh on final) |
| Fix (staged) | worker → arbiter | high |
| Post-fix re-check (scoped to the findings) | worker | high |
| Final verification (full suite + lint, once per run) | verifier | low |

Planning (kit:brainstorming, kit:writing-plans) runs in the main session — run those in a strong-reasoning session. The workflow pins the above regardless of session model. Reviews are deliberately worker-first: transcript analysis showed 69% of review gates return zero actionable findings, so reviews run on the worker tier; the arbiter tier is reserved for the one review whose diff covers the entire run. Exact model pinning is per-platform — see `launch.md` in this skill's directory.

## Interruptibility

Background execution keeps this session live — watch progress and interject anytime. `launch.md` in this skill's directory covers exactly how to stop and resume a running workflow. Small batches keep work-at-risk low.

When re-reading a completed run later — in a resumed session, or from a saved output — extract the runner's return as described in `launch.md`.

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
- Launch with the session shell outside the target worktree, or without `args.worktree` — agents inherit your cwd, and a wrong cwd split-brains the run across checkouts.
- Build on main/master without explicit consent.
- Insert routine pauses — drive until done or genuinely blocked.
- Make agents re-read the plan file — pass full task text via `args`.
- Drop the ledger between segments — cross-batch awareness depends on it.
- Re-author the workflow inline when the bundled `build.workflow.js` exists.
- Truncate, summarize, or abbreviate the batch payload — incompleteness is what makes the runner block loudly, not run a silent partial batch. See your harness's launch doc for its exact failure mode.
- Treat an instant `blocked` return with no agents / empty `results` as success — that's a malformed or empty payload; fix the args and relaunch.
- Patch the runner to work around a no-op launch — fix the payload first; the runner blocks loudly to point you there.

## Integration

- **kit:git-worktrees** — REQUIRED: isolated workspace before starting.
- **kit:writing-plans** — Creates the plan this skill executes.
- **kit:code-review** — Standalone review; build-flow's review gate covers in-flight batches.
- **kit:finish-branch** — Complete development after approval.
- **kit:brainstorming** — Re-entry for design changes.
- **kit:tdd** — The workflow's implementer agents follow TDD.
- `./build.workflow.js` — The bundled batch runner this skill launches.
- `launch.md` — harness-specific launch mechanics, read on demand.
