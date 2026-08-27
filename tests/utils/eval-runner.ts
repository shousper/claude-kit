import type { Harness, NormalizedEvent, RunOptions } from "./harness/types";

/** Mirrors the timeout(1) convention: exit code 124 means the process was killed due to timeout. */
const TIMEOUT_EXIT_CODE = 124;

export interface EvalResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  events: NormalizedEvent[];
}

export type EvalOptions = RunOptions;

/** Builds the full argv (binary + flags) for a harness run via its own adapter. */
export function buildCommand(harness: Harness, prompt: string, options: EvalOptions): string[] {
  return [harness.bin, ...harness.buildArgs(prompt, options)];
}

export async function runEval(
  harness: Harness,
  prompt: string,
  options: EvalOptions = {},
): Promise<EvalResult> {
  const { cwd, env } = options;
  // Scale the kill deadline per harness: a single wall-clock budget either kills the
  // slower harness mid-run (exit 124 misread as a failed assertion) or wastes the
  // faster one's budget.
  const timeout = (options.timeout ?? 30_000) * harness.timeoutScale;

  const [bin, ...args] = buildCommand(harness, prompt, options);

  const spawnOptions: Parameters<typeof Bun.spawn>[1] = {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  };

  if (cwd) spawnOptions.cwd = cwd;
  if (env) spawnOptions.env = env;

  const proc = Bun.spawn([bin, ...args], spawnOptions);

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
      events: harness.parse(stdout),
    };
  } finally {
    clearTimeout(timer);
    if (sigkillTimer) clearTimeout(sigkillTimer);
  }
}
