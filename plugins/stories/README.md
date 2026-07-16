# stories

Story-based autonomous development for Claude Code: a repo-native markdown story board with typed verification gates, worked by one or more agent sessions in a goal loop until the board is drained, the budget runs out, or everything left is blocked on a human.

Built on [kit](../../README.md) — each story is implemented via kit:build-flow, and review feedback is processed via kit:receiving-review. **Requires the kit plugin.**

## Install

```bash
/plugin marketplace add shousper/claude-kit
/plugin install kit@shousper-kit
/plugin install stories@shousper-kit
```

## Quickstart

1. **`/stories:setup`** — one-time project onboarding. Writes the committed marker config `.claude/story-workflow.json`, scaffolds `stories/`, appends the gitignore entries below, picks a merge mode, and defines verification gates (it detects your test runner and can wire browser-based visual gates).
2. **`/stories:plan`** — turn a design or spec (often from kit:brainstorming) into epics and stories with dependencies, `touches` hints, gates, and mechanically verifiable acceptance criteria. You approve the set before anything is filed.
3. Say **"complete all stories"** — `stories:work` claims a ready story into its own worktree, implements it via kit:build-flow, runs its gates, integrates, and the Stop-hook loop feeds it the next story until the goal is met.
4. **`/stories:cancel`** — stop the loop any time; you get the board state and any parked questions.

Every board mutation goes through the bundled `story` CLI (`bin/story`, zero-dependency Node ≥ 20; every read supports `--json`). Agents are blocked from hand-editing `stories/**` by a PreToolUse hook; humans can hand-write story files freely — `story doctor` adopts them.

## Stories are evidence-gated

A story only reaches `done` when every **command gate** (e.g. `bun test`) has actually passed — executed by the CLI, recorded as evidence under `.claude/story-evidence/` — and every **review gate** (e.g. a visual-reviewer persona) has a recorded verdict. The model's claim that work is finished is never sufficient.

## Modes: singleplayer & multiplayer

The `merge` field in `.claude/story-workflow.json` picks the integration style:

| Mode | Who merges | Flow |
|---|---|---|
| `self` | The agent | Gates green → merge story branch to main → next story. Fully autonomous singleplayer. |
| `local` | You, locally | Gates green → story parks `in-review` with its worktree; you review and merge; the loop detects the landed branch and moves on. |
| `pr` | GitHub PRs (multiplayer) | Gates green → branch pushed, PR opened with AC + evidence summary. Review feedback becomes ready work items (processed via kit:receiving-review); merged PRs close stories; main drift is merged back into open PR branches and gates re-run. |

Run more workers by opening more terminals in the same repo — claiming is lock-safe, each story gets its own worktree under `.worktrees/`, and shared learnings cross-pollinate between workers.

**ONE-MACHINE ASSUMPTION: all agent workers must run on the same machine.** Coordination uses lockfiles under `.claude/locks/`, which do not work across machines or network filesystems — a second machine (even in `pr` mode) can silently corrupt the board. Humans on other machines participate through story files and PRs, never by running workers.

## Budgets & runaway protection

- Config budgets (in `.claude/story-workflow.json`): `budgets.maxIterations` (default 10) caps loop iterations per goal; `budgets.maxFixRoundsPerStory` (default 3) caps retry loops on a single story. Exhaustion ends the run with a summary instead of spinning.
- Claude Code itself force-stops a session after 8 consecutive blocked stops. Each loop iteration here does real work, so this rarely triggers — but for long boards you may raise it when launching a worker:

```bash
CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=50 claude
```

- `/stories:cancel` is the escape hatch; the loop state is per-session, so closing the terminal also stops that worker.

## Files in your project

| Path | Committed? | What |
|---|---|---|
| `.claude/story-workflow.json` | yes | Marker + config: merge mode, gates, defaults, budgets |
| `stories/*.md` | yes | The board — one markdown file per story, YAML frontmatter |
| `stories/archive/` | yes | Done stories moved out of the active set (`story archive`) |
| `.claude/story-loop.local.md` | no | Per-session loop state |
| `.claude/story-learnings.local.md` | no | Shared learnings between parallel workers |
| `.claude/story-sweep.local.json` | no | PR-sweep cursor state (`pr` mode only) |
| `.claude/story-evidence/` | no | Gate-run evidence per story |
| `.claude/locks/` | no | Lockfiles (board, merge, gate, sweep) |
| `.worktrees/` | no | One worktree per in-flight story |

`stories:setup` (like `story init`) appends the non-committed paths to `.gitignore`. This four-line block is canonical — byte-identical everywhere it is written (the `story init` command, the `stories:setup` skill, the plugin's eval fixtures, and here):

```
.worktrees/
.claude/*.local.*
.claude/locks/
.claude/story-evidence/
```

## Skills

| Skill | What it does |
|---|---|
| `stories:setup` | Onboard a project: config, scaffold, gates, merge mode, optional generated reviewer personas |
| `stories:plan` | Design/spec → approved epics + stories filed via `story create` |
| `stories:work` | The worker loop: claim → implement (kit:build-flow) → gates → integrate → repeat |
| `stories:cancel` | Stop the loop; report board state and parked questions |
| `stories:using-stories` | Session bootstrap injected at start: rules + live board snapshot |

## License

MIT
