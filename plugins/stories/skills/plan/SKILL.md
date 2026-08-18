---
name: plan
description: Decomposes a spec or approved design into epics and stories on the story board — sized, dependency-ordered, gated, human-approved, then filed via the story CLI. Use in a project with .claude/story-workflow.json when there is a design doc (often from kit:brainstorming), spec, requirements file, or feature request to break down; it replaces kit:writing-plans in the workflow chain for story-based projects. Also use for "file stories", "break this into stories", "populate the board". DO NOT TRIGGER in projects without .claude/story-workflow.json (use kit:writing-plans), for executing stories (stories:work), or for filing a single discovered-work story mid-loop (plain story create).
---

# Story Planning

Turn a spec into board data. Each story file is the complete prompt a future worker — with no memory of this conversation — will implement from. Write for that reader.

**Core principle:** one story = one context window = one PR. Sizing is the whole game; everything else is bookkeeping.

## Process

### 1. Absorb the source

Read the spec or design in full. Unresolved product decisions go back to your human partner (or kit:brainstorming) — never invent them, and never encode an open question as an acceptance criterion. A genuinely open technical question can become a `spike` story.

### 2. Decompose

- **Epics** group related stories: file an epic as its own story whose body carries the shared context; children reference it via `--epic <id>`. Epics are never implemented or closed directly — no cascade.
- **Stories** obey the sizing rule. Too big — an "and" in the title, more than one subsystem, more than roughly a day of human work — split it. Two stories that can only ship together — merge them.

### 3. Draft each story

| Field | Rule |
|---|---|
| title | Imperative and specific: "Add ×N multiplier gates", not "Gates work" |
| type | `feature` / `bug` / `chore` / `spike` (projects may extend) |
| priority | P0..P3 — P0 means "the board is blocked without it" |
| depends_on | TRUE sequencing only (producer → consumer of an interface). Preference-ordering kills parallelism |
| touches | Coarse globs of what the story will modify, e.g. `src/gates/**`. A scheduler hint — conservative, directory-level |
| exclusive | `true` for sweeping refactors that own the whole repo; use it instead of a giant touches list |
| gates | Omit to accept the type defaults from config; override per story (UI story → add `visual`). Only names defined in `.claude/story-workflow.json` |
| complexity | `routine` (default — omit it) \| `hard` for cross-cutting, ambiguous, or multi-subsystem stories \| `frontier` reserved for the rare story your human partner explicitly wants frontier-model planning on. Proposed here, confirmed by the human at the approval gate |

Body sections:

Do NOT write an Implementation Plan section — planning happens at execution time (stories:work dispatches a planner against the current code); your job is Description pointers and verifiable ACs.

- **Description** — enough context to implement without the spec at hand: the why, pointers to relevant files, interfaces to honor.
- **Acceptance Criteria** — checkboxes, each mechanically verifiable by a command, a test, or an inspectable artifact. Never "works correctly", "is clean", "handles errors gracefully".

<Good>`- [ ] GET /health returns 200 with body {"status":"ok"}`</Good>
<Bad>`- [ ] Health endpoint works correctly`</Bad>

### 4. HARD GATE: human approval before filing

Present the full set for review — a table (placeholder ref, title, type, priority, deps, touches, gates, complexity) plus each story body. Iterate until your human partner explicitly approves. **No `story create` before approval.** An unapproved board pollutes provenance and wastes every worker that claims from it.

### 5. File via the CLI

Never write story files by hand (a hook denies it anyway).

1. Epics first — capture each printed id.
2. Stories next, mapping placeholder refs to the real ids:

```bash
story create --title "Add ×N multiplier gates" --type feature \
  --epic st-9c01 --depends-on st-1b3e --touches 'src/gates/**' \
  --gates test,e2e --complexity hard --body-file "$SCRATCH/story-body.md"
```

Write each body to a scratch file for `--body-file`.

### 6. Verify

- `story doctor` — clean: no dangling deps, no cycles.
- `story board` — matches the approved set; report the counts to the human.

## Handoff

Board filed. **Your job ends here — report the board (counts + `story board` summary) and STOP.** Execution belongs to separate worker sessions: tell your human partner to open one or more worker sessions and say "complete all stories". Never invoke stories:work, `story claim`, or `story loop start` from this planning session — planning sessions own no loop, and a Stop-hook re-prompt naming a story is addressed to the worker session that started that loop, not to you. Do NOT invoke kit:build-flow directly either — it runs per-story inside stories:work.

## Red Flags

**Never:**

- File before explicit approval.
- Write a vague AC — every checkbox needs a mechanical check.
- Chain `depends_on` for ordering preference.
- Use a whole-repo touches list — that is `exclusive: true`.
- Hand-edit `stories/**` — the CLI is the only writer.
- Let one story carry a second story's work — split it.
- Claim, implement, or start a story loop from a planning session — filing the board is the whole job.
- Act on a Stop-hook story re-prompt — those belong to the worker session bound to the loop.
