import { describe, it, expect, beforeAll } from "bun:test";
import { readdirSync, existsSync } from "fs";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { parseSkill, type ParsedSkill } from "../utils/skill-parser";
import { SKILLS_DIR, STORIES_ROOT, KIT_CLAUDE_ROOT, KIT_OMP_ROOT } from "../utils/paths";

const PLUGIN_SKILL_ROOTS: Record<string, string> = {
  kit: SKILLS_DIR,
  stories: resolve(STORIES_ROOT, "skills"),
};

interface Entry {
  ns: string;
  dir: string;
  path: string;
  key: string;
}

const entries: Entry[] = Object.entries(PLUGIN_SKILL_ROOTS)
  .filter(([, root]) => existsSync(root))
  .flatMap(([ns, root]) =>
    readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ ns, dir: e.name, path: resolve(root, e.name), key: `${ns}:${e.name}` })),
  );

const namesByNs: Record<string, Set<string>> = {};
for (const ns of Object.keys(PLUGIN_SKILL_ROOTS)) namesByNs[ns] = new Set();
for (const e of entries) namesByNs[e.ns].add(e.dir);

const skills: Record<string, ParsedSkill> = {};

beforeAll(async () => {
  await Promise.all(
    entries.map(async (e) => {
      skills[e.key] = await parseSkill(resolve(e.path, "SKILL.md"));
    }),
  );
});

describe("skill frontmatter", () => {
  it("every skill has non-empty name and description", () => {
    for (const e of entries) {
      const { frontmatter } = skills[e.key];
      expect(frontmatter.name).toBeString();
      expect((frontmatter.name as string).length).toBeGreaterThan(0);
      expect(frontmatter.description).toBeString();
      expect((frontmatter.description as string).length).toBeGreaterThan(0);
    }
  });

  it("every skill name is kebab-case", () => {
    for (const e of entries) {
      expect(skills[e.key].frontmatter.name as string).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("every skill name matches its directory name", () => {
    for (const e of entries) {
      expect(skills[e.key].frontmatter.name).toBe(e.dir);
    }
  });

  it("frontmatter contains at least name and description", () => {
    for (const e of entries) {
      const keys = Object.keys(skills[e.key].frontmatter);
      expect(keys).toContain("name");
      expect(keys).toContain("description");
    }
  });
});

describe("skill structure", () => {
  it("every skill has exactly one H1 heading with non-empty text", () => {
    for (const e of entries) {
      const h1s = skills[e.key].headings.filter((h) => h.depth === 1);
      expect(h1s.length, e.key).toBe(1);
      expect(h1s[0].text.trim().length).toBeGreaterThan(0);
    }
  });

  it("every skill has valid heading hierarchy (no skipped levels)", () => {
    for (const e of entries) {
      const { headings } = skills[e.key];
      for (let i = 1; i < headings.length; i++) {
        expect(headings[i].depth - headings[i - 1].depth, e.key).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("skill cross-references", () => {
  it("all namespaced refs resolve to an existing skill in the referenced plugin", () => {
    for (const e of entries) {
      for (const ref of skills[e.key].namespacedRefs) {
        expect(
          namesByNs[ref.ns]?.has(ref.name),
          `${e.key} references ${ref.ns}:${ref.name}`,
        ).toBe(true);
      }
    }
  });
});

describe("skill companion files", () => {
  it("all referenced .md files exist on disk", async () => {
    for (const e of entries) {
      const content = await readFile(resolve(e.path, "SKILL.md"), "utf-8");
      // Strip fenced code blocks to avoid matching example references
      const stripped = content.replace(/```[\s\S]*?```/g, "");
      const refs = new Set<string>();
      // Match backtick-quoted local .md refs: `./file.md`, `file.md`, `subdir/file.md`
      for (const m of stripped.matchAll(/`(\.\/)?([a-z][\w./-]*\.md)`/g)) refs.add(m[2]);
      // Match @file.md references (simple filenames only)
      for (const m of stripped.matchAll(/@([a-z][\w-]*\.md)\b/g)) refs.add(m[1]);
      // Match plain-text "see file.md" style references (simple filenames only)
      for (const m of stripped.matchAll(/(?:see |See |\*\*)`?([a-z][\w-]*\.md)`?\*?\*?/g)) refs.add(m[1]);
      // Normalize paths: strip skill dir prefix (e.g. `code-review/dispatch-template.md` -> `dispatch-template.md`)
      const normalized = new Set<string>();
      for (const ref of refs) {
        if (ref === "SKILL.md" || ref === "CLAUDE.md") continue;
        const local = ref.startsWith(`${e.dir}/`) ? ref.slice(e.dir.length + 1) : ref;
        // Skip cross-skill deep paths (still contain /)
        if (local.includes("/")) continue;
        normalized.add(local);
      }
      for (const ref of normalized) {
        if (ref === "launch.md" && e.ns === "kit") {
          expect(existsSync(resolve(KIT_CLAUDE_ROOT, "skills", e.dir, ref)), `${e.key} -> ${ref} (kit-claude)`).toBe(true);
          expect(existsSync(resolve(KIT_OMP_ROOT, "skills", e.dir, ref)), `${e.key} -> ${ref} (kit-omp)`).toBe(true);
          continue;
        }
        expect(existsSync(resolve(e.path, ref)), `${e.key} -> ${ref}`).toBe(true);
      }
    }
  });
});
