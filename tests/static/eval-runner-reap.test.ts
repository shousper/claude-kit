import { describe, it, expect } from "bun:test";
import { runEval } from "../utils/eval-runner";
import type { Harness } from "../utils/harness/types";

const MARKER = `eval-runner-reap-${process.pid}-${Date.now()}`;

const leaky: Harness = {
  id: "claude",
  bin: "/bin/bash",
  model: "x",
  timeoutScale: 1,
  pluginRoot: "/tmp",
  buildArgs: () => ["-c", `yes '${MARKER}' >/dev/null & exec sleep 30`],
  parse: () => [],
  skillActivationSignal: () => false,
};

function leftoverYes(): string[] {
  const proc = Bun.spawnSync(["pgrep", "-f", `yes ${MARKER}`], { stdout: "pipe", stderr: "pipe" });
  return proc.stdout.toString().trim().split("\n").filter(Boolean);
}

describe("eval runner process teardown", () => {
  it("kills descendant yes processes when the harness is timed out", async () => {
    await runEval(leaky, "", { timeout: 400 });
    expect(leftoverYes()).toEqual([]);
  });
});
