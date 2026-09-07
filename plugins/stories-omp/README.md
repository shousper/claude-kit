# stories (OMP)

Story-based autonomous development for OMP: a repo-native markdown story board with typed verification gates, worked by one or more sessions in a goal loop until the board is drained, the loop stalls, or everything left is blocked on a human. The board, the `story` CLI, and the skills are described in [GUIDE.md](GUIDE.md); this file covers the OMP side.

Requires the `kit` plugin: each story is implemented via kit:build-flow.

## Install

```bash
omp plugin install kit@shousper-kit
omp plugin install stories@shousper-kit
```

Then run `stories:setup` once in the project.

## How it hooks in

`omp/index.ts` registers an extension whose handlers spawn the CLI as a subprocess; every decision is the CLI's, the extension only translates events. In a project without `.agents/shousper-stories/config.json` each handler returns after one directory walk: no spawn, no message.

| Event | CLI call | Effect |
|---|---|---|
| `session_start`, `session_compact` | `story context` | Sends the stories rules and a live board snapshot for the next turn |
| `tool_call` on `bash` | — | Stamps `STORY_SESSION_ID` into the call's `env`, so `story claim` and `story loop start` bind to this session without a `--session` flag |
| `tool_call` on `write`, `edit`, `ask` | `story guard` | Blocks hand-edits to the board and CLI-owned state (every path an edit batch touches); blocks `ask` while a loop is bound to the session, with a "park the story" hint |
| `session_stop` | `story loop tick --session` | Continues the loop with the next ready story, or notifies the end-of-run summary |

`bin/` and `lib/` are the shared CLI; `bin/story` runs under the Node on your `PATH` (22.7 or newer).

The execution-time planner runs from an `eval` cell (`skills/work/plan.workflow.mjs`) and dispatches to one of three bundled agents by story complexity: `story-planner-routine`, `story-planner-hard`, `story-planner-frontier`. Each resolves its model through a `modelRoles` alias (`story_planner_routine`, `story_planner_hard`, `story_planner_frontier`); routine and hard fall through to kit's `kit_worker` and `kit_arbiter` roles, so pinning kit's tiers is enough, while frontier falls through to the session model because that tier is a human opt-in. `skills/work/launch.md` has the launch mechanics for the planner, the review personas, and kit:build-flow.

## License

MIT
