export const meta = {
  name: 'code-review-runner-omp',
  description: 'Standalone diff/PR review: fan out review dimensions, adversarially verify each finding, return a consolidated report. OMP-native: dimension and verification agents are selected inline instead of by per-call model/effort.',
  phases: [
    { title: 'Review' },
    { title: 'Verify' },
  ],
}

// host: { agent, parallel, phase, log } — OMP's eval-kernel bridges, passed in by the
// caller (see launch.md). `agent(prompt, opts)` accepts ONLY { agent, label, schema } — OMP
// has no per-call model/effort, so each review dimension below names a fixed agent instead.

// args: { diffRef?: string, reviewDims?: {key,focus,agent}[], ledger?: object }

const WORKER = 'kit-worker'
const ARBITER = 'kit-arbiter'

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'issue'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'important', 'minor'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['real'],
  properties: { real: { type: 'boolean' }, reason: { type: 'string' } },
}

export async function run(host, args) {
  const { agent, parallel } = host
  const a = args ?? {}
  const diffRef = a.diffRef ?? 'main'
  const ledgerText = a.ledger ? JSON.stringify(a.ledger) : 'none'
  // kit-worker-first: measured across 6 weeks of runs, 69% of review agents return zero
  // actionable findings — kit-arbiter everywhere was paying frontier rates for "LGTM".
  // Architecture keeps kit-arbiter as the one deep-judgment safety net.
  const DIMS = a.reviewDims ?? [
    { key: 'correctness', focus: 'logic errors, bugs, broken edge cases, race conditions', agent: WORKER },
    { key: 'quality', focus: 'separation of concerns, DRY, naming, error handling, maintainability', agent: WORKER },
    { key: 'tests', focus: 'tests verify real behavior (not mocks), edge cases covered, all passing', agent: WORKER },
    { key: 'security', focus: 'injection, auth, secrets, unsafe operations', agent: WORKER },
    { key: 'architecture', focus: 'plan/design alignment, module boundaries, sound abstractions, scalability', agent: ARBITER },
  ]

  // Review each dimension (one wave, barrier), then adversarially verify every finding it
  // raised (a second wave, barrier) — a false positive costs a fix cycle, so nothing is
  // reported unverified.
  const reviewed = await parallel(DIMS.map((d) => () =>
    agent(
      `Review the diff \`git diff ${diffRef}\` for the "${d.key}" dimension: ${d.focus}.\nCross-task ledger: ${ledgerText}.\nVerify by reading the actual code. Return findings (severity critical|important|minor, with file/line/issue/fix).`,
      { agent: d.agent, label: `review:${d.key}`, schema: FINDINGS_SCHEMA },
    ),
  ))

  const verified = await parallel(
    reviewed.flatMap((r, i) => {
      const d = DIMS[i]
      return ((r && r.findings) || []).map((f) => () =>
        agent(
          `Adversarially check whether this ${d.key} finding is REAL (not a false positive): "${f.issue}" at ${f.file ?? '?'}:${f.line ?? '?'}. Read the code. Default to real=false if uncertain.`,
          { agent: WORKER, label: `verify:${d.key}`, schema: VERDICT_SCHEMA },
        ).then((v) => ({ ...f, dimension: d.key, verified: !!(v && v.real) })),
      )
    }),
  )

  const findings = verified.filter(Boolean).filter((f) => f.verified)
  return { diffRef, findings }
}
