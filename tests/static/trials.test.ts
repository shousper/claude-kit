import { describe, it, expect } from "bun:test";
import { runTrials } from "../utils/trials";

describe("runTrials", () => {
  it("stops as soon as the required passes are reached", async () => {
    let runs = 0;
    const r = await runTrials({ trials: 3, requiredPasses: 2, run: async () => { runs++; return { pass: true }; } });
    expect(runs).toBe(2);
    expect(r.passed).toBe(true);
  });

  it("stops as soon as the outcome cannot be reached", async () => {
    let runs = 0;
    const r = await runTrials({ trials: 3, requiredPasses: 2, run: async () => { runs++; return { pass: false }; } });
    expect(runs).toBe(2); // 2 failures of 3 make 2 passes impossible
    expect(r.passed).toBe(false);
  });

  it("aborts the whole case when a trial is invalid", async () => {
    const r = await runTrials({ trials: 3, requiredPasses: 2, run: async () => ({ pass: false, invalid: true }) });
    expect(r.invalid).toBe(true);
  });
});
