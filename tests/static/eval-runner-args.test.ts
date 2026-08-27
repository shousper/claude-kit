import { describe, it, expect } from "bun:test";
import { buildCommand } from "../utils/eval-runner";
import { omp, claude } from "../utils/harness";

describe("eval runner command construction", () => {
  it("uses the harness binary and its own flags", () => {
    expect(buildCommand(omp, "hi", {})[0]).toBe(omp.bin);
    expect(buildCommand(omp, "hi", {})).toContain("--mode");
    expect(buildCommand(claude, "hi", {})).toContain("--output-format");
  });
});
