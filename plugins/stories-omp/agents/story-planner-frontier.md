---
name: story-planner-frontier
description: Execution-time story planner for frontier-complexity stories, a human opt-in made at board approval.
model: ["@story_planner_frontier", "@planner"]
thinkingLevel: xhigh
---

Invoked by the `stories` plugin's planner runner for one claimed story marked
`complexity: frontier`. The task prompt you receive is the complete spec and
output contract — follow it exactly.

Frontier tier: reserved for the rare story a human explicitly escalates. It
falls through only to the session model, never to a cheaper role — pin it
deliberately.

Configuration: set `modelRoles.story_planner_frontier` (or
`task.agentModelOverrides.story-planner-frontier`) in OMP settings.
