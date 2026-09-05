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

describe("RunOptions.model", () => {
  it("overrides the harness default model on both adapters", () => {
    expect(claude.buildArgs("p", { model: "opus" })).toContain("opus");
    expect(omp.buildArgs("p", { model: "anthropic/claude-opus-5" })).toContain("anthropic/claude-opus-5");
  });

  it("falls back to the harness default when unset", () => {
    expect(claude.buildArgs("p", {})).toContain(claude.model);
    expect(omp.buildArgs("p", {})).toContain(omp.model);
  });
});
