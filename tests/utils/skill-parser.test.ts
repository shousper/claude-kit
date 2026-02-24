import { describe, it, expect } from "bun:test";
import { parseSkill, type ParsedSkill } from "./skill-parser";
import { resolve } from "path";
import { SKILLS_DIR } from "./paths";

describe("parseSkill", () => {
  it("parses frontmatter from a real skill", async () => {
    const skill = await parseSkill(resolve(SKILLS_DIR, "debugging/SKILL.md"));
    expect(skill.frontmatter.name).toBe("debugging");
    expect(skill.frontmatter.description).toStartWith("Use when");
  });

  it("extracts headings from markdown body", async () => {
    const skill = await parseSkill(resolve(SKILLS_DIR, "debugging/SKILL.md"));
    expect(skill.headings.length).toBeGreaterThan(0);
    expect(skill.headings[0]).toEqual({ depth: 1, text: expect.any(String) });
  });

  it("extracts kit: cross-references", async () => {
    const skill = await parseSkill(resolve(SKILLS_DIR, "brainstorming/SKILL.md"));
    expect(skill.crossRefs).toContain("writing-plans");
    expect(skill.crossRefs).toContain("git-worktrees");
  });

  it("extracts code blocks with language tags", async () => {
    const skill = await parseSkill(resolve(SKILLS_DIR, "brainstorming/SKILL.md"));
    expect(skill.codeBlocks.length).toBeGreaterThan(0);
  });

  it("returns directory name", async () => {
    const skill = await parseSkill(resolve(SKILLS_DIR, "tdd/SKILL.md"));
    expect(skill.dirName).toBe("tdd");
  });
});
