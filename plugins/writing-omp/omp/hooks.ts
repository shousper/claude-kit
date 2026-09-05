import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { resolve } from "node:path";

/**
 * Native OMP hook: after a successful write/edit of a documentation file, run
 * the neutral shared/writing/hooks/vale-lint.sh (reached through this plugin's
 * hooks/ symlink) and append its summary, if any, to the tool result. The pure
 * pieces are unit-tested without an OMP runtime; `registerHooks` is the only
 * part that touches `ExtensionAPI`.
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

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type ExecFn = (command: string, args: string[]) => Promise<ExecResult>;

export function collectDocTarget(toolName: string, input: Record<string, unknown> | undefined | null): LintTarget | null {
  const mode = MODE_BY_TOOL[toolName];
  if (!mode) return null;
  const path = input?.path;
  if (typeof path !== "string" || path.length === 0) return null;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return DOC_EXTENSIONS[ext] ? { path, mode } : null;
}

export function buildLintCommand(pluginRoot: string, target: LintTarget): string[] {
  return [resolve(pluginRoot, "hooks/vale-lint.sh"), target.path, target.mode];
}

export function appendSummary(content: unknown[] | undefined, summary: string): unknown[] {
  return [...(content ?? []), { type: "text", text: summary }];
}

export function createToolResultHandler(pluginRoot: string, exec: ExecFn) {
  return async (event: ToolResultLike): Promise<{ content: unknown[] } | undefined> => {
    if (event.isError) return undefined;
    const target = collectDocTarget(event.toolName, event.input);
    if (!target) return undefined;
    try {
      const [command, ...args] = buildLintCommand(pluginRoot, target);
      const summary = (await exec(command, args)).stdout.trim();
      return summary ? { content: appendSummary(event.content, summary) } : undefined;
    } catch {
      return undefined; // A lint failure never affects the tool result.
    }
  };
}

async function execViaBunSpawn(command: string, args: string[]): Promise<ExecResult> {
  const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

export function registerHooks(pi: ExtensionAPI, pluginRoot: string): void {
  const handler = createToolResultHandler(pluginRoot, execViaBunSpawn);
  pi.on("tool_result", async (event) => handler(event as unknown as ToolResultLike));
}
