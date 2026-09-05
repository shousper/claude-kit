import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { ROOT } from "../utils/paths";
import { stylePrompts } from "../fixtures/style-prompts";
import { activationTests } from "../fixtures/prompts";

const WS = resolve(ROOT, "tests/fixtures/workspace-writing");

describe("style eval fixtures", () => {
  it("ships the writing workspace the prompts refer to", () => {
    for (const file of ["package.json", "README.md", "src/store.ts", "tests/store.test.ts", "changes.patch"]) {
      expect(existsSync(resolve(WS, file)), file).toBe(true);
    }
    expect(readFileSync(resolve(WS, "src/store.ts"), "utf-8")).not.toContain("/**");
    expect(readFileSync(resolve(WS, "README.md"), "utf-8")).not.toMatch(/getting started/i);
  });

  it("defines four prompts with unique ids, two of which grade a written file", () => {
    expect(stylePrompts).toHaveLength(4);
    expect(new Set(stylePrompts.map((p) => p.id)).size).toBe(4);
    expect(stylePrompts.filter((p) => p.outputFile).length).toBeGreaterThanOrEqual(2);
  });

  it("registers writing-docs activation cases under the writing namespace", () => {
    const cases = activationTests.filter((t) => t.skill === "writing:writing-docs");
    expect(cases.filter((t) => t.shouldActivate).length).toBeGreaterThanOrEqual(3);
    expect(cases.filter((t) => !t.shouldActivate).length).toBeGreaterThanOrEqual(2);
    expect(cases.every((t) => t.workspace === "writing" || !t.shouldActivate)).toBe(true);
  });
});
