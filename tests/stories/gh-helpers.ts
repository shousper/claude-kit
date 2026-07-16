import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadStories } from "../../plugins/stories/lib/board.mjs";
import { loadConfig } from "../../plugins/stories/lib/cli.mjs";

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
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "stories-pr-")),
  );
  await fs.mkdir(path.join(root, ".claude", "locks"), { recursive: true });
  await fs.mkdir(path.join(root, "stories", "archive"), { recursive: true });
  const config = {
    version: 1,
    storiesDir: "stories",
    merge: "pr",
    baseBranch: "main",
    gates: { test: { kind: "command", run: "true" } },
    defaults: { feature: ["test"], bug: ["test"], chore: ["test"] },
    gateLock: true,
    budgets: { maxIterations: 10, maxFixRoundsPerStory: 3 },
    ...configOverrides,
  };
  await fs.writeFile(
    path.join(root, ".claude", "story-workflow.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
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
  await fs.writeFile(path.join(root, "stories", `${id}.md`), content + "\n");
  return id;
}

/** B's loadStories requires config — read it with cli.mjs's loadConfig. */
export async function loadStoryById(root: string, id: string) {
  const story = loadStories(root, loadConfig(root)).find(
    (s: { id: string }) => s.id === id,
  );
  if (!story) throw new Error(`story ${id} not found in ${root}`);
  return story;
}
