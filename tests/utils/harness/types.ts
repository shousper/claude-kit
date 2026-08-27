export type NormalizedEvent =
  | { kind: "tool_call"; tool: string; input: Record<string, unknown>; id?: string }
  | { kind: "text"; text: string }
  | { kind: "fallback"; from: string; to: string }
  | { kind: "error"; message: string };

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  maxTurns?: number;
  pluginDirs?: string[];
  ephemeral?: boolean;
  /** Resume a prior session by id. Session fixtures (tests/fixtures/sessions) are Claude
   *  JSONL only, so this is only wired up on the claude harness; omp ignores it. */
  resume?: string;
  /** With `resume`, continue under a new session id instead of mutating the original. */
  forkSession?: boolean;
  /** Bypass permission prompts so headless runs that write/exec don't hang. */
  dangerouslySkipPermissions?: boolean;
}

export interface Harness {
  readonly id: "claude" | "omp";
  readonly bin: string;
  readonly model: string;
  /**
   * Wall-clock budget multiplier relative to Claude Code. Harnesses differ materially in
   * per-turn latency (bigger system prompt, more tools, default thinking level), so a
   * single timeout either kills the slower harness mid-run or wastes the faster one's
   * budget. Measured: omp ~2.2x claude on identical activation cases.
   */
  readonly timeoutScale: number;
  /**
   * The plugin directory THIS harness installs from. Each harness ships its own plugin
   * (plugins/kit-claude vs plugins/kit-omp): the two package real, harness-specific files
   * (e.g. launch-claude.md vs launch-omp.md, omp's package.json#omp.extensions bridge)
   * alongside symlinks into the shared skill/hook/agent content. Pointing a harness at the
   * other one's plugin dir would either silently no-op (Claude Code ignoring omp/) or load
   * files the harness can't use, so this must stay per-harness rather than a single shared
   * constant callers default to.
   */
  readonly pluginRoot: string;
  buildArgs(prompt: string, options: RunOptions): string[];
  parse(stdout: string): NormalizedEvent[];
  /** How this harness reveals that a skill was loaded. */
  skillActivationSignal(events: NormalizedEvent[], skill: string): boolean;
}

export function isToolCall(e: NormalizedEvent, tool: string): boolean {
  return e.kind === "tool_call" && e.tool === tool;
}
