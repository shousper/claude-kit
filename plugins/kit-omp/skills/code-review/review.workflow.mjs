export const meta = {
  name: 'code-review-runner-omp',
  description: 'Standalone diff/PR review: fan out review dimensions, adversarially verify each finding, return a consolidated report. Never throws or hangs: every agent is bounded by a timeout, and a dimension that fails is reported by id instead of aborting the review. OMP-native: dimension and verification agents are selected inline.',
  phases: [
    { title: 'Review' },
    { title: 'Verify' },
  ],
}

// Host bridges: bound from the eval kernel's globals exactly as in build.workflow.mjs
// (see the comment there). run(args, hostOverride?) — never pass a host as the first argument.

// args: { diffRef?: string, reviewDims?: {key,focus,agent}[], ledger?: object, stageTimeoutMinutes?: number }

const WORKER = 'kit-worker'
const ARBITER = 'kit-arbiter'

const errorText = (e) => (e && e.message ? e.message : String(e))

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

function bindHost(override) {
  const pick = (name) => (override && override[name] !== undefined ? override[name] : globalThis[name])
  return {
    agent: pick('agent'),
    phase: pick('phase') ?? (() => {}),
    log: pick('log') ?? (() => {}),
  }
}

export async function run(args, hostOverride) {
  if (args && typeof args.agent === 'function') {
    return {
      status: 'blocked',
      reason: "code-review runner: run() takes ONE argument, the args object. The eval kernel's agent/log/phase globals are bound by the module itself — call run(args) and never pass a host object.",
      diffRef: null,
      findings: [],
    }
  }
  const host = bindHost(hostOverride)
  if (typeof host.agent !== 'function') {
    return {
      status: 'blocked',
      reason: 'code-review runner: no agent() global — this module must run from an OMP eval cell (language: js), where the kernel installs agent(); it cannot run under bash, node, or bun.',
      diffRef: null,
      findings: [],
    }
  }
  const { agent, phase, log } = host
  const a = args ?? {}
  const diffRef = a.diffRef ?? 'main'
  const ledgerText = a.ledger ? JSON.stringify(a.ledger) : 'none'
  const STAGE_TIMEOUT_MINUTES = Number.isFinite(a.stageTimeoutMinutes) && a.stageTimeoutMinutes > 0 ? a.stageTimeoutMinutes : 60
  const STAGE_TIMEOUT_SECONDS = Math.round(STAGE_TIMEOUT_MINUTES * 60)
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

  // stage(): spawn, wait with a timeout, never throw. A failure is recorded by agent id and
  // the stage yields null, so one dead reviewer degrades the review to `partial` instead of
  // losing every other dimension's work.
  const failed = []
  const stage = async (label, prompt, opts) => {
    let handle
    try {
      handle = await agent(prompt, { ...opts, label })
    } catch (e) {
      failed.push({ id: label, error: `spawn failed: ${errorText(e)}` })
      return null
    }
    const id = handle && handle.id ? handle.id : label
    try {
      return await handle.wait({ timeout: STAGE_TIMEOUT_SECONDS })
    } catch (e) {
      try {
        await handle.cancel()
      } catch {
        // already settled
      }
      const timedOut = e && e.name === 'TimeoutError'
      failed.push({ id, error: timedOut ? `still running after ${STAGE_TIMEOUT_MINUTES} min (cancelled)` : errorText(e) })
      return null
    }
  }

  // Review each dimension (one wave), then adversarially verify every finding it raised
  // (a second wave) — a false positive costs a fix cycle, so nothing is reported unverified.
  phase('Review')
  log(`Reviewing \`git diff ${diffRef}\` across ${DIMS.length} dimension(s)`)
  const reviewed = await Promise.all(
    DIMS.map((d) =>
      stage(
        `review-${d.key}`,
        `Review the diff \`git diff ${diffRef}\` for the "${d.key}" dimension: ${d.focus}.\nCross-task ledger: ${ledgerText}.\nVerify by reading the actual code. Return findings (severity critical|important|minor, with file/line/issue/fix).`,
        { agent: d.agent, schema: FINDINGS_SCHEMA },
      ),
    ),
  )

  phase('Verify')
  const candidates = reviewed.flatMap((r, i) => ((r && r.findings) || []).map((f) => ({ ...f, dimension: DIMS[i].key })))
  log(`Verifying ${candidates.length} candidate finding(s)`)
  const verdicts = await Promise.all(
    candidates.map((f, i) =>
      stage(
        `verify-${f.dimension}-${i + 1}`,
        `Adversarially check whether this ${f.dimension} finding is REAL (not a false positive): "${f.issue}" at ${f.file ?? '?'}:${f.line ?? '?'}. Read the code. Default to real=false if uncertain.`,
        { agent: WORKER, schema: VERDICT_SCHEMA },
      ),
    ),
  )

  const findings = candidates
    .map((f, i) => ({ ...f, verified: !!(verdicts[i] && verdicts[i].real) }))
    .filter((f) => f.verified)
  return failed.length > 0
    ? { status: 'partial', diffRef, findings, failed }
    : { status: 'done', diffRef, findings }
}
