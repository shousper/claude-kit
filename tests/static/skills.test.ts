import { describe, it, expect, beforeAll } from "bun:test";
import { readdirSync, existsSync } from "fs";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { parseSkill, type ParsedSkill } from "../utils/skill-parser";
import { SKILLS_DIR } from "../utils/paths";

const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
const skills: Record<string, ParsedSkill> = {};

beforeAll(async () => {
  await Promise.all(
    skillDirs.map(async (dir) => {
      skills[dir] = await parseSkill(resolve(SKILLS_DIR, dir, "SKILL.md"));
    }),
  );
});

describe("skill frontmatter", () => {
  it("every skill has non-empty name and description", () => {
    for (const dir of skillDirs) {
      const { frontmatter } = skills[dir];
      expect(frontmatter.name).toBeString();
      expect((frontmatter.name as string).length).toBeGreaterThan(0);
      expect(frontmatter.description).toBeString();
      expect((frontmatter.description as string).length).toBeGreaterThan(0);
    }
  });

  it("every skill name is kebab-case", () => {
    for (const dir of skillDirs) {
      const name = skills[dir].frontmatter.name as string;
      expect(name).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("every skill name matches its directory name", () => {
    for (const dir of skillDirs) {
      expect(skills[dir].frontmatter.name).toBe(dir);
    }
  });

  it("frontmatter contains at least name and description", () => {
    for (const dir of skillDirs) {
      const keys = Object.keys(skills[dir].frontmatter);
      expect(keys).toContain("name");
      expect(keys).toContain("description");
    }
  });

});

describe("skill structure", () => {
  it("every skill has exactly one H1 heading with non-empty text", () => {
    for (const dir of skillDirs) {
      const h1s = skills[dir].headings.filter((h) => h.depth === 1);
      expect(h1s.length).toBe(1);
      expect(h1s[0].text.trim().length).toBeGreaterThan(0);
    }
  });

  it("every skill has valid heading hierarchy (no skipped levels)", () => {
    for (const dir of skillDirs) {
      const { headings } = skills[dir];
      for (let i = 1; i < headings.length; i++) {
        const jump = headings[i].depth - headings[i - 1].depth;
        expect(jump).toBeLessThanOrEqual(1);
      }
    }
  });

});

describe("skill cross-references", () => {
  it("all kit: refs point to existing skills", () => {
    const allNames = new Set(skillDirs);
    for (const dir of skillDirs) {
      for (const ref of skills[dir].crossRefs) {
        expect(allNames.has(ref)).toBe(true);
      }
    }
  });
});

describe("skill companion files", () => {
  it("all referenced .md files exist on disk", async () => {
    for (const dir of skillDirs) {
      const skillDir = resolve(SKILLS_DIR, dir);
      const content = await readFile(resolve(skillDir, "SKILL.md"), "utf-8");
      // Strip fenced code blocks to avoid matching example references
      const stripped = content.replace(/```[\s\S]*?```/g, "");
      const refs = new Set<string>();
      // Match backtick-quoted local .md refs: `./file.md`, `file.md`, `subdir/file.md`
      for (const m of stripped.matchAll(/`(\.\/)?([a-z][\w./-]*\.md)`/g))
        refs.add(m[2]);
      // Match @file.md references (simple filenames only)
      for (const m of stripped.matchAll(/@([a-z][\w-]*\.md)\b/g))
        refs.add(m[1]);
      // Match plain-text "see file.md" style references (simple filenames only)
      for (const m of stripped.matchAll(/(?:see |See |\*\*)`?([a-z][\w-]*\.md)`?\*?\*?/g))
        refs.add(m[1]);
      // Normalize paths: strip skill dir prefix (e.g. `code-review/code-reviewer.md` -> `code-reviewer.md`)
      const normalized = new Set<string>();
      for (const ref of refs) {
        if (ref === "SKILL.md" || ref === "CLAUDE.md") continue;
        const stripped = ref.startsWith(`${dir}/`) ? ref.slice(dir.length + 1) : ref;
        // Skip cross-skill deep paths (still contain /)
        if (stripped.includes("/")) continue;
        normalized.add(stripped);
      }
      for (const ref of normalized) {
        expect(existsSync(resolve(skillDir, ref))).toBe(true);
      }
    }
  });
});
