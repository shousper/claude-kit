import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { extractFrontmatter, parseSkill } from "../utils/skill-parser";

// Helper: write a synthetic SKILL.md in a temp dir and parse it
const tmpBase = mkdtempSync(join(tmpdir(), "skill-parser-test-"));
let tmpCounter = 0;

function parseSynthetic(content: string) {
  const dir = resolve(tmpBase, `skill-${tmpCounter++}`);
  mkdirSync(dir, { recursive: true });
  const filePath = resolve(dir, "SKILL.md");
  writeFileSync(filePath, content);
  return parseSkill(filePath);
}

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

describe("extractFrontmatter", () => {
  it("parses valid frontmatter", () => {
    const { frontmatter, body } = extractFrontmatter(
      "---\nname: test\ndescription: A test\n---\n# Hello",
    );
    expect(frontmatter.name).toBe("test");
    expect(frontmatter.description).toBe("A test");
    expect(body).toBe("# Hello");
  });

  it("returns empty frontmatter when delimiters are missing", () => {
    const { frontmatter, body } = extractFrontmatter("# No frontmatter here");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# No frontmatter here");
  });

  it("returns empty frontmatter for single delimiter", () => {
    const { frontmatter, body } = extractFrontmatter("---\nname: test\n# Body");
    expect(frontmatter).toEqual({});
    expect(body).toBe("---\nname: test\n# Body");
  });

  it("handles empty YAML between delimiters", () => {
    const { frontmatter, body } = extractFrontmatter("---\n\n---\n# Body");
    expect(frontmatter).toBeNull();
    expect(body).toBe("# Body");
  });

  it("handles multiline description in YAML", () => {
    const content = [
      "---",
      "name: multi",
      "description: >",
      "  This is a long",
      "  description that spans",
      "  multiple lines",
      "---",
      "# Title",
    ].join("\n");
    const { frontmatter } = extractFrontmatter(content);
    expect(frontmatter.name).toBe("multi");
    expect(frontmatter.description).toContain("This is a long");
    expect(frontmatter.description).toContain("multiple lines");
  });

  it("preserves extra frontmatter keys", () => {
    const { frontmatter } = extractFrontmatter(
      "---\nname: test\ndescription: desc\ncustom: value\n---\n# Body",
    );
    expect(frontmatter.name).toBe("test");
    expect(frontmatter.custom).toBe("value");
  });
});

describe("parseSkill headings", () => {
  it("extracts headings at all depths", async () => {
    const skill = await parseSynthetic(
      "---\nname: test\ndescription: desc\n---\n# H1\n## H2\n### H3\n#### H4",
    );
    expect(skill.headings).toEqual([
      { depth: 1, text: "H1" },
      { depth: 2, text: "H2" },
      { depth: 3, text: "H3" },
      { depth: 4, text: "H4" },
    ]);
  });

  it("returns empty headings for body with no headings", async () => {
    const skill = await parseSynthetic(
      "---\nname: test\ndescription: desc\n---\nJust a paragraph.",
    );
    expect(skill.headings).toEqual([]);
  });
});

describe("parseSkill cross-references", () => {
  it("extracts kit: refs from prose", async () => {
    const skill = await parseSynthetic(
      "---\nname: test\ndescription: desc\n---\n# Title\nUse kit:debugging and kit:tdd for best results.",
    );
    expect(skill.crossRefs).toContain("debugging");
    expect(skill.crossRefs).toContain("tdd");
  });

  it("ignores kit: refs inside fenced code blocks", async () => {
    const content = [
      "---",
      "name: test",
      "description: desc",
      "---",
      "# Title",
      "Use kit:real-ref here.",
      "```yaml",
      "description: Use kit:fake-ref inside code",
      "```",
    ].join("\n");
    const skill = await parseSynthetic(content);
    expect(skill.crossRefs).toContain("real-ref");
    expect(skill.crossRefs).not.toContain("fake-ref");
  });

  it("deduplicates repeated refs", async () => {
    const skill = await parseSynthetic(
      "---\nname: test\ndescription: desc\n---\n# T\nkit:tdd and kit:tdd again",
    );
    expect(skill.crossRefs.filter((r) => r === "tdd").length).toBe(1);
  });

  it("filters out kit:name placeholder", async () => {
    const skill = await parseSynthetic(
      "---\nname: test\ndescription: desc\n---\n# T\nkit:name should be excluded",
    );
    expect(skill.crossRefs).not.toContain("name");
  });

  it("returns empty array when no refs exist", async () => {
    const skill = await parseSynthetic(
      "---\nname: test\ndescription: desc\n---\n# Title\nNo references here.",
    );
    expect(skill.crossRefs).toEqual([]);
  });
});

describe("parseSkill code blocks", () => {
  it("extracts code blocks with language tags", async () => {
    const content = [
      "---",
      "name: test",
      "description: desc",
      "---",
      "# Title",
      "```typescript",
      "const x = 1;",
      "```",
      "```bash",
      "echo hello",
      "```",
    ].join("\n");
    const skill = await parseSynthetic(content);
    expect(skill.codeBlocks).toEqual([
      { lang: "typescript", value: "const x = 1;" },
      { lang: "bash", value: "echo hello" },
    ]);
  });

  it("sets lang to null for untagged code blocks", async () => {
    const content = [
      "---",
      "name: test",
      "description: desc",
      "---",
      "# Title",
      "```",
      "plain code",
      "```",
    ].join("\n");
    const skill = await parseSynthetic(content);
    expect(skill.codeBlocks[0].lang).toBeNull();
    expect(skill.codeBlocks[0].value).toBe("plain code");
  });
});

describe("parseSkill metadata", () => {
  it("sets dirName from parent directory", async () => {
    const skill = await parseSynthetic(
      "---\nname: test\ndescription: desc\n---\n# Title",
    );
    expect(skill.dirName).toMatch(/^skill-\d+$/);
  });

  it("preserves raw content exactly", async () => {
    const content = "---\nname: test\ndescription: desc\n---\n# Title\nBody text.";
    const skill = await parseSynthetic(content);
    expect(skill.raw).toBe(content);
  });
});
