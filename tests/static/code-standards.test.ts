import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { ROOT } from "../utils/paths";

describe("HCL code standard", () => {
  it("code-standards/hcl/CLAUDE.md exists and is substantial", () => {
    const path = resolve(ROOT, "code-standards/hcl/CLAUDE.md");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8").length).toBeGreaterThan(1500);
  });

  it("covers the required sections", () => {
    const text = readFileSync(resolve(ROOT, "code-standards/hcl/CLAUDE.md"), "utf-8");
    for (const heading of ["File", "Naming", "Variables", "Outputs", "Resources", "Version", "Tooling"]) {
      expect(text).toContain(heading);
    }
  });

  it("does NOT leak lynx-devops bespoke patterns", () => {
    const text = readFileSync(resolve(ROOT, "code-standards/hcl/CLAUDE.md"), "utf-8").toLowerCase();
    expect(text).not.toContain("ident");        // bespoke ident map
    expect(text).not.toContain("configure module"); // bespoke multi-provider pattern
  });

  it("SKILL.md maps HCL extensions to the standard", () => {
    const text = readFileSync(resolve(ROOT, "skills/code-standards/SKILL.md"), "utf-8");
    expect(text).toContain("code-standards/hcl/CLAUDE.md");
    expect(text).toContain(".tofu");
  });

  it("SKILL.md frontmatter description mentions HCL so it triggers on HCL files", () => {
    const text = readFileSync(resolve(ROOT, "skills/code-standards/SKILL.md"), "utf-8");
    const frontmatter = text.split("---")[1] ?? "";
    const description = frontmatter.match(/description:\s*(.+)/)?.[1] ?? "";
    expect(/HCL|Terraform|OpenTofu/.test(description)).toBe(true);
  });

  it("session-start.sh names HCL in the code-standards instruction", () => {
    const text = readFileSync(resolve(ROOT, "hooks/session-start.sh"), "utf-8");
    expect(/HCL|Terraform|OpenTofu/.test(text)).toBe(true);
  });
});
