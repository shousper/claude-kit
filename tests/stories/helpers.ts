import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CONFIG_DEFAULTS, archiveDir, storiesDir } from "../../shared/stories/lib/board.mjs";
import { GITIGNORE_BLOCK, configPath, localDir } from "../../shared/stories/lib/util.mjs";
import { STORIES_CLAUDE_ROOT, STORIES_LIB_DIR } from "../utils/paths";

/** The Claude plugin's bash shim: the entry the hooks and skills exec on that harness. */
export const STORY_BIN = resolve(STORIES_CLAUDE_ROOT, "bin/story");

export interface Repo {
  root: string;
  git: (...args: string[]) => string;
  cleanup: () => Promise<void>;
}

export const DEFAULT_CONFIG = {
  ...CONFIG_DEFAULTS,
  gates: {
    test: { kind: "command", run: "true" },
    visual: { kind: "review", capture: "true", persona: "visual-reviewer" },
  },
  defaults: { feature: ["test"], bug: ["test"], chore: [], ui: ["test", "visual"] },
};

/**
 * Fresh tmp directory under the OS tmpdir, realpath()'d. macOS mkdtemp returns
 * /var/... which is a symlink to /private/var/... and git resolves the real
 * path, so every fixture that shells out to git needs the resolved form.
 */
export async function makeTmpDir(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

/**
 * Fully isolated tmp git repo with the story-workflow marker config.
 */
export async function makeRepo(config: Record<string, unknown> = DEFAULT_CONFIG): Promise<Repo> {
  const root = await makeTmpDir("story-repo-");
  const git = (...args: string[]): string => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  };
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Story Tests");
  git("config", "commit.gpgsign", "false");
  await mkdir(localDir(root), { recursive: true });
  await writeFile(configPath(root), JSON.stringify(config, null, 2));
  await mkdir(archiveDir(root, config), { recursive: true });
  await writeFile(join(storiesDir(root, config), ".gitkeep"), "");
  // Canonical project-side ignore block (ratified) — keep byte-identical with
  // cmdInit, the stories:setup skill, the eval fixture, and the README.
  await writeFile(join(root, ".gitignore"), GITIGNORE_BLOCK);
  await writeFile(join(root, "README.md"), "# fixture\n");
  git("add", "-A");
  git("commit", "-m", "init");
  return { root, git, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** The standard frontmatter fields, in FIELD_ORDER-compatible order, before per-call overrides. */
const STORY_FIELD_DEFAULTS: Record<string, string> = {
  id: "st-0000",
  title: "A story",
  type: "feature",
  status: "todo",
  priority: "P2",
  created: "2026-07-08",
  updated: "2026-07-08",
};

/**
 * Standard frontmatter lines for `id`, with `overrides` applied on top of
 * STORY_FIELD_DEFAULTS, followed by verbatim `extra` lines (flow-map fields
 * like `pr:`/`claim:`, or anything else outside the standard set).
 */
export function storyLines(
  id: string,
  overrides: Partial<Record<string, string>> = {},
  extra: string[] = [],
): string[] {
  const fields = { ...STORY_FIELD_DEFAULTS, ...overrides, id };
  return [
    ...Object.keys(STORY_FIELD_DEFAULTS).map((key) => `${key}: ${fields[key]}`),
    ...extra,
  ];
}

/** Wrap frontmatter `lines` and `body` into a full story document. */
export function storyDoc(lines: string[], body = "\n## Description\n"): string {
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

/** Raw story-file text from a frontmatter field map (values already serialized). */
export function storyText(fields: Record<string, string>, body = "\n## Description\n\nx\n"): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return storyDoc(lines, body);
}

export async function writeStoryFile(root: string, name: string, content: string): Promise<string> {
  const file = join(storiesDir(root, DEFAULT_CONFIG), name);
  await writeFile(file, content);
  return file;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  json: () => unknown;
}

/** Invoke the CLI's main() in-process with captured stdio. */
export async function runStory(
  root: string,
  args: string[],
  opts: { env?: Record<string, string>; exec?: unknown } = {},
): Promise<CliResult> {
  const { main } = await import(join(STORIES_LIB_DIR, "cli.mjs"));
  let out = "";
  let err = "";
  const code = await main(args, {
    cwd: root,
    env: opts.env ?? {},
    ...(opts.exec ? { exec: opts.exec } : {}),
    stdout: { write: (s: string) => ((out += s), true) },
    stderr: { write: (s: string) => ((err += s), true) },
  });
  return { code, stdout: out, stderr: err, json: () => JSON.parse(out) };
}
