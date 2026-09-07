# stories

Story-based autonomous development: a repo-native markdown story board with typed verification gates, worked by one or more agent sessions in a goal loop until the board is drained, the loop stalls, or everything left is blocked on a human.

Built on [kit](../../README.md) — each story is implemented via kit:build-flow, and review feedback is processed via kit:receiving-review. **Requires the kit plugin on the same harness.** The harness plugin's own README covers installation and how it hooks the loop in; this guide is the same on both.

## Quickstart

1. **`stories:setup`** — one-time project onboarding. Writes the committed marker config `.agents/shousper-stories/config.json`, scaffolds `stories/`, appends the gitignore entries below, picks a merge mode, and defines verification gates (it detects your test runner and can wire browser-based visual gates).
2. **`stories:plan`** — turn a design or spec (often from kit:brainstorming) into epics and stories with dependencies, `touches` hints, gates, and mechanically verifiable acceptance criteria. You approve the set before anything is filed.
3. Say **"complete all stories"** — `stories:work` claims a ready story into its own worktree, implements it via kit:build-flow, runs its gates, integrates, and the loop feeds it the next story at each turn end until the goal is met.
4. **`stories:cancel`** — stop the loop any time; you get the board state and any parked questions.

Every board mutation goes through the bundled `story` CLI (`bin/story`, zero-dependency Node ≥ 22.7; every read supports `--json`). Agents are blocked from hand-editing `stories/**` by the harness plugin's tool-call guard; humans can hand-write story files freely — `story doctor` adopts them.

## Stories are evidence-gated

A story only reaches `done` when every **command gate** (for example `bun test`) has actually passed — executed by the CLI, recorded as evidence under `.agents/shousper-stories/local/evidence/` — and every **review gate** (for example a visual-reviewer persona) has a recorded verdict. The model's claim that work is finished is never sufficient.

## Modes: singleplayer & multiplayer

The `merge` field in `.agents/shousper-stories/config.json` picks the integration style:

| Mode | Who merges | Flow |
|---|---|---|
| `self` | The agent | Gates green → merge story branch to main → next story. Fully autonomous singleplayer. |
| `local` | You, locally | Gates green → story parks `in-review` with its worktree; you review and merge; the loop detects the landed branch and moves on. |
| `pr` | GitHub PRs (multiplayer) | Gates green → branch pushed, PR opened with AC + evidence summary. Review feedback becomes ready work items (processed via kit:receiving-review); merged PRs close stories; main drift is merged back into open PR branches and gates re-run. |

Run more workers by opening more terminals in the same repo — claiming is lock-safe, each story gets its own worktree under `.worktrees/`, and shared learnings cross-pollinate between workers. Loop state is per-session: `story loop start` binds to the calling session (the harness adapter supplies the id as `STORY_SESSION_ID`), so multiple workers genuinely run in parallel and each session's turn-end hook only ever re-prompts that same session.

**ONE-MACHINE ASSUMPTION: all agent workers must run on the same machine.** Coordination uses lockfiles under `.agents/shousper-stories/local/locks/`, which do not work across machines or network filesystems — a second machine (even in `pr` mode) can silently corrupt the board. Humans on other machines participate through story files and PRs, never by running workers.

## Budgets & runaway protection

- `budgets.maxStalls` (default 3): a run ends after this many consecutive turn ends with no board progress. A story claimed, closed, parked, or filed resets the counter, so a run that keeps landing stories never stops, while a run spinning on nothing does. `budgets.maxFixRoundsPerStory` (default 3) caps retry loops on a single story. Both live in `config.json`; `story loop start --max-stalls N` overrides the first for one run.
- While a loop is bound to a session, the guard denies that session's ask-the-user tool; a question for a human is a parked story (`story park`), which the end-of-run summary surfaces verbatim.
- `stories:cancel` is the escape hatch; the loop state is per-session, so closing the terminal also stops that worker.

## Files in your project

| Path | Committed? | What |
|---|---|---|
| `.agents/shousper-stories/config.json` | yes | Marker + config: merge mode, gates, defaults, budgets |
| `.agents/shousper-stories/personas/` | yes | Project-generated review personas (optional) |
| `stories/*.md` | yes | The board — one markdown file per story, content only (title, description, ACs, plan); execution state lives elsewhere |
| `stories/archive/` | yes | Done stories moved out of the active set (`story archive`) |
| `.agents/shousper-stories/local/state.json` | no | Execution-state store: status, claims, gate verdicts, evidence pointers per story |
| `.agents/shousper-stories/local/loop.<session>.md` | no | Per-session loop state — one file per worker session |
| `.agents/shousper-stories/local/learnings.md` | no | Shared learnings between parallel workers |
| `.agents/shousper-stories/local/sweep.json` | no | PR-sweep cursor state (`pr` mode only) |
| `.agents/shousper-stories/local/evidence/` | no | Gate-run evidence per story |
| `.agents/shousper-stories/local/locks/` | no | Lockfiles (board, merge, gate, sweep) |
| `.worktrees/` | no | One worktree per in-flight story |

`stories:setup` (like `story init`) appends the non-committed paths to `.gitignore`. This two-line block is canonical — byte-identical everywhere it is written (the `story init` command, the `stories:setup` skill, the plugin's eval fixtures, and here):

```
.worktrees/
.agents/shousper-stories/local/
```

Projects set up by stories 0.4 or earlier kept their state under `.claude/`: run `story doctor` once. It moves every file into `.agents/shousper-stories/`, rewrites the ignore block, and replaces the old `maxIterations` budget with `maxStalls`.

## Skills

| Skill | What it does |
|---|---|
| `stories:setup` | Onboard a project: config, scaffold, gates, merge mode, optional generated reviewer personas |
| `stories:plan` | Design/spec → approved epics + stories filed via `story create` |
| `stories:work` | The worker loop: claim → implement (kit:build-flow) → gates → integrate → repeat |
| `stories:cancel` | Stop the loop; report board state and parked questions |
| `stories:using-stories` | Session bootstrap injected at start: rules + live board snapshot |

## Turn-end loop and guard

The harness plugin wires three events to the CLI: session start injects the rules and a board snapshot (`story context`), every file-writing or ask-the-user tool call is checked (`story guard`), and every turn end asks whether the loop continues (`story loop tick`). In a project without the marker all three do nothing. How each event is bound, and how the execution-time planner and kit:build-flow are launched, is in the plugin's `skills/work/launch.md`.

## License

MIT
