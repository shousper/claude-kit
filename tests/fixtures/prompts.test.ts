import { describe, it, expect } from "bun:test";
import { activationTests } from "./prompts";

describe("activationTests", () => {
  it("flattens to ActivationTest[] with correct fields", () => {
    expect(activationTests.length).toBeGreaterThan(0);
    for (const test of activationTests) {
      expect(test).toHaveProperty("skill");
      expect(test).toHaveProperty("prompt");
      expect(test).toHaveProperty("shouldActivate");
      expect(typeof test.skill).toBe("string");
      expect(typeof test.prompt).toBe("string");
      expect(typeof test.shouldActivate).toBe("boolean");
    }
  });

  it("preserves session context on entries that have it", () => {
    const withSession = activationTests.filter((t) => t.sessionContext);
    expect(withSession.length).toBeGreaterThan(0);
    for (const test of withSession) {
      expect(["cold-start", "post-brainstorm", "mid-session"]).toContain(test.sessionContext);
    }
  });

  it("preserves workspace on entries that have it", () => {
    const withWorkspace = activationTests.filter((t) => t.workspace);
    expect(withWorkspace.length).toBeGreaterThan(0);
    for (const test of withWorkspace) {
      expect(["go", "rust", "tailwind"]).toContain(test.workspace);
    }
  });

  it("includes code-standards tests", () => {
    const codeStandards = activationTests.filter((t) => t.skill === "code-standards");
    expect(codeStandards.length).toBeGreaterThanOrEqual(6);

    const positive = codeStandards.filter((t) => t.shouldActivate);
    const negative = codeStandards.filter((t) => !t.shouldActivate);
    expect(positive.length).toBeGreaterThanOrEqual(3);
    expect(negative.length).toBeGreaterThanOrEqual(3);
  });

  it("has same number of tests as before plus code-standards", () => {
    // Original had 110 tests. We're adding 6 code-standards tests.
    expect(activationTests.length).toBe(110 + 6);
  });
});
