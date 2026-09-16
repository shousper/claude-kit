import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { isAbsolute, resolve } from "node:path";

/**
 * Native OMP hook: after a successful write/edit of a documentation file, run
 * the neutral shared/writing/hooks/vale-lint.sh (reached through this plugin's
 * hooks/ symlink) and append its summary, if any, to the tool result. The pure
 * pieces are unit-tested without an OMP runtime; `registerHooks` is the only
 * part that touches `ExtensionAPI`.
 *
 * Paths arrive relative to the session's working directory, which is not the
 * OMP process's cwd when the session runs in a worktree or after `/move`. Every
 * path is resolved against `ctx.cwd` and the script runs there, so its
 * existence check and edit-mode `git diff` see the session's checkout.
 */

/** `edit` wire-renames itself to `apply_patch` in apply_patch mode. */
const MODE_BY_TOOL: Record<string, "write" | "edit"> = { write: "write", edit: "edit", apply_patch: "edit" };
const DOC_EXTENSIONS: Record<string, true> = { md: true, mdx: true, rst: true, adoc: true, txt: true, html: true };

export interface LintTarget {
  path: string;
  mode: "write" | "edit";
}

export interface ToolResultLike {
  toolName: string;
  input?: Record<string, unknown> | null;
  isError?: boolean;
  content?: unknown[];
}

export interface MinimalHookContext {
  cwd?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOpts {
  cwd: string;
}

export type ExecFn = (command: string, args: string[], opts: ExecOpts) => Promise<ExecResult>;

/** The runtime derives `path` (one file) or `paths` (a multi-file hashline
 *  batch) from the edit payload; a write carries `path` itself. Both are read
 *  and each documentation file becomes its own lint target, resolved against
 *  `cwd`. */
export function collectDocTargets(toolName: string, input: Record<string, unknown> | undefined | null, cwd: string): LintTarget[] {
  const mode = MODE_BY_TOOL[toolName];
  if (!mode) return [];
  const raw: unknown[] = [];
  if (typeof input?.path === "string") raw.push(input.path);
  if (Array.isArray(input?.paths)) raw.push(...input.paths);
  const targets: LintTarget[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    if (typeof p !== "string" || p.length === 0) continue;
    const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
    if (!DOC_EXTENSIONS[ext]) continue;
    const path = isAbsolute(p) ? p : resolve(cwd, p);
    if (seen.has(path)) continue;
    seen.add(path);
    targets.push({ path, mode });
  }
  return targets;
}

export function buildLintCommand(pluginRoot: string, target: LintTarget): string[] {
  return [resolve(pluginRoot, "hooks/vale-lint.sh"), target.path, target.mode];
}

export function appendSummary(content: unknown[] | undefined, summary: string): unknown[] {
  return [...(content ?? []), { type: "text", text: summary }];
}

export function createToolResultHandler(pluginRoot: string, exec: ExecFn) {
  return async (event: ToolResultLike, ctx?: MinimalHookContext): Promise<{ content: unknown[] } | undefined> => {
    if (event.isError) return undefined;
    const cwd = ctx?.cwd ?? process.cwd();
    const targets = collectDocTargets(event.toolName, event.input, cwd);
    if (targets.length === 0) return undefined;
    try {
      const summaries: string[] = [];
      for (const target of targets) {
        const [command, ...args] = buildLintCommand(pluginRoot, target);
        const summary = (await exec(command, args, { cwd })).stdout.trim();
        if (summary) summaries.push(summary);
      }
      return summaries.length > 0 ? { content: appendSummary(event.content, summaries.join("\n")) } : undefined;
    } catch {
      return undefined; // A lint failure never affects the tool result.
    }
  };
}

async function execViaBunSpawn(command: string, args: string[], opts: ExecOpts): Promise<ExecResult> {
  const proc = Bun.spawn([command, ...args], { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

export function registerHooks(pi: ExtensionAPI, pluginRoot: string): void {
  const handler = createToolResultHandler(pluginRoot, execViaBunSpawn);
  pi.on("tool_result", async (event, ctx) => handler(event as unknown as ToolResultLike, ctx as unknown as MinimalHookContext));
}
