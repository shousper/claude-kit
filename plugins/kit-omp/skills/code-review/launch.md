# Launching code-review on OMP

The workflow module lives beside this doc, at `<base>/review.workflow.mjs`, where `<base>`
is this skill's own directory. Import and run it directly from your session's `eval`
device (`language: "js"`); no separate launcher tool is involved.

```js
const { run } = await import("<base>/review.workflow.mjs");

const result = await run(
  { agent, parallel }, // the eval kernel's own bridges — passed through as-is
  {
    diffRef: "main",             // or "{BASE_SHA}..{HEAD_SHA}" for a committed/PR range
    ledger: { decisions: [], conventions: [], deviations: [] }, // optional cross-batch context
    // reviewDims: [...] — optional; overrides the five default dimensions below
  },
);
```

- `diffRef` defaults to `'main'` if omitted.
- The default dimensions are correctness, quality, tests, security, and architecture; pass `reviewDims` to focus or extend the review. Each dimension names its own OMP agent (`kit-worker` by default; `kit-arbiter` for architecture, the one deep-judgment safety net) — there is no per-call model/effort to pass; `agent()` on this harness only ever takes `{ agent, label, schema }`. Each agent resolves its model through the same `modelRoles` alias chain as build-flow (`kit_worker`, `kit_arbiter`) — pin concrete models via `modelRoles.kit_worker` / `modelRoles.kit_arbiter` in OMP settings, or override per agent via `task.agentModelOverrides.<agent-name>`.
- It fans out one reviewer per dimension, adversarially verifies each finding it raises, and returns `{ diffRef, findings }` directly — there is no completion envelope to unwrap.

## Handling the result

`await run(...)` resolves to `{ diffRef, findings }`. Act on `findings` directly: fix Critical issues immediately, fix Important issues before proceeding, note Minor issues for later.

## Interruptibility

`eval` keeps the session live for the whole call — each `agent()` call inside the workflow streams as ordinary subagent activity in your session. Pass `timeout: 0` to the eval call to disable its own cell timeout for a long review. To stop a run, cancel the `eval` call and relaunch; there is no cached-agent-result replay.
