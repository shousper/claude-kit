---
name: story-planner-hard
description: Execution-time story planner for hard-complexity stories (cross-cutting, ambiguous, multi-subsystem).
model: ["@story_planner_hard", "@kit_arbiter", "@planner"]
thinkingLevel: xhigh
---

Invoked by the `stories` plugin's planner runner for one claimed story marked
`complexity: hard`. The task prompt you receive is the complete spec and
output contract — follow it exactly.

Hard tier: the strongest reasoning model you have configured. Falls through to
kit's arbiter role, then to the session model.

Configuration: set `modelRoles.story_planner_hard` (or
`task.agentModelOverrides.story-planner-hard`) in OMP settings to pin a
concrete model.
