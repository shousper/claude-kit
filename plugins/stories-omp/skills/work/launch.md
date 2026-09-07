# Launching the story planner on OMP

The runner is `plan.workflow.mjs` in this skill's directory. Import it from one `eval` cell (`language: "js"`) and `await` its `run()`. The module binds the eval kernel's `agent`, `log`, and `phase` globals itself: pass it the args array and nothing else.

## Launch

1. Resolve the skill directory: in the `bash` tool run `echo skill://work`. It prints the real path (under OMP's plugin cache). Use that path as `SKILL_BASE` below; the `skill://` form does not work inside `import()`.
2. Write the args to `local://stories/plan-RUN_SLUG.json` with the `write` tool: a JSON array with one entry per claimed story.

   ```json
   [
     {
       "id": "st-XXXX",
       "complexity": "routine",
       "worktree": "/absolute/path/to/.worktrees/st-XXXX",
       "storyBody": "the full story body, pasted — the planner must not re-read the board"
     }
   ]
   ```

3. Run this cell with `eval`, `language: "js"`, `timeout: 0`:

   ```js
   const { run } = await import("SKILL_BASE/plan.workflow.mjs");
   return await run(JSON.parse(await read("local://stories/plan-RUN_SLUG.json")));
   ```

Replace the following:

- `SKILL_BASE`: the path printed in step 1.
- `RUN_SLUG`: a short name for this launch, such as the first story id.

The cell must `await run(...)`; a promise still pending when the cell returns is orphaned. Never pass a host object: `run()` takes one argument.

## Result delivery

Run `omp config get eval.autoBackground.enabled` in `bash` once per session. When it is `true`, a planning cell that outlasts the foreground window returns `Backgrounded as job JOB_ID`, your turn ends, and the result is delivered to you when the job settles — end your turn and wait for it; never poll. When it is `false`, the cell holds your turn until every planner returns. Either way `run()` resolves to `{ status, planned, unimplementable, failed }` directly; there is no envelope to unwrap. A planner that fails or exceeds 30 minutes is cancelled and lands in `failed` — park that story; there is no relaunch-with-cache on this harness.

## Complexity → agent

| Complexity | Agent | Falls through to |
|---|---|---|
| routine | story-planner-routine | `modelRoles.kit_worker`, then the session model |
| hard | story-planner-hard | `modelRoles.kit_arbiter`, then the session model |
| frontier | story-planner-frontier | the session model only |

Each agent resolves its model through a `modelRoles` alias (`story_planner_routine`, `story_planner_hard`, `story_planner_frontier`). Pin a concrete model with `modelRoles.<alias>: <provider/model>` in OMP settings, or override one agent via `task.agentModelOverrides.<agent-name>`. Nothing in this session chooses, retries, or substitutes a planner agent.

## kit:build-flow on this harness

build-flow runs from an `eval` cell too (see its own `launch.md` under `skill://build-flow`). With `eval.autoBackground.enabled` on, its result auto-delivers as a job when the run settles; off, the cell holds your turn until done. Either way, launch it, end your turn if the cell backgrounds, and never poll.

## Review personas

Dispatch each persona template (`references/personas/…`, or a project persona from `.agents/shousper-stories/personas/`) with the `task` tool, passing file paths, and record the single `VERDICT:` line it returns with `story record`.
