export const meta = {
  name: 'code-review-runner',
  description: 'Standalone diff/PR review: fan out review dimensions, adversarially verify each finding, return a consolidated report.',
  phases: [
    { title: 'Review' },
    { title: 'Verify' },
  ],
}

// args: { diffRef?: string, reviewDims?: {key,focus,model,effort}[], ledger?: object }

const diffRef = args.diffRef ?? 'main'
const ledgerText = args.ledger ? JSON.stringify(args.ledger) : 'none'
// Sonnet-first: measured across 6 weeks of runs, 69% of review agents return
// zero actionable findings — Opus everywhere was paying frontier rates for
// "LGTM". Architecture keeps Opus as the one deep-judgment safety net.
const DIMS = args.reviewDims ?? [
  { key: 'correctness', focus: 'logic errors, bugs, broken edge cases, race conditions', model: 'sonnet', effort: 'high' },
  { key: 'quality', focus: 'separation of concerns, DRY, naming, error handling, maintainability', model: 'sonnet', effort: 'high' },
  { key: 'tests', focus: 'tests verify real behavior (not mocks), edge cases covered, all passing', model: 'sonnet', effort: 'high' },
  { key: 'security', focus: 'injection, auth, secrets, unsafe operations', model: 'sonnet', effort: 'high' },
  { key: 'architecture', focus: 'plan/design alignment, module boundaries, sound abstractions, scalability', model: 'opus', effort: 'xhigh' },
]

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

const reviewed = await pipeline(
  DIMS,
  (d) => agent(
    `Review the diff \`git diff ${diffRef}\` for the "${d.key}" dimension: ${d.focus}.\nCross-task ledger: ${ledgerText}.\nVerify by reading the actual code. Return findings (severity critical|important|minor, with file/line/issue/fix).`,
    { label: `review:${d.key}`, phase: 'Review', model: d.model, effort: d.effort, schema: FINDINGS_SCHEMA },
  ),
  (r, d) => parallel(((r && r.findings) || []).map((f) => () =>
    agent(
      `Adversarially check whether this ${d.key} finding is REAL (not a false positive): "${f.issue}" at ${f.file ?? '?'}:${f.line ?? '?'}. Read the code. Default to real=false if uncertain.`,
      { label: `verify:${d.key}`, phase: 'Verify', model: 'sonnet', effort: 'high', schema: VERDICT_SCHEMA },
    ).then((v) => ({ ...f, dimension: d.key, verified: !!(v && v.real) })),
  )),
)

const findings = reviewed.flat().filter(Boolean).filter((f) => f.verified)
return { diffRef, findings }
