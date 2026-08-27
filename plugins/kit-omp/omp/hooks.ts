import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Native OMP hook handlers. Replaces the deleted cross-harness protocol
 * bridge with `pi.on(...)` handlers that spawn the same neutral
 * `shared/hooks` scripts the sibling plugin's own hook wrappers call — no
 * stdin/JSON/exit-code translation protocol travels through this file or
 * the scripts it spawns. The extension process is persistent for the life
 * of the session, so edited-file tracking is an in-memory Set rather than
 * the scratch files cross-process hook wrappers need.
 *
 * The pure pieces below (path extraction, command construction, state-dir
 * resolution) take no OMP-shaped input and are unit-tested without an OMP
 * process. `createHandlers` builds the four testable handlers from injected
 * dependencies; `registerHooks` is the only part that touches `ExtensionAPI`.
 */

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

const STATE_DIR_ENV = "KIT_STATE_DIR";

/** Directory the shared scripts persist non-LLM state under. OMP has no
 *  preexisting per-user config-dir convention of its own, so this always
 *  computes an explicit value and hands it to spawned scripts via
 *  KIT_STATE_DIR — the one env var `shared/hooks/lib.sh` trusts outright,
 *  ahead of its own sibling-harness config-dir/HOME fallback chain. */
export function resolveStateDir(env: Record<string, string | undefined> = process.env): string {
  return env[STATE_DIR_ENV] || resolve(homedir(), ".omp", "kit", "state");
}

/** OMP tool names whose successful result means a file changed on disk.
 *  `edit` wire-renames itself to `apply_patch` in apply_patch mode; both
 *  names are tracked here so either mode is covered. */
const EDITED_FILE_TOOLS: Record<string, true> = { write: true, edit: true, apply_patch: true };

/** Extracts the file path a write/edit/apply_patch tool touched from its
 *  (normalized) tool-call/tool-result `input`, or null when the tool isn't
 *  one that edits a file or the event carries no usable `path`. Callers are
 *  responsible for skipping error results — this only looks at the shape of
 *  `input`. */
export function collectEditedPath(toolName: string, input: Record<string, unknown> | undefined | null): string | null {
  if (!EDITED_FILE_TOOLS[toolName]) return null;
  const path = input?.path;
  return typeof path === "string" && path.length > 0 ? path : null;
}

/** Builds the argv (script path followed by args) for the shared formatter
 *  script: the edited files, as positional arguments. */
export function buildFormatCommand(pluginRoot: string, files: readonly string[]): string[] {
  return [resolve(pluginRoot, "hooks/format-files.sh"), ...files];
}

// ---------------------------------------------------------------------------
// Handler factory — injected deps make this testable without an OMP runtime
// ---------------------------------------------------------------------------

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type ExecFn = (command: string, args: string[]) => Promise<ExecResult>;

export interface HookHandlerDeps {
  /** Runs a shared script and returns its stdout/stderr/exit code. */
  exec: ExecFn;
  /** Injects text as model-visible context on the next turn. */
  sendMessage: (text: string) => void;
  /** Surfaces a user-visible notification. Callers only invoke this when a
   *  UI actually exists for the firing session. */
  notify: (message: string) => void;
}

/** The slice of `ExtensionContext` these handlers read. Kept minimal and
 *  structural (not imported from the runtime package) so tests can pass a
 *  plain object instead of standing up a real OMP session. */
export interface MinimalHookContext {
  cwd?: string;
  hasUI?: boolean;
  sessionManager?: { getSessionId(): string };
}

export interface ToolResultLike {
  toolName: string;
  input?: Record<string, unknown>;
  isError?: boolean;
}

export interface HookHandlers {
  sessionStart(event: unknown, ctx?: MinimalHookContext): Promise<void>;
  toolResult(event: ToolResultLike, ctx?: MinimalHookContext): Promise<void>;
  sessionStop(event: unknown, ctx?: MinimalHookContext): Promise<void>;
  agentEnd(event: unknown, ctx?: MinimalHookContext): Promise<void>;
}

/**
 * Builds the four `pi.on(...)` handlers, backed by an in-memory Set of
 * edited files per session. `editedFilesBySession` may be shared across
 * repeated calls (the real wiring rebuilds deps per event to bind the
 * firing `ctx`, but state must survive that) — it defaults to a private Map
 * when a caller (e.g. a test) has no reason to share one.
 */
export function createHandlers(
  pluginRoot: string,
  deps: HookHandlerDeps,
  editedFilesBySession: Map<string, Set<string>> = new Map(),
): HookHandlers {
  const filesFor = (sessionKey: string): Set<string> => {
    let files = editedFilesBySession.get(sessionKey);
    if (!files) {
      files = new Set();
      editedFilesBySession.set(sessionKey, files);
    }
    return files;
  };

  const flushFormat = async (sessionKey: string): Promise<void> => {
    const files = editedFilesBySession.get(sessionKey);
    if (!files || files.size === 0) return;
    const toFormat = [...files];
    files.clear();
    try {
      const [command, ...args] = buildFormatCommand(pluginRoot, toFormat);
      const result = await deps.exec(command, args);
      const summary = result.stdout.trim();
      if (summary) deps.notify(summary);
    } catch {
      // A formatting failure must never affect the session.
    }
  };

  return {
    async sessionStart(_event, ctx) {
      try {
        const scriptPath = resolve(pluginRoot, "hooks/session-context.sh");
        const result = await deps.exec(scriptPath, [ctx?.cwd ?? process.cwd()]);
        const context = result.stdout.trim();
        if (context) deps.sendMessage(context);
      } catch {
        // Never block session start on a context-injection failure.
      }
    },

    async toolResult(event, ctx) {
      if (event.isError) return;
      const path = collectEditedPath(event.toolName, event.input);
      if (!path) return;
      filesFor(ctx?.sessionManager?.getSessionId() ?? "default").add(path);
    },

    async sessionStop(_event, ctx) {
      await flushFormat(ctx?.sessionManager?.getSessionId() ?? "default");
    },

    async agentEnd(_event, ctx) {
      await flushFormat(ctx?.sessionManager?.getSessionId() ?? "default");
    },
  };
}

// ---------------------------------------------------------------------------
// OMP runtime wiring
// ---------------------------------------------------------------------------

async function execViaBunSpawn(command: string, args: string[], env: Record<string, string>): Promise<ExecResult> {
  const proc = Bun.spawn([command, ...args], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

/**
 * Wraps whichever exec primitive the runtime offers so spawned scripts
 * always see KIT_PLUGIN_ROOT/KIT_STATE_DIR. `ExtensionAPI.exec`'s options
 * carry no `env` field and it never goes through a shell, so when running
 * through it the vars are passed via the POSIX `env` utility instead.
 */
function buildExec(pi: ExtensionAPI, env: Record<string, string>): ExecFn {
  if (typeof pi.exec !== "function") {
    return (command, args) => execViaBunSpawn(command, args, env);
  }
  const assignments = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  return (command, args) => pi.exec("env", [...assignments, command, ...args]);
}

/**
 * Registers the native OMP handlers that replace the old cross-harness
 * protocol bridge. Reaches `shared/hooks` scripts through this plugin's
 * `hooks/` symlink (kept in place so the sibling plugin's own protocol
 * wrappers consume the same logic — this is the single deliberate seam
 * between the two plugins).
 */
export function registerHooks(pi: ExtensionAPI, pluginRoot: string): void {
  const editedFilesBySession = new Map<string, Set<string>>();
  const scriptEnv = { KIT_PLUGIN_ROOT: pluginRoot, KIT_STATE_DIR: resolveStateDir(process.env) };

  const handlersFor = (ctx: ExtensionContext): HookHandlers =>
    createHandlers(
      pluginRoot,
      {
        exec: buildExec(pi, scriptEnv),
        sendMessage: (text) => pi.sendMessage(text, { deliverAs: "nextTurn" }),
        notify: (message) => {
          if (ctx.hasUI) ctx.ui.notify(message, "info");
        },
      },
      editedFilesBySession,
    );

  pi.on("session_start", async (event, ctx) => {
    await handlersFor(ctx).sessionStart(event, ctx);
  });
  pi.on("tool_result", async (event, ctx) => {
    await handlersFor(ctx).toolResult(event, ctx);
  });
  pi.on("session_stop", async (event, ctx) => {
    await handlersFor(ctx).sessionStop(event, ctx);
  });
  pi.on("agent_end", async (event, ctx) => {
    await handlersFor(ctx).agentEnd(event, ctx);
  });
}
