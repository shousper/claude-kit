import { describe, it, expect } from "bun:test";
import { paritySubset, smokeSubset } from "../utils/parity";
import { activationTests } from "../fixtures/prompts";

describe("cost-control subsets", () => {
  it("parity subset covers every skill exactly once", () => {
    const subset = paritySubset(activationTests);
    const skills = new Set(activationTests.map((t) => t.skill));
    expect(new Set(subset.map((t) => t.skill))).toEqual(skills);
    expect(subset).toHaveLength(skills.size);
  });

  it("parity subset uses only positive cases", () => {
    expect(paritySubset(activationTests).every((t) => t.shouldActivate)).toBe(true);
  });

  it("parity subset is far cheaper than the full matrix", () => {
    expect(paritySubset(activationTests).length).toBeLessThan(activationTests.length / 4);
  });

  it("smoke subset is tiny and deterministic", () => {
    const a = smokeSubset(activationTests), b = smokeSubset(activationTests);
    expect(a.length).toBeLessThanOrEqual(4);
    expect(a).toEqual(b);
  });
});
