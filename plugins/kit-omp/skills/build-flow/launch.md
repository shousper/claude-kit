# Launching build-flow on OMP

The workflow module lives beside this doc, at `<base>/build.workflow.mjs`, where `<base>`
is this skill's own directory. Import and run it directly from your session's `eval`
device (`language: "js"`); no separate launcher tool is involved.

```js
const { run } = await import("<base>/build.workflow.mjs");

const result = await run(
  { agent, parallel, phase, log }, // the eval kernel's own bridges — passed through as-is
  {
    worktree: "<absolute path to the current worktree>",
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
  },
);
```

- Every task carries its FULL `prompt` text — agents never re-read the plan. Never abbreviate or summarize a prompt to shrink the call.
- The second argument (`args`) may be this object **or** a valid JSON string of it — `run()` normalizes either. The only launches that fail are a truncated/malformed payload or zero batches, both of which return `status: 'blocked'` immediately instead of a fake `done`.
- Stage-to-agent selection (`kit-worker`, `kit-arbiter`, `kit-verifier`) is pinned inline inside `build.workflow.mjs` — there is no per-call model/effort to pass; `agent()` on this harness only ever takes `{ agent, label, schema }`.

## Stage → Agent

`build.workflow.mjs` selects a fixed OMP agent per stage instead of per-call model/effort:

| Stage | Agent |
|---|---|
| Implementation | kit-worker |
| Spec review | kit-worker |
| Quality review | kit-worker (kit-arbiter on the final batch — its cumulative diff review is the whole-run safety net) |
| Fix (staged) | kit-worker → kit-arbiter |
| Post-fix re-check (scoped to the findings) | kit-worker |
| Final verification (full suite + lint, once per run) | kit-verifier |

Each agent resolves its model through a `modelRoles` alias chain (`kit_worker`, `kit_verifier`, `kit_arbiter`), falling through to the session model when unset. Pin a concrete model with `modelRoles.kit_worker: <provider/model>` (and `kit_verifier`, `kit_arbiter`) in OMP settings, or override a single agent via `task.agentModelOverrides.<agent-name>`.

## Handling the result

`await run(...)` resolves directly to the workflow's own return value — `{ status, results, ledger, findings, verification }`. There is no completion envelope to unwrap first; the return IS the result.

- `status === 'done'` → merge the returned `ledger`, report `verification.summary` as the test evidence (the workflow already ran the full suite + linter — do NOT re-run it or read test output yourself), present a final summary, then the iteration choice.
- `status === 'blocked'` → surface `reason`, `blockedAtBatch`, and any `findings`, resolve with your human partner, then call `run()` again with `startBatch` set to `blockedAtBatch` and the updated `ledger`.

## Stopping and resuming

`eval` keeps the session live for the whole call — each `agent()` call inside the workflow streams as ordinary subagent activity in your session, and the workflow's own `phase()`/`log()` calls narrate progress alongside it. Pass `timeout: 0` to the eval call to disable its own cell timeout for a long run. To stop a run, cancel the `eval` call; resume by calling `run()` again with `startBatch` set to the last-completed batch and the last-known `ledger` — there is no cached-agent-result replay.
