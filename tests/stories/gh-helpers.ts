import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG_DEFAULTS, archiveDir, loadConfig, loadStories } from "../../shared/stories/lib/board.mjs";
import { configPath, locksDir } from "../../shared/stories/lib/util.mjs";
import { makeTmpDir, storyLines } from "./helpers";

export type ExecResult = { code: number; stdout: string; stderr: string };
type RouteResult =
  | ExecResult
  | ((cmd: string, args: string[]) => ExecResult | Promise<ExecResult>);
export type Call = { cmd: string; args: string[]; opts: Record<string, unknown> };

export function ok(stdout = ""): ExecResult {
  return { code: 0, stdout, stderr: "" };
}

export function fail(code = 1, stderr = "boom"): ExecResult {
  return { code, stdout: "", stderr };
}

/**
 * Routes match against the full command line ("gh pr list --state all ...").
 * String routes are prefix matches; RegExp routes are tested. First hit wins.
 * Unmatched commands succeed with empty output (so incidental git plumbing
 * never fails a test that isn't about it).
 */
export function makeFakeExec(
  routes: Array<[string | RegExp, RouteResult]> = [],
) {
  const calls: Call[] = [];
  const exec = async (
    cmd: string,
    args: string[] = [],
    opts: Record<string, unknown> = {},
  ): Promise<ExecResult> => {
    calls.push({ cmd, args, opts });
    const line = [cmd, ...args].join(" ");
    for (const [pattern, result] of routes) {
      const hit =
        typeof pattern === "string" ? line.startsWith(pattern) : pattern.test(line);
      if (!hit) continue;
      return typeof result === "function" ? await result(cmd, args) : result;
    }
    return ok();
  };
  const lines = () => calls.map((c) => [c.cmd, ...c.args].join(" "));
  return { exec, calls, lines };
}

export async function makePrRepo(
  configOverrides: Record<string, unknown> = {},
): Promise<string> {
  const root = await makeTmpDir("stories-pr-");
  const config = {
    ...CONFIG_DEFAULTS,
    merge: "pr",
    gates: { test: { kind: "command", run: "true" } },
    defaults: { feature: ["test"], bug: ["test"], chore: ["test"] },
    ...configOverrides,
  };
  await fs.mkdir(locksDir(root), { recursive: true });
  await fs.mkdir(archiveDir(root, config), { recursive: true });
  await fs.writeFile(configPath(root), JSON.stringify(config, null, 2) + "\n");
  return root;
}

/** frontmatterLines are raw YAML lines and must include `id: st-xxxx`. */
export async function writeStory(
  root: string,
  frontmatterLines: string[],
  body = "## Description\nstub\n",
): Promise<string> {
  const idLine = frontmatterLines.find((l) => l.startsWith("id:"));
  if (!idLine) throw new Error("writeStory: frontmatter needs an id line");
  const id = idLine.slice("id:".length).trim();
  const content = ["---", ...frontmatterLines, "---", "", body].join("\n");
  await fs.writeFile(path.join(root, CONFIG_DEFAULTS.storiesDir, `${id}.md`), content + "\n");
  return id;
}

/**
 * Frontmatter lines for an in-review story with an open PR: title "A story",
 * status in-review, priority P2, and a `pr:` flow map for `prNumber`. Shared
 * by the sweep and effects suites, which both exercise the in-review+PR
 * shape.
 */
export function inReviewStoryLines(
  id: string,
  prNumber: number,
  extra: string[] = [],
): string[] {
  return storyLines(
    id,
    { title: "A story", status: "in-review", priority: "P2" },
    [`pr: {number: ${prNumber}, lastSync: 2026-07-08T12:00:00Z, syncAttempts: 0}`, ...extra],
  );
}

/** B's loadStories requires config — read it with cli.mjs's loadConfig. */
export async function loadStoryById(root: string, id: string) {
  const story = loadStories(root, loadConfig(root)).find((s: { id: string }) => s.id === id);
  if (!story) throw new Error(`story ${id} not found in ${root}`);
  return story;
}
