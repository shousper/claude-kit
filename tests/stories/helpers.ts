import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const STORIES_LIB = resolve(import.meta.dir, "../../plugins/stories/lib");
export const STORY_BIN = resolve(import.meta.dir, "../../plugins/stories/bin/story");

export interface Repo {
  root: string;
  git: (...args: string[]) => string;
  cleanup: () => Promise<void>;
}

export const DEFAULT_CONFIG = {
  version: 1,
  storiesDir: "stories",
  merge: "self",
  baseBranch: "main",
  gates: {
    test: { kind: "command", run: "true" },
    visual: { kind: "review", capture: "true", persona: "visual-reviewer" },
  },
  defaults: { feature: ["test"], bug: ["test"], chore: [], ui: ["test", "visual"] },
  gateLock: true,
  budgets: { maxIterations: 10, maxFixRoundsPerStory: 3 },
};

/**
 * Fully isolated tmp git repo with the story-workflow marker config.
 * realpath() matters: macOS mkdtemp returns /var/... which is a symlink
 * to /private/var/... and git resolves the real path.
 */
export async function makeRepo(config: Record<string, unknown> = DEFAULT_CONFIG): Promise<Repo> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "story-repo-")));
  const git = (...args: string[]): string => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  };
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Story Tests");
  git("config", "commit.gpgsign", "false");
  await mkdir(join(root, ".claude"), { recursive: true });
  await writeFile(join(root, ".claude", "story-workflow.json"), JSON.stringify(config, null, 2));
  await mkdir(join(root, "stories", "archive"), { recursive: true });
  await writeFile(join(root, "stories", ".gitkeep"), "");
  // Canonical project-side ignore block (ratified) — keep byte-identical with
  // cmdInit (B10), the stories:setup skill (D2), the eval fixture (F3), README (F6).
  await writeFile(
    join(root, ".gitignore"),
    ".worktrees/\n.claude/*.local.*\n.claude/locks/\n.claude/story-evidence/\n",
  );
  await writeFile(join(root, "README.md"), "# fixture\n");
  git("add", "-A");
  git("commit", "-m", "init");
  return { root, git, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Raw story-file text from a frontmatter field map (values already serialized). */
export function storyText(fields: Record<string, string>, body = "\n## Description\n\nx\n"): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

export async function writeStoryFile(root: string, name: string, content: string): Promise<string> {
  const file = join(root, "stories", name);
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
  const { main } = await import(join(STORIES_LIB, "cli.mjs"));
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
