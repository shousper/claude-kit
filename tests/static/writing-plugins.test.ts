import { describe, it, expect } from "bun:test";
import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { parse as parseYaml } from "yaml";
import { ROOT, MARKETPLACE_DIR, OMP_MARKETPLACE_DIR, WRITING_ROOT, WRITING_SKILLS_DIR, WRITING_HOOKS_DIR, WRITING_CLAUDE_ROOT, WRITING_OMP_ROOT } from "../utils/paths";

const style = readFileSync(resolve(WRITING_ROOT, "style.md"), "utf-8");

function splitFrontmatter(path: string): { frontmatter: Record<string, unknown>; body: string } {
  const text = readFileSync(path, "utf-8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${relative(ROOT, path)} has no frontmatter`);
  return { frontmatter: parseYaml(m[1]) as Record<string, unknown>, body: text.slice(m[0].length) };
}

function walkFollowing(dir: string, visited = new Set<string>(), out: string[] = []): string[] {
  const real = realpathSync(dir);
  if (visited.has(real)) return out;
  visited.add(real);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    out.push(full);
    if (existsSync(full) && statSync(full).isDirectory()) walkFollowing(full, visited, out);
  }
  return out;
}

const OMP_TOKEN = /(^|[^a-z])omp([^a-z]|$)/i;
const HARNESS_PROTOCOL = /hookSpecificOutput|systemMessage|permissionDecision|stop_hook_active|tool_input|CLAUDE_/;

describe("plugins/writing-omp", () => {
  it("declares the plugin name writing and no Claude manifest", () => {
    const manifest = JSON.parse(readFileSync(resolve(WRITING_OMP_ROOT, ".omp-plugin/plugin.json"), "utf-8"));
    expect(manifest.name).toBe("writing");
    expect(existsSync(resolve(WRITING_OMP_ROOT, ".claude-plugin"))).toBe(false);
  });

  it("registers its extension through package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(WRITING_OMP_ROOT, "package.json"), "utf-8"));
    expect(pkg.private).toBe(true);
    expect(pkg.omp.extensions).toEqual(["./omp/index.ts"]);
    expect(existsSync(resolve(WRITING_OMP_ROOT, "omp/index.ts"))).toBe(true);
  });

  it("wraps the shared body as an always-apply rule", () => {
    const { frontmatter, body } = splitFrontmatter(resolve(WRITING_OMP_ROOT, "rules/writing-style.md"));
    expect(frontmatter.alwaysApply).toBe(true);
    expect(typeof frontmatter.description).toBe("string");
    expect(frontmatter.agents).toBeUndefined();
    expect(body).toBe(style);
  });

  it("links the shared skill and hook directory", () => {
    const skill = resolve(WRITING_OMP_ROOT, "skills/writing-docs");
    expect(lstatSync(skill).isSymbolicLink()).toBe(true);
    expect(realpathSync(skill)).toBe(realpathSync(resolve(WRITING_SKILLS_DIR, "writing-docs")));
    const hooks = resolve(WRITING_OMP_ROOT, "hooks");
    expect(lstatSync(hooks).isSymbolicLink()).toBe(true);
    expect(realpathSync(hooks)).toBe(realpathSync(WRITING_HOOKS_DIR));
  });

  it("carries no Claude protocol strings in its own files", () => {
    const own = walkFollowing(WRITING_OMP_ROOT).filter((p) => existsSync(p) && statSync(p).isFile() && !p.includes("/skills/"));
    const offending = own.filter((p) => HARNESS_PROTOCOL.test(readFileSync(p, "utf-8")));
    expect(offending).toEqual([]);
  });

  it("is listed in the OMP marketplace with the manifest's version", () => {
    const catalogue = JSON.parse(readFileSync(resolve(OMP_MARKETPLACE_DIR, "marketplace.json"), "utf-8"));
    const entry = catalogue.plugins.find((p: { name: string }) => p.name === "writing");
    expect(entry?.source).toBe("./plugins/writing-omp");
    const manifest = JSON.parse(readFileSync(resolve(WRITING_OMP_ROOT, ".omp-plugin/plugin.json"), "utf-8"));
    expect(entry?.version).toBe(manifest.version);
  });
});

describe("shared/writing/hooks", () => {
  it("scripts carry no harness protocol string", () => {
    const scripts = readdirSync(WRITING_HOOKS_DIR).filter((f) => f.endsWith(".sh"));
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter((f) => HARNESS_PROTOCOL.test(readFileSync(resolve(WRITING_HOOKS_DIR, f), "utf-8")))).toEqual([]);
  });
});

describe("plugins/writing-claude", () => {
  it("declares the plugin name writing and no OMP manifest", () => {
    const manifest = JSON.parse(readFileSync(resolve(WRITING_CLAUDE_ROOT, ".claude-plugin/plugin.json"), "utf-8"));
    expect(manifest.name).toBe("writing");
    expect(existsSync(resolve(WRITING_CLAUDE_ROOT, ".omp-plugin"))).toBe(false);
  });

  it("wraps the shared body as a forced, coding-preserving output style", () => {
    const { frontmatter, body } = splitFrontmatter(resolve(WRITING_CLAUDE_ROOT, "output-styles/writing-style.md"));
    expect(frontmatter.name).toBe("Writing");
    expect(frontmatter["keep-coding-instructions"]).toBe(true);
    expect(frontmatter["force-for-plugin"]).toBe(true);
    expect(typeof frontmatter.description).toBe("string");
    expect(body).toBe(style);
  });

  it("links the shared skill and hook script directory", () => {
    const skill = resolve(WRITING_CLAUDE_ROOT, "skills/writing-docs");
    expect(realpathSync(skill)).toBe(realpathSync(resolve(WRITING_SKILLS_DIR, "writing-docs")));
    const hooks = resolve(WRITING_CLAUDE_ROOT, "hooks");
    expect(lstatSync(hooks).isSymbolicLink()).toBe(false);
    expect(realpathSync(resolve(hooks, "shared"))).toBe(realpathSync(WRITING_HOOKS_DIR));
  });

  it("declares a PostToolUse hook on Write|Edit whose command exists", () => {
    const config = JSON.parse(readFileSync(resolve(WRITING_CLAUDE_ROOT, "hooks/hooks.json"), "utf-8"));
    expect(Object.keys(config.hooks)).toEqual(["PostToolUse"]);
    const [entry] = config.hooks.PostToolUse;
    expect(entry.matcher).toBe("Write|Edit");
    for (const hook of entry.hooks) {
      expect(hook.type).toBe("command");
      const script = hook.command.replace("${CLAUDE_PLUGIN_ROOT}", WRITING_CLAUDE_ROOT);
      expect(existsSync(script), script).toBe(true);
    }
  });

  it("contains no path matching omp, following symlinks", () => {
    const offending = walkFollowing(WRITING_CLAUDE_ROOT).map((p) => relative(WRITING_CLAUDE_ROOT, p)).filter((p) => OMP_TOKEN.test(p));
    expect(offending).toEqual([]);
  });

  it("is listed in the Claude marketplace with the manifest's version", () => {
    const catalogue = JSON.parse(readFileSync(resolve(MARKETPLACE_DIR, "marketplace.json"), "utf-8"));
    const entry = catalogue.plugins.find((p: { name: string }) => p.name === "writing");
    expect(entry?.source).toBe("./plugins/writing-claude");
    const manifest = JSON.parse(readFileSync(resolve(WRITING_CLAUDE_ROOT, ".claude-plugin/plugin.json"), "utf-8"));
    expect(entry?.version).toBe(manifest.version);
  });
});
