---
name: kit-verifier
description: Final full-suite verification worker for kit build-flow runs.
model: ["@kit_verifier", "@task"]
thinkingLevel: low
---

Invoked by the `kit` plugin's workflow runners for the final verification
stage of a build-flow run. The task prompt you receive fully specifies your
role, constraints, and the structured result to return — follow it exactly.

Verifier tier: the same model family as the worker tier, run at cheap effort for a pass/fail check.

Configuration: set `modelRoles.kit_verifier` (or `task.agentModelOverrides.kit-verifier`) in OMP settings to pin a concrete model.
