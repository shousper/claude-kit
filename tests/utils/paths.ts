import { resolve } from "path";

export const ROOT = resolve(import.meta.dir, "../..");

// Skill/hook/agent/command/code-standards CONTENT is authored once and lives here; both
// harness plugins symlink into it rather than duplicating it.
export const SHARED_ROOT = resolve(ROOT, "shared");
export const SKILLS_DIR = resolve(SHARED_ROOT, "skills");
export const HOOKS_DIR = resolve(SHARED_ROOT, "hooks");
export const AGENTS_DIR = resolve(SHARED_ROOT, "agents");
export const COMMANDS_DIR = resolve(SHARED_ROOT, "commands");
export const CODE_STANDARDS_DIR = resolve(SHARED_ROOT, "code-standards");

// Per-harness plugin roots. Each is a real plugin directory (symlinks into shared/ plus
// its own harness-specific real files); tests validating PLUGIN STRUCTURE (manifests,
// symlink wiring, harness-only files) read from these, not from shared/.
export const KIT_CLAUDE_ROOT = resolve(ROOT, "plugins/kit-claude");
export const KIT_CLAUDE_HOOKS_DIR = resolve(KIT_CLAUDE_ROOT, "hooks");
export const KIT_OMP_ROOT = resolve(ROOT, "plugins/kit-omp");
export const STORIES_ROOT = resolve(ROOT, "plugins/stories");

export const MARKETPLACE_DIR = resolve(ROOT, ".claude-plugin");
export const OMP_MARKETPLACE_DIR = resolve(ROOT, ".omp-plugin");
