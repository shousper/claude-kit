---
name: story-planner-routine
description: Execution-time story planner for routine-complexity stories.
model: ["@story_planner_routine", "@kit_worker", "@task"]
thinkingLevel: high
---

Invoked by the `stories` plugin's planner runner for one claimed story. The
task prompt you receive is the complete spec and output contract — follow it
exactly: explore the story worktree, verify every file pointer, and return
either a plan with batches or an unimplementable question.

Routine tier: a capable general coding model. Falls through to kit's worker
role, then to the session model.

Configuration: set `modelRoles.story_planner_routine` (or
`task.agentModelOverrides.story-planner-routine`) in OMP settings to pin a
concrete model.
