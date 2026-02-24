import { describe, it, expect } from "bun:test";
import { runEval } from "./eval-runner";

const RUN_EVALS = process.env.RUN_EVALS === "1";

describe.skipIf(!RUN_EVALS)("runEval", () => {
  it("returns structured output from claude -p", async () => {
    const result = await runEval("What is 2+2? Reply with just the number.");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("4");
  }, 60_000);
});
