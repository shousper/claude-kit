import { describe, it, expect } from "bun:test";
import { resolve } from "path";
import { HOOKS_DIR } from "../utils/paths";

const LIB = resolve(HOOKS_DIR, "lib.sh");

// Drive the sourced lib via a tiny bash one-liner so we test real behavior.
// Base env excludes KIT_STATE_DIR/HOME so each case controls exactly which of
// the two are set, regardless of the ambient environment. shared/hooks/*.sh
// reads neither CLAUDE_CONFIG_DIR nor any other CLAUDE_* variable — the Claude
// wrapper is the only place that translates CLAUDE_CONFIG_DIR into KIT_STATE_DIR.
function baseEnv(): Record<string, string> {
  const { KIT_STATE_DIR, HOME, ...rest } = process.env as Record<string, string>;
  return rest;
}

async function sh(snippet: string, env: Record<string, string> = {}): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn(["bash", "-c", `. "${LIB}"; ${snippet}`], {
    stdout: "pipe", stderr: "pipe", env: { ...baseEnv(), ...env },
  });
  return { out: await new Response(proc.stdout).text(), code: await proc.exited };
}

describe("kit_state_dir", () => {
  it("resolves KIT_STATE_DIR when set", async () => {
    const r = await sh("kit_state_dir", { KIT_STATE_DIR: "/tmp/kit-state-only", HOME: "/tmp/home" });
    expect(r.out.trim()).toBe("/tmp/kit-state-only");
  });

  it("falls back to ~/.kit/state when KIT_STATE_DIR is unset", async () => {
    const r = await sh("kit_state_dir", { HOME: "/tmp/home" });
    expect(r.out.trim()).toBe("/tmp/home/.kit/state");
  });

  it("kit_scratch_file composes with the resolved KIT_STATE_DIR and KIT_SCRATCH_KEY", async () => {
    const r = await sh("kit_scratch_file", {
      KIT_STATE_DIR: "/tmp/kit-state-only",
      KIT_SCRATCH_KEY: "A",
      HOME: "/tmp/home",
    });
    expect(r.out.trim()).toBe("/tmp/kit-state-only/touched-A.txt");
  });

  it("kit_scratch_file composes with the ~/.kit/state default when KIT_STATE_DIR is unset", async () => {
    const r = await sh("kit_scratch_file", { KIT_SCRATCH_KEY: "A", HOME: "/tmp/home" });
    expect(r.out.trim()).toBe("/tmp/home/.kit/state/touched-A.txt");
  });

  it("kit_scratch_file fails loudly when KIT_SCRATCH_KEY is unset (no silent 'touched-.txt')", async () => {
    const r = await sh("kit_scratch_file", { KIT_STATE_DIR: "/tmp/kit-state-only", HOME: "/tmp/home" });
    expect(r.code).not.toBe(0);
  });
});
