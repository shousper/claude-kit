import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { KIT_ROOT } from "../utils/paths";

describe("commands/hcl-tool.md", () => {
  const path = resolve(KIT_ROOT, "commands/hcl-tool.md");

  it("exists", () => {
    expect(existsSync(path)).toBe(true);
  });

  it("has YAML frontmatter with a description", () => {
    const text = readFileSync(path, "utf-8");
    expect(text.startsWith("---")).toBe(true);
    expect(/\ndescription:\s*\S+/.test(text)).toBe(true);
  });

  it("invokes the hcl-tool.sh command helper and references $ARGUMENTS", () => {
    const text = readFileSync(path, "utf-8");
    expect(text).toContain("hcl-tool.sh");
    expect(text).toContain("$ARGUMENTS");
  });
});
