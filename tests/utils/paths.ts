import { resolve } from "path";

export const ROOT = resolve(import.meta.dir, "../..");
export const KIT_ROOT = resolve(ROOT, "plugins/kit");
export const STORIES_ROOT = resolve(ROOT, "plugins/stories");
export const SKILLS_DIR = resolve(KIT_ROOT, "skills");
export const HOOKS_DIR = resolve(KIT_ROOT, "hooks");
export const AGENTS_DIR = resolve(KIT_ROOT, "agents");
export const PLUGIN_DIR = resolve(KIT_ROOT, ".claude-plugin");
export const MARKETPLACE_DIR = resolve(ROOT, ".claude-plugin");
