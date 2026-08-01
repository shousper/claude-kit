export const meta = {
  name: 'build-flow-batch-runner',
  description: 'Executes an implementation plan batch-by-batch (implement sequentially, then parallel spec+quality review with a staged fix-loop and scoped re-checks), ending with a full-suite verification. Returns done or blocked; never commits.',
  phases: [
    { title: 'Implement' },
    { title: 'Review' },
    { title: 'Fix' },
    { title: 'Verify' },
  ],
}

// args: {
//   batches: [ [ { id, title, prompt }, ... ], ... ], // dependency-ordered; tasks within a batch are independent
//   ledger: { decisions: string[], conventions: string[], deviations: string[] },
//   startBatch: number,   // resume point after a blocker (default 0)
//   maxFixRounds: number, // default 3
//   worktree: string,     // absolute worktree path; stamped into every agent prompt
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
// Workflow agents inherit the SESSION shell's cwd — not the path the
// orchestrator had in mind. A launch from the wrong directory split-brains the
// run (some agents edit the main checkout, reviewers see "no implementation",
// fixes land in the orphaned copy). When the orchestrator passes the worktree,
// every prompt opens with a hard cd instruction.
const WT = typeof a.worktree === 'string' && a.worktree.trim() ? a.worktree.trim() : null
const wtHeader = WT
  ? `## Worktree\nALL work happens in ${WT} — run \`cd ${WT}\` FIRST. Every file you read or edit lives under this path; if your shell is anywhere else, you are in the wrong checkout of this repo.\n\n`
  : ''
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

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['passed', 'summary'],
  properties: {
    passed: { type: 'boolean' },
    summary: { type: 'string', description: 'MAX 60 words; e.g. "412 tests pass, lint clean" or what failed' },
    failures: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        required: ['check', 'detail'],
        properties: {
          check: { type: 'string', description: 'failing test name or lint rule' },
          detail: { type: 'string', description: 'MAX 30 words; file + expected vs actual — never paste logs' },
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
  `${wtHeader}You are implementing ONE task from an approved plan, in the current git worktree. Do NOT commit — implement and test only.

## Task
${task.prompt}

## Cross-task ledger (decisions/conventions so far)
${ledgerText(ledger)}

## How to work
- Follow TDD: write the failing test FIRST, run it to confirm it fails, then implement the minimal code to pass.
- Follow existing patterns in the codebase. YAGNI — build only what the task specifies.
- Run ONLY the tests relevant to this task, with a quiet reporter; confirm they pass. Never run the full suite — a final verification stage runs it once at the end of the run. Do not commit.
- Keep your context lean: read files in relevant sections rather than whole files; pipe long command output through filters (\`tail\`, \`grep\`) instead of dumping it.
- Self-review before reporting: completeness vs the task, clear names, no overbuilding, tests verify real behavior.

## If you cannot proceed
If the task is ambiguous, underspecified, contradicts the codebase, needs an unplanned decision, or would require a destructive/irreversible action — STOP and set needsHumanInput.reason describing exactly what you need. Do not guess.`

const specPrompt = (batch) =>
  `${wtHeader}You are a spec-compliance reviewer. Verify the uncommitted changes match the tasks below — nothing more, nothing less. Inspect the diff yourself (e.g. \`git diff main\`); do NOT trust any implementer summary.

## Tasks in this batch
${batchText(batch)}

## Cross-task ledger
${ledgerText(ledger)}

Check: missing requirements, extra/unrequested work, misunderstandings. Use the ledger to catch inconsistencies with earlier batches (e.g. an earlier task used pattern X, this batch uses Y). Verify by reading code. Return approved + findings (severity critical|important|minor, with file/line/issue/fix).`

const qualityPrompt = (batch) =>
  `${wtHeader}You are a code-quality reviewer. Review the uncommitted changes (\`git diff main\`) for the tasks below.

## Tasks in this batch
${batchText(batch)}

## Cross-task ledger
${ledgerText(ledger)}

Check: separation of concerns, error handling, type safety, DRY, edge cases; sound design and security; tests verify real behavior (not mocks), edge cases covered, all passing. Flag architectural drift across batches using the ledger. Return approved + findings (severity critical|important|minor, with file/line/issue/fix).`

const fixPrompt = (batch, findings) =>
  `${wtHeader}Reviewers found issues in the current batch. Fix each one in the worktree (do NOT commit), then re-run ONLY the affected tests (quiet reporter) to confirm — never the full suite.

## Findings to fix
${findingsText(findings)}

## Batch tasks (context)
${batchText(batch)}

## Cross-task ledger
${ledgerText(ledger)}

If a finding is wrong or impossible to satisfy, set needsHumanInput.reason instead of guessing. Return a summary, files touched, and whether tests passed.`

const recheckPrompt = (batch, findings) =>
  `${wtHeader}A fix agent just addressed the review findings below in the current worktree. Verify the fixes — do NOT re-review the whole batch.

## Findings that were supposedly fixed
${findingsText(findings)}

## Batch tasks (context)
${batchText(batch)}

Inspect the current code yourself (targeted diffs on the affected files); do not trust the fixer's summary. Check each finding is genuinely resolved and that the fix introduced no new problem in the code it touched. Return approved + findings containing ONLY findings that remain unresolved or were newly introduced by the fixes (severity critical|important|minor).`

const verifyPrompt = () =>
  `${wtHeader}Final verification for the whole run, in the current git worktree. Do NOT change any code.

1. Discover the project's full test and lint commands (package.json scripts, Makefile, mise.toml, pyproject.toml, etc.).
2. Run the FULL test suite, then the linter. Keep your context lean: use quiet reporters where available and pipe output through a filter (e.g. \`... 2>&1 | tail -40\`) so only summaries and failures enter your context — never read full passing output.
3. Return passed=true only if both are clean. On failure, return one entry per failing test/lint rule with a one-line detail an independent fix agent can act on (file, expected vs actual) — never paste logs.`

const verifyFixPrompt = (verification) =>
  `${wtHeader}The final full-suite verification failed. Fix each failure in the worktree (do NOT commit), then re-run ONLY the affected tests/lint rules with a quiet reporter to confirm — the verifier re-runs the full suite after you.

## Failures
${(verification.failures ?? []).map((f) => `- ${f.check}: ${f.detail}`).join('\n')}

## Cross-task ledger
${ledgerText(ledger)}

If a failure is pre-existing on the base branch or needs an unplanned decision, set needsHumanInput.reason instead of guessing.`

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

  // Review gate: ONE full spec+quality review per batch, then a staged fix-loop
  // with scoped re-checks. Re-checks verify the specific findings and the code
  // the fixes touched — never a second full review (reviews outnumbering
  // implementation 2:1 was the single largest measured token sink).
  phase('Review')
  const finalBatch = b === batches.length - 1
  const [spec, quality] = await parallel([
    () => agent(specPrompt(batch), { label: `spec:b${b + 1}`, phase: 'Review', model: 'sonnet', effort: 'high', schema: REVIEW_SCHEMA }),
    // Quality reviews run on Sonnet; the final batch escalates to Opus — its
    // `git diff main` covers the whole run, so this is the run-level safety net.
    () => agent(qualityPrompt(batch), {
      label: `quality:b${b + 1}`, phase: 'Review',
      model: finalBatch ? 'opus' : 'sonnet', effort: finalBatch ? 'xhigh' : 'high', schema: REVIEW_SCHEMA,
    }),
  ])
  let findings = [...(spec?.findings ?? []), ...(quality?.findings ?? [])]
    .filter((f) => f.severity === 'critical' || f.severity === 'important')
  let round = 0
  while (findings.length > 0) {
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
    const recheck = await agent(recheckPrompt(batch, findings), { label: `recheck:b${b + 1}:r${round}`, phase: 'Review', model: 'sonnet', effort: 'high', schema: REVIEW_SCHEMA })
    findings = (recheck?.findings ?? []).filter((f) => f.severity === 'critical' || f.severity === 'important')
  }

  ledger.decisions.push(`Batch ${b + 1} (${batch.map((t) => t.id).join(', ')}) implemented and reviewed clean.`)
  log(`Batch ${b + 1} complete.`)
}

// Final verification: the ONE place the full suite + linter run. Batch agents
// run only task-scoped tests, and the structured summary keeps raw test output
// out of the orchestrator's context entirely.
phase('Verify')
let verification = null
for (let v = 0; ; v++) {
  verification = await agent(verifyPrompt(), { label: `verify:r${v + 1}`, phase: 'Verify', model: 'sonnet', effort: 'low', schema: VERIFY_SCHEMA })
  if (!verification || verification.passed) break
  if (v >= 2) {
    return { status: 'blocked', blockedAtBatch: batches.length - 1, reason: `Final verification still failing after ${v} fix round(s): ${verification.summary}`, findings: verification.failures, ledger, results }
  }
  log(`Final verification failed (${verification.failures?.length ?? 0} failure(s)) — fix round ${v + 1}`)
  const fix = await agent(verifyFixPrompt(verification), { label: `verify-fix:r${v + 1}`, phase: 'Verify', model: v === 0 ? 'sonnet' : 'opus', effort: 'high', schema: IMPL_SCHEMA })
  if (fix && fix.needsHumanInput) {
    return { status: 'blocked', blockedAtBatch: batches.length - 1, reason: fix.needsHumanInput.reason, findings: verification.failures, ledger, results }
  }
}
ledger.decisions.push(`Final verification: ${verification ? verification.summary : 'verifier returned no result'}`)

return { status: 'done', results, ledger, verification }
