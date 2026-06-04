import { describe, it, expect } from "bun:test";
import { resolve } from "path";
import { HOOKS_DIR } from "../utils/paths";

const LIB = resolve(HOOKS_DIR, "lib.sh");

// Drive the sourced lib via a tiny bash one-liner so we test real behavior.
async function sh(snippet: string, env: Record<string, string> = {}): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn(["bash", "-c", `. "${LIB}"; ${snippet}`], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env },
  });
  return { out: await new Response(proc.stdout).text(), code: await proc.exited };
}

describe("lib.sh", () => {
  it("scratch key prefers agent_id over session_id", async () => {
    const r = await sh(`kit_scratch_key '{"agent_id":"A","session_id":"S"}'`);
    expect(r.out.trim()).toBe("A");
  });

  it("scratch key falls back to session_id", async () => {
    const r = await sh(`kit_scratch_key '{"session_id":"S"}'`);
    expect(r.out.trim()).toBe("S");
  });

  it("scratch file lives under CLAUDE_CONFIG_DIR/kit/state", async () => {
    const r = await sh(`kit_scratch_file '{"agent_id":"A"}'`, { CLAUDE_CONFIG_DIR: "/tmp/cfgX" });
    expect(r.out.trim()).toBe("/tmp/cfgX/kit/state/touched-A.txt");
  });

  it("kit_is_handled accepts source files and rejects others", async () => {
    for (const p of ["/x/a.go", "/x/a.rs", "/x/Cargo.toml", "/x/a.ts", "/x/a.tf", "/x/a.tofu", "/x/a.tfvars"]) {
      expect((await sh(`kit_is_handled "${p}" && echo Y || echo N`)).out.trim()).toBe("Y");
    }
    for (const p of ["/x/readme.md", "/x/a.py", "/x/other.toml"]) {
      expect((await sh(`kit_is_handled "${p}" && echo Y || echo N`)).out.trim()).toBe("N");
    }
  });

  it("kit_nearest_dir finds the marker up the tree", async () => {
    const r = await sh(`d=$(mktemp -d); mkdir -p "$d/a/b"; : > "$d/a/Cargo.toml"; kit_nearest_dir "$d/a/b" Cargo.toml; rm -rf "$d"`);
    expect(r.out.trim().endsWith("/a")).toBe(true);
  });
});
