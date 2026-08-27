import { describe, it, expect } from "bun:test";
import { selectHarnesses, ALL_HARNESSES } from "../utils/harness";

describe("harness selection", () => {
  it("defaults to claude, the established baseline", () => {
    expect(selectHarnesses(undefined).map((h) => h.id)).toEqual(["claude"]);
  });

  it("honours an explicit list", () => {
    expect(selectHarnesses("claude,omp").map((h) => h.id)).toEqual(["claude", "omp"]);
  });

  it("rejects an unknown harness loudly rather than silently skipping", () => {
    expect(() => selectHarnesses("cursor")).toThrow(/unknown harness/i);
  });

  it("exposes exactly the two supported harnesses", () => {
    expect(ALL_HARNESSES.map((h) => h.id).sort()).toEqual(["claude", "omp"]);
  });
});
