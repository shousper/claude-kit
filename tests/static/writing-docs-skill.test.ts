import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { WRITING_SKILLS_DIR, WRITING_ROOT } from "../utils/paths";

const SKILL_DIR = resolve(WRITING_SKILLS_DIR, "writing-docs");
const SKILL = resolve(SKILL_DIR, "SKILL.md");
const REFERENCE = ["structure.md", "code.md", "api-comments.md", "words.md", "examples.md"];
const text = existsSync(SKILL) ? readFileSync(SKILL, "utf-8") : "";

function shippedFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "vale") shippedFiles(full, out); }
    else out.push(full);
  }
  return out;
}

describe("writing-docs skill", () => {
  it("has the trigger-style description and no other frontmatter keys", () => {
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
    expect(fm).toMatch(/^name: writing-docs$/m);
    expect(fm).toMatch(/^description: Use when creating or editing documentation/m);
    expect(fm.split("\n").filter((l) => /^\w+:/.test(l))).toHaveLength(2);
  });

  it("stays under 150 lines and names every reference file", () => {
    expect(text.split("\n").length).toBeLessThanOrEqual(150);
    for (const file of REFERENCE) expect(text, file).toContain(`reference/${file}`);
  });

  it("ships exactly the five reference files, each non-trivial and unwrapped", () => {
    const dir = resolve(SKILL_DIR, "reference");
    expect(readdirSync(dir).sort()).toEqual([...REFERENCE].sort());
    for (const file of REFERENCE) {
      const body = readFileSync(resolve(dir, file), "utf-8");
      expect(body.split("\n").length, file).toBeGreaterThanOrEqual(20);
      expect(body.split("\n").filter((l) => /^[a-z]/.test(l)), `${file} is hard-wrapped`).toEqual([]);
    }
  });

  it("excludes commit messages, pull request text, and replies from its scope", () => {
    expect(text).toMatch(/commit message/i);
    expect(text).toMatch(/pull request/i);
  });

  it("names the guide once in SKILL.md and nowhere else under shared/writing except style.md", () => {
    expect(text.match(/Google/g)?.length).toBe(1);
    const others = shippedFiles(WRITING_ROOT).filter((f) => !f.endsWith("/style.md") && f !== SKILL);
    for (const file of others) expect(readFileSync(file, "utf-8"), file).not.toContain("Google");
  });
});
