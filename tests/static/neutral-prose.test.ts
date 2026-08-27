import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { SHARED_ROOT, SKILLS_DIR, KIT_OMP_ROOT } from "../utils/paths";

// shared/ content is symlinked, verbatim, into BOTH harness plugins (Claude Code, OMP),
// so it must never lean on one harness's tool names or launch mechanics. Each harness
// appends/provides its own vocabulary and launch doc outside shared/ instead (see
// shared/hooks/session-start.sh and plugins/<harness>/skills/*/launch.md).
const FORBIDDEN_TERMS = ["TodoWrite", "AskUserQuestion", "the Skill tool", "skill://", "Workflow(", "launch-claude", "launch-omp"];

/** Every regular file under `dir`, recursively. No exemptions — every file in shared/
 *  must stay harness-neutral. */
function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (statSync(full).isFile()) out.push(full);
  }
  return out;
}

const files = collectFiles(SHARED_ROOT);

describe("neutral prose across shared/", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const path of files) {
    const rel = relative(SHARED_ROOT, path);
    it(`shared/${rel} carries no harness-specific tool vocabulary or launch mechanics`, () => {
      const text = readFileSync(path, "utf-8");
      for (const term of FORBIDDEN_TERMS) {
        expect(text.includes(term), `shared/${rel} mentions "${term}"`).toBe(false);
      }
    });
  }
});

// The three shared SKILL.md files that used to hardcode Sonnet/Opus/Haiku as
// instructions now speak in tier language (worker/verifier/arbiter, or
// fast-cheap/standard/strongest); exact model ids are a per-platform fact that
// lives in each plugin's launch.md instead. Vendor names may still appear as
// parenthetical examples, e.g. "(e.g. Haiku-class)".
const TIER_LANGUAGE_SKILLS = ["build-flow", "code-review", "using-kit"];
const VENDOR_MODEL_PATTERNS = [/\|\s*Sonnet\b/, /\|\s*Opus\b/, /\bSonnet\s*→\s*Opus\b/, /\bon Opus\b/, /\bon Sonnet\b/];

describe("shared SKILL.md instruction tables carry no bare vendor model names", () => {
  for (const skill of TIER_LANGUAGE_SKILLS) {
    it(`skills/${skill}/SKILL.md has no Sonnet/Opus instructions outside (e.g. …) parentheticals`, () => {
      const text = readFileSync(resolve(SKILLS_DIR, skill, "SKILL.md"), "utf-8");
      const stripped = text.replace(/\(e\.g\.[^)]*\)/gi, "");
      for (const pattern of VENDOR_MODEL_PATTERNS) {
        expect(pattern.test(stripped), `skills/${skill}/SKILL.md matches ${pattern}`).toBe(false);
      }
    });
  }
});

describe("kit-omp agents carry no vendor model ids", () => {
  for (const name of ["kit-worker", "kit-verifier", "kit-arbiter"]) {
    it(`agents/${name}.md has no anthropic/ or claude references`, () => {
      const text = readFileSync(resolve(KIT_OMP_ROOT, "agents", `${name}.md`), "utf-8");
      expect(text).not.toMatch(/anthropic\//);
      expect(text.toLowerCase()).not.toContain("claude");
    });
  }
});
