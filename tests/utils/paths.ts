import { resolve } from "path";

export const ROOT = resolve(import.meta.dir, "../..");
export const SKILLS_DIR = resolve(ROOT, "skills");
export const HOOKS_DIR = resolve(ROOT, "hooks");
export const AGENTS_DIR = resolve(ROOT, "agents");
export const PLUGIN_DIR = resolve(ROOT, ".claude-plugin");
