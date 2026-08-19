export const meta = {
  name: 'story-planners',
  description: 'Dispatches execution-time story planners at models pinned by story complexity. Parallel across stories; no fallback path — a failed planner reports planner-failed, never a lesser model.',
  phases: [{ title: 'Plan' }],
}

// args: [ { id, complexity, worktree, storyBody }, ... ] — one entry per claimed story.
// The worker session passes data only; every model decision lives in THIS file.
let a = args ?? []
if (typeof a === 'string') {
  try {
    a = JSON.parse(a)
  } catch (e) {
    return { status: 'blocked', reason: `story-planners: args arrived as a string that is not valid JSON (${e.message}). Pass args as a structured array.`, planned: [], unimplementable: [], failed: [] }
  }
}
if (!Array.isArray(a) || a.length === 0) {
  return { status: 'blocked', reason: 'story-planners: args must be a non-empty array of {id, complexity, worktree, storyBody}.', planned: [], unimplementable: [], failed: [] }
}

// Complexity → model/effort. Deliberately CODE, not prose: the worker session
// never chooses, retries, or substitutes a planner model, and no downgrade
// branch exists anywhere in this script. An unknown complexity is a FAILURE,
// not a fallback (complexity is CLI-validated at create/update, so this only
// fires on a mangled args payload).
const TIER = {
  routine: { model: 'sonnet', effort: 'high' },
  hard: { model: 'opus', effort: 'xhigh' },
  frontier: { model: 'fable', effort: 'xhigh' }, // human opt-in, made at board approval
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    plan: { type: 'string', description: 'Implementation plan markdown: numbered steps, exact file paths, what each test proves. Becomes the story\'s permanent plan of record.' },
    batches: {
      type: 'array',
      description: 'Dependency-ordered batches of bite-sized TDD tasks. One batch unless tasks genuinely must land sequentially.',
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, title: { type: 'string' }, prompt: { type: 'string' } },
          required: ['id', 'title', 'prompt'],
          additionalProperties: false,
        },
      },
    },
    unimplementable: {
      type: 'object',
      description: 'Set INSTEAD of plan/batches when the story cannot be implemented as specified.',
      properties: { question: { type: 'string' } },
      required: ['question'],
      additionalProperties: false,
    },
  },
  additionalProperties: false,
}

const plannerPrompt = (s) => [
  `You are the execution-time planner for story ${s.id}.`,
  `ALL exploration happens in the story worktree: run \`cd ${s.worktree}\` FIRST. Explore the code there and verify every file pointer in the story against reality — prerequisites may have merged since the story was written.`,
  '',
  '## Story (the complete spec — do not re-read the board)',
  '',
  String(s.storyBody ?? ''),
  '',
  '## Output contract',
  '',
  'Return `plan` (markdown: numbered steps, exact file paths, what each test proves) and `batches` (dependency-ordered batches of task objects {id, title, prompt}; each prompt fully self-contained — an implementer with zero context must execute it without reading the story; one batch unless tasks genuinely must land sequentially).',
  'If the story is unimplementable as specified (contradicts the code, missing prerequisite), return `unimplementable` with a specific, answerable question INSTEAD — never a made-up plan.',
].join('\n')

phase('Plan')
const rows = (await parallel(a.map((s) => () => {
  const tier = TIER[s.complexity ?? 'routine']
  if (!tier) {
    return Promise.resolve({ id: s.id, status: 'planner-failed', error: `unknown complexity '${s.complexity}'` })
  }
  return agent(plannerPrompt(s), { label: `plan:${s.id}`, phase: 'Plan', model: tier.model, effort: tier.effort, schema: PLAN_SCHEMA })
    .then((r) => {
      if (!r) {
        return { id: s.id, status: 'planner-failed', model: tier.model, error: 'planner agent died on a terminal error after harness retries — park the story; there is no alternative-model path' }
      }
      if (r.unimplementable) {
        return { id: s.id, status: 'unimplementable', model: tier.model, question: r.unimplementable.question }
      }
      if (typeof r.plan === 'string' && r.plan.trim() && Array.isArray(r.batches) && r.batches.length > 0) {
        return { id: s.id, status: 'planned', model: tier.model, plan: r.plan, batches: r.batches }
      }
      return { id: s.id, status: 'planner-failed', model: tier.model, error: 'planner returned neither a complete plan+batches nor an unimplementable question' }
    })
}))).filter(Boolean)

// Every input story must land in exactly one bucket. `parallel` drops a
// rejected planner promise from `rows` entirely (not just a null resolution),
// so reconcile against the input ids and park anything that went missing
// rather than let it stay claimed with no plan and no park.
const seen = new Set(rows.map((r) => r.id))
const missing = a.filter((s) => !seen.has(s.id))
  .map((s) => ({ id: s.id, status: 'planner-failed', error: 'planner promise was rejected/dropped before producing a result — park the story; there is no alternative-model path' }))

log(`planned ${rows.filter((r) => r.status === 'planned').length}/${a.length}`)
return {
  status: 'done',
  planned: rows.filter((r) => r.status === 'planned'),
  unimplementable: rows.filter((r) => r.status === 'unimplementable'),
  failed: [...rows.filter((r) => r.status === 'planner-failed'), ...missing],
}
