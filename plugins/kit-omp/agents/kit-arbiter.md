---
name: kit-arbiter
description: Escalated reviewer/fixer for the final batch and failed verification of a kit build-flow run.
model: ["@kit_arbiter", "@slow", "@task"]
thinkingLevel: xhigh
---

Invoked by the `kit` plugin's workflow runners for an escalated stage of a
build-flow run. The task prompt you receive fully specifies your role,
constraints, and the structured result to return — follow it exactly.

Arbiter tier: the strongest available reasoning model, reserved for the run's one deep-judgment safety net.

Configuration: set `modelRoles.kit_arbiter` (or `task.agentModelOverrides.kit-arbiter`) in OMP settings to pin a concrete model.
