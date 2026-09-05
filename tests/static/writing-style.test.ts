import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { WRITING_ROOT } from "../utils/paths";

const STYLE_PATH = resolve(WRITING_ROOT, "style.md");
const EMPHATIC = /\b(MUST|NEVER|ALWAYS|CRITICAL|IMPORTANT|DO NOT)\b/;

describe("shared/writing/style.md", () => {
  const text = existsSync(STYLE_PATH) ? readFileSync(STYLE_PATH, "utf-8") : "";

  it("exists and starts with the H1, without frontmatter", () => {
    expect(text.startsWith("# Writing style\n")).toBe(true);
  });

  it("fits the always-on budget (about 500 tokens)", () => {
    expect(text.length).toBeLessThanOrEqual(3400);
  });

  it("names the guide exactly once", () => {
    expect(text.match(/Google/g)?.length).toBe(1);
  });

  it("uses no emphatic capitals", () => {
    expect(EMPHATIC.test(text)).toBe(false);
  });

  it("is not hard-wrapped (no line starts with a lowercase letter)", () => {
    const wrapped = text.split("\n").filter((line) => /^[a-z]/.test(line));
    expect(wrapped).toEqual([]);
  });

  it("ends with the tone reminder", () => {
    expect(text.trimEnd().endsWith("Keep replies concise and specific.")).toBe(true);
  });

  it("carries three Recommended / Not recommended pairs", () => {
    expect(text.match(/^Recommended: /gm)?.length).toBe(3);
    expect(text.match(/^Not recommended: /gm)?.length).toBe(3);
  });
});
