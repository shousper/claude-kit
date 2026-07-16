import { KIT_ROOT, STORIES_ROOT } from "./paths";

const CLAUDE_BIN = process.env.CLAUDE_BIN || Bun.which("claude") || "claude";

/** Mirrors the timeout(1) convention: exit code 124 means the process was killed due to timeout. */
const TIMEOUT_EXIT_CODE = 124;

export interface EvalResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface EvalOptions {
  timeout?: number;
  /** One or more plugin dirs, each emitted as a repeated --plugin-dir flag. Pass `false` to skip --plugin-dir entirely. Defaults to both bundled plugins. */
  pluginDir?: string | string[] | false;
  outputFormat?: string;
  /** Model to use. Defaults to "sonnet" to keep eval costs low. */
  model?: string;
  maxTurns?: number;
  cwd?: string;
  env?: Record<string, string>;
  resume?: string;
  forkSession?: boolean;
  noSessionPersistence?: boolean;
  /** Appends --dangerously-skip-permissions. Eval-only; isolated temp workspaces are the sole sanctioned context. */
  dangerouslySkipPermissions?: boolean;
}

export async function runEval(
  prompt: string,
  options: EvalOptions = {},
): Promise<EvalResult> {
  const {
    timeout = 30_000,
    pluginDir = [KIT_ROOT, STORIES_ROOT],
    outputFormat = "stream-json",
    model = "sonnet",
    maxTurns,
    cwd,
    env,
    resume,
    forkSession,
    noSessionPersistence,
    dangerouslySkipPermissions,
  } = options;

  const args = [CLAUDE_BIN, "-p", "--verbose", "--output-format", outputFormat, "--model", model];
  for (const dir of pluginDir === false ? [] : [pluginDir].flat()) args.push("--plugin-dir", dir);
  if (maxTurns !== undefined) args.push("--max-turns", String(maxTurns));
  if (resume) args.push("--resume", resume);
  if (forkSession) args.push("--fork-session");
  if (noSessionPersistence) args.push("--no-session-persistence");
  if (dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");

  const spawnOptions: Parameters<typeof Bun.spawn>[1] = {
    stdin: new TextEncoder().encode(prompt),
    stdout: "pipe",
    stderr: "pipe",
  };

  if (cwd) spawnOptions.cwd = cwd;
  if (env) spawnOptions.env = env;

  const proc = Bun.spawn(args, spawnOptions);

  let timedOut = false;
  let sigkillTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
    sigkillTimer = setTimeout(() => proc.kill("SIGKILL"), 5_000);
  }, timeout);

  try {
    const exitCode = await proc.exited;

    // Read streams after exit to avoid hanging on inherited file descriptors.
    // Race against a 5s deadline so we never block indefinitely.
    const readWithTimeout = (stream: ReadableStream<Uint8Array> | null) =>
      Promise.race([
        stream ? new Response(stream).text() : Promise.resolve(""),
        new Promise<string>((r) => setTimeout(() => r(""), 5_000)),
      ]);
    const [stdout, stderr] = await Promise.all([
      readWithTimeout(proc.stdout),
      readWithTimeout(proc.stderr),
    ]);

    return {
      exitCode: timedOut ? TIMEOUT_EXIT_CODE : exitCode,
      stdout,
      stderr: timedOut ? stderr + "\n[eval-runner] process killed after timeout" : stderr,
    };
  } finally {
    clearTimeout(timer);
    if (sigkillTimer) clearTimeout(sigkillTimer);
  }
}
