import type { ActivationTest } from "../fixtures/prompts";

/** One positive case per skill: proves the activation mechanism on a second harness
 *  without re-paying for description-quality coverage that is harness-independent. */
export function paritySubset(tests: ActivationTest[]): ActivationTest[] {
  const seen = new Set<string>();
  const out: ActivationTest[] = [];
  for (const t of tests) {
    if (!t.shouldActivate || seen.has(t.skill)) continue;
    seen.add(t.skill);
    out.push(t);
  }
  return out;
}

/** PR-tier smoke: the highest-signal skills only. */
const SMOKE_SKILLS = ["brainstorming", "build-flow", "tdd"];

export function smokeSubset(tests: ActivationTest[]): ActivationTest[] {
  return SMOKE_SKILLS.flatMap((s) => {
    const hit = tests.find((t) => t.skill === s && t.shouldActivate);
    return hit ? [hit] : [];
  });
}
