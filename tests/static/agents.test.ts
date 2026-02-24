import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { basename, resolve } from "path";
import { extractFrontmatter } from "../utils/skill-parser";
import { AGENTS_DIR } from "../utils/paths";

const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));

const agents = agentFiles.map((file) => {
  const raw = readFileSync(resolve(AGENTS_DIR, file), "utf-8");
  const { frontmatter, body } = extractFrontmatter(raw);
  return { file, frontmatter, body };
});

describe("agent definitions", () => {
  it("can load all agent definitions", () => {
    expect(agents.length).toBeGreaterThan(0);
  });

  it("each agent has name and description in frontmatter", () => {
    for (const { file, frontmatter } of agents) {
      expect(typeof frontmatter.name, `${file}: name should be string`).toBe("string");
      expect((frontmatter.name as string).length, `${file}: name should not be empty`).toBeGreaterThan(0);
      expect(typeof frontmatter.description, `${file}: description should be string`).toBe("string");
      expect((frontmatter.description as string).length, `${file}: description should not be empty`).toBeGreaterThan(0);
    }
  });

  it("agent name matches filename", () => {
    for (const { file, frontmatter } of agents) {
      expect(frontmatter.name).toBe(basename(file, ".md"));
    }
  });

  it("each agent has non-empty markdown body", () => {
    for (const { file, body } of agents) {
      expect(body.trim().length).toBeGreaterThan(0);
    }
  });
});
