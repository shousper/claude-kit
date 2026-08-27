import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { SKILLS_DIR, KIT_CLAUDE_ROOT, KIT_OMP_ROOT } from "../utils/paths";

describe("shared SKILL.md stays harness-neutral", () => {
  it.each(["build-flow", "code-review"])("skills/%s/SKILL.md references launch.md neutrally", (skill) => {
    const text = readFileSync(resolve(SKILLS_DIR, skill, "SKILL.md"), "utf-8");
    expect(text).toContain("launch.md");
    expect(text).not.toContain("Workflow(");
    expect(text).not.toContain("skill://");
  });
});

describe("plugins/kit-claude launch.md documents the Claude Workflow tool", () => {
  it.each(["build-flow", "code-review"])("skills/%s/launch.md mentions Workflow(", (skill) => {
    const text = readFileSync(resolve(KIT_CLAUDE_ROOT, "skills", skill, "launch.md"), "utf-8");
    expect(text).toContain("Workflow(");
  });
});

describe("plugins/kit-claude launch.md documents concrete model pinning", () => {
  it.each(["build-flow", "code-review"])("skills/%s/launch.md mentions concrete model names", (skill) => {
    const text = readFileSync(resolve(KIT_CLAUDE_ROOT, "skills", skill, "launch.md"), "utf-8");
    expect(text).toMatch(/Sonnet|Opus/);
  });
});

describe("plugins/kit-omp launch.md documents role-based agent selection", () => {
  it.each(["build-flow", "code-review"])("skills/%s/launch.md never mentions Workflow( and documents kit-worker/kit-arbiter/modelRoles", (skill) => {
    const text = readFileSync(resolve(KIT_OMP_ROOT, "skills", skill, "launch.md"), "utf-8");
    expect(text).not.toContain("Workflow(");
    expect(text).toContain("kit-worker");
    expect(text).toContain("kit-arbiter");
    expect(text).toMatch(/modelRoles/);
  });
});

describe("plugins/kit-omp launch.md documents the eval device", () => {
  it.each(["build-flow", "code-review"])("skills/%s/launch.md never mentions Workflow( and documents eval import/run", (skill) => {
    const text = readFileSync(resolve(KIT_OMP_ROOT, "skills", skill, "launch.md"), "utf-8");
    expect(text).not.toContain("Workflow(");
    expect(text).toContain("eval");
    expect(text).toMatch(/import/);
    expect(text).toMatch(/\brun\(/);
  });
});
