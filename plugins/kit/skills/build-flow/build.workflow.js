export const meta = {
  name: 'build-flow-batch-runner',
  description: 'Executes an implementation plan batch-by-batch (implement sequentially, then parallel spec+quality review with a staged fix-loop). Returns done or blocked; never commits.',
  phases: [
    { title: 'Implement' },
    { title: 'Review' },
    { title: 'Fix' },
  ],
}

// args: {
//   batches: [ [ { id, title, prompt }, ... ], ... ], // dependency-ordered; tasks within a batch are independent
//   ledger: { decisions: string[], conventions: string[], deviations: string[] },
//   startBatch: number,   // resume point after a blocker (default 0)
//   maxFixRounds: number, // default 3
// }

// `args` is forwarded verbatim from the Workflow call and SHOULD be a structured object.
// Callers sometimes pass a JSON-encoded string by mistake, which makes `args.batches`
// undefined and the whole run a silent no-op — normalize defensively, and fail loud
// rather than reporting a fake `done`.
let a = args ?? {}
if (typeof a === 'string') {
  try {
    a = JSON.parse(a)
  } catch (e) {
    return {
      status: 'blocked',
      blockedAtBatch: 0,
      reason: `build-flow runner: args arrived as a string that is not valid JSON (${e.message}). Pass args as a structured object, not a JSON-encoded string.`,
      ledger: { decisions: [], conventions: [], deviations: [] },
      results: [],
    }
  }
}
const MAX_FIX_ROUNDS = a.maxFixRounds ?? 3
const ledger = a.ledger ?? { decisions: [], conventions: [], deviations: [] }
const startBatch = a.startBatch ?? 0
const batches = a.batches ?? []
const results = []

// No batches almost always means a malformed launch (args stringified, or a plan that
// parsed into zero tasks). Block loudly instead of returning `done` with zero work — a
// fake success is the worst outcome because it looks like the plan ran.
if (!Array.isArray(batches) || batches.length === 0) {
  return {
    status: 'blocked',
    blockedAtBatch: startBatch,
    reason: 'build-flow runner: no batches to execute. args.batches was empty or missing — check that args was passed as a structured object (not a JSON-encoded string) and that the plan parsed into at least one task.',
    ledger,
    results,
  }
}

// Each batch must be a bare array of task objects. A common mis-shaping is wrapping tasks
// in an object (e.g. { index, tasks: [...] }), which would crash `for (const task of batch)`
// with an opaque "not iterable" error. Block loudly with a shape hint instead.
const badBatch = batches.findIndex((batch) => !Array.isArray(batch))
if (badBatch !== -1) {
  return {
    status: 'blocked',
    blockedAtBatch: badBatch,
    reason: `build-flow runner: batch ${badBatch} is not an array of tasks. Each batch must be a bare array like [ { id, title, prompt }, ... ] — not an object (e.g. { index, tasks: [...] }). Fix the batches shape in args.`,
    ledger,
    results,
  }
}

const IMPL_SCHEMA = {
  type: 'object',
  required: ['summary', 'filesTouched', 'testsPassed'],
  properties: {
    summary: { type: 'string', description: 'MAX 120 words; summarize, cite files by path, never paste file bodies' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    testsPassed: { type: 'boolean' },
    needsHumanInput: {
      type: 'object',
      required: ['reason'],
      properties: { reason: { type: 'string', description: 'MAX 120 words; summarize, cite files by path, never paste file bodies' } },
    },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['approved', 'findings'],
  properties: {
    approved: { type: 'boolean' },
    findings: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        required: ['severity', 'issue'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'important', 'minor'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          issue: { type: 'string', description: 'MAX 60 words; summarize, cite files by path, never paste file bodies' },
          fix: { type: 'string', description: 'MAX 60 words; summarize, cite files by path, never paste file bodies' },
        },
      },
    },
  },
}

const ledgerText = (l) =>
  `Decisions: ${l.decisions.join(' | ') || 'none'}\n` +
  `Conventions: ${l.conventions.join(' | ') || 'none'}\n` +
  `Deviations: ${l.deviations.join(' | ') || 'none'}`

const batchText = (batch) => batch.map((t) => `- ${t.id}: ${t.title}`).join('\n')

const findingsText = (fs) =>
  fs.map((f) => `- [${f.severity}] ${f.file ?? '?'}:${f.line ?? '?'} — ${f.issue}${f.fix ? ` (fix: ${f.fix})` : ''}`).join('\n')

const implPrompt = (task) =>
  `You are implementing ONE task from an approved plan, in the current git worktree. Do NOT commit — implement and test only.

## Task
${task.prompt}

## Cross-task ledger (decisions/conventions so far)
${ledgerText(ledger)}

## How to work
- Follow TDD: write the failing test FIRST, run it to confirm it fails, then implement the minimal code to pass.
- Follow existing patterns in the codebase. YAGNI — build only what the task specifies.
- Run the relevant tests; confirm they pass. Do not commit.
- Self-review before reporting: completeness vs the task, clear names, no overbuilding, tests verify real behavior.

## If you cannot proceed
If the task is ambiguous, underspecified, contradicts the codebase, needs an unplanned decision, or would require a destructive/irreversible action — STOP and set needsHumanInput.reason describing exactly what you need. Do not guess.`

const specPrompt = (batch) =>
  `You are a spec-compliance reviewer. Verify the uncommitted changes match the tasks below — nothing more, nothing less. Inspect the diff yourself (e.g. \`git diff main\`); do NOT trust any implementer summary.

## Tasks in this batch
${batchText(batch)}

## Cross-task ledger
${ledgerText(ledger)}

Check: missing requirements, extra/unrequested work, misunderstandings. Use the ledger to catch inconsistencies with earlier batches (e.g. an earlier task used pattern X, this batch uses Y). Verify by reading code. Return approved + findings (severity critical|important|minor, with file/line/issue/fix).`

const qualityPrompt = (batch) =>
  `You are a code-quality reviewer. Review the uncommitted changes (\`git diff main\`) for the tasks below.

## Tasks in this batch
${batchText(batch)}

## Cross-task ledger
${ledgerText(ledger)}

Check: separation of concerns, error handling, type safety, DRY, edge cases; sound design and security; tests verify real behavior (not mocks), edge cases covered, all passing. Flag architectural drift across batches using the ledger. Return approved + findings (severity critical|important|minor, with file/line/issue/fix).`

const fixPrompt = (batch, findings) =>
  `Reviewers found issues in the current batch. Fix each one in the worktree (do NOT commit), then re-run tests to confirm.

## Findings to fix
${findingsText(findings)}

## Batch tasks (context)
${batchText(batch)}

## Cross-task ledger
${ledgerText(ledger)}

If a finding is wrong or impossible to satisfy, set needsHumanInput.reason instead of guessing. Return a summary, files touched, and whether tests passed.`

for (let b = startBatch; b < batches.length; b++) {
  const batch = batches[b]
  phase('Implement')
  log(`Batch ${b + 1}/${batches.length}: implementing ${batch.length} task(s)`)

  // Implement sequentially within a batch (parallel file-writers would need worktree isolation — deferred).
  for (const task of batch) {
    const r = await agent(implPrompt(task), {
      label: `impl:${task.id}`, phase: 'Implement',
      model: 'sonnet', effort: 'high', schema: IMPL_SCHEMA,
    })
    if (r && r.needsHumanInput) {
      return { status: 'blocked', blockedAtBatch: b, reason: r.needsHumanInput.reason, ledger, results }
    }
    if (r) results.push({ batch: b, task: task.id, ...r })
  }

  // Review gate: spec + quality in parallel, with a staged fix-loop.
  phase('Review')
  let round = 0
  for (;;) {
    const [spec, quality] = await parallel([
      () => agent(specPrompt(batch), { label: `spec:b${b + 1}`, phase: 'Review', model: 'sonnet', effort: 'high', schema: REVIEW_SCHEMA }),
      () => agent(qualityPrompt(batch), { label: `quality:b${b + 1}`, phase: 'Review', model: 'opus', effort: 'xhigh', schema: REVIEW_SCHEMA }),
    ])
    const findings = [...(spec?.findings ?? []), ...(quality?.findings ?? [])]
      .filter((f) => f.severity === 'critical' || f.severity === 'important')
    if (findings.length === 0) break

    if (round >= MAX_FIX_ROUNDS) {
      return { status: 'blocked', blockedAtBatch: b, reason: `Review unresolved after ${MAX_FIX_ROUNDS} fix round(s)`, findings, ledger, results }
    }
    phase('Fix')
    const fixModel = round < MAX_FIX_ROUNDS - 1 ? 'sonnet' : 'opus' // staged escalation
    log(`Batch ${b + 1} fix round ${round + 1} (${fixModel}): ${findings.length} finding(s)`)
    const fix = await agent(fixPrompt(batch, findings), { label: `fix:b${b + 1}:r${round + 1}`, phase: 'Fix', model: fixModel, effort: 'high', schema: IMPL_SCHEMA })
    if (fix && fix.needsHumanInput) {
      return { status: 'blocked', blockedAtBatch: b, reason: fix.needsHumanInput.reason, findings, ledger, results }
    }
    round++
  }

  ledger.decisions.push(`Batch ${b + 1} (${batch.map((t) => t.id).join(', ')}) implemented and reviewed clean.`)
  log(`Batch ${b + 1} complete.`)
}

return { status: 'done', results, ledger }
