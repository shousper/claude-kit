import { describe, it, expect, afterAll } from "bun:test";
import { mkdtemp, writeFile, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getHclWorkspace, runHook, cleanupHookWorkspace } from "../utils/hook-workspace";
import { HOOKS_DIR } from "../utils/paths";

afterAll(async () => { await cleanupHookWorkspace(); });

// Isolated state dir per test so the cache file never leaks between cases.
async function freshCfg(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kit-cfg-"));
}

// hcl-tool.sh is neutral (shared/hooks/hcl-tool.sh) — not a kit-claude wrapper.
function tool(ws: { dir: string }, sub: string, extraArgs: string[] = [], env: Record<string,string> = {}) {
  return runHook("hcl-tool.sh", { tool_name: "", tool_input: {}, cwd: ws.dir, args: [sub, ...extraArgs], env, dir: HOOKS_DIR });
}

describe("hcl-tool.sh detect", () => {
  it("detects tofu from a tracked .tofu file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hcl-tofu-"));
    const git = (a: string[]) => Bun.spawn(["git", ...a], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
    await git(["init"]); await git(["config","user.email","t@t"]); await git(["config","user.name","t"]);
    await writeFile(join(dir, "main.tofu"), "\n");
    await git(["add","."]); await git(["commit","-m","x"]);
    const r = await runHook("hcl-tool.sh", { tool_name:"", tool_input:{}, cwd: dir, args:["detect", dir], dir: HOOKS_DIR });
    expect(r.stdout.trim()).toBe("tofu");
    await rm(dir, { recursive: true, force: true });
  });

  it("detects terraform from .terraform-version pin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hcl-pin-"));
    await writeFile(join(dir, ".terraform-version"), "1.9.0\n");
    const r = await runHook("hcl-tool.sh", { tool_name:"", tool_input:{}, cwd: dir, args:["detect", dir], dir: HOOKS_DIR });
    expect(r.stdout.trim()).toBe("terraform");
    await rm(dir, { recursive: true, force: true });
  });

  it("falls back to tofu when no signals and no exclusive PATH", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hcl-none-"));
    // Empty PATH bin so neither tofu nor terraform is found.
    const bin = await mkdtemp(join(tmpdir(), "emptybin-"));
    const r = await runHook("hcl-tool.sh", { tool_name:"", tool_input:{}, cwd: dir, args:["detect", dir], env: { PATH: bin }, dir: HOOKS_DIR });
    expect(r.stdout.trim()).toBe("tofu");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("hcl-tool.sh get/set/resolve cache", () => {
  it("resolve writes the cache and get reads it back", async () => {
    const ws = await getHclWorkspace();
    const cfg = await freshCfg();
    const env = { KIT_STATE_DIR: join(cfg, "kit/state") };
    const before = await tool(ws, "get", [ws.dir], env);
    expect(before.stdout.trim()).toBe("");
    const resolved = await tool(ws, "resolve", [ws.dir], env);
    expect(["tofu","terraform"]).toContain(resolved.stdout.trim());
    const after = await tool(ws, "get", [ws.dir], env);
    expect(after.stdout.trim()).toBe(resolved.stdout.trim());
    const state = JSON.parse(await readFile(join(cfg, "kit/hcl-tool.json"), "utf-8"));
    const root = Object.keys(state.projects)[0];
    expect(state.projects[root].source).toBe("detected");
    await rm(cfg, { recursive: true, force: true });
  });

  it("set overrides with source=override and rejects invalid tools", async () => {
    const ws = await getHclWorkspace();
    const cfg = await freshCfg();
    const env = { KIT_STATE_DIR: join(cfg, "kit/state") };
    const ok = await tool(ws, "set", [ws.dir, "terraform"], env);
    expect(ok.exitCode).toBe(0);
    expect((await tool(ws, "get", [ws.dir], env)).stdout.trim()).toBe("terraform");
    const state = JSON.parse(await readFile(join(cfg, "kit/hcl-tool.json"), "utf-8"));
    const root = Object.keys(state.projects)[0];
    expect(state.projects[root].source).toBe("override");
    const bad = await tool(ws, "set", [ws.dir, "pulumi"], env);
    expect(bad.exitCode).toBe(2);
    await rm(cfg, { recursive: true, force: true });
  });
});

describe("hcl-tool.sh concurrency", () => {
  it("first-detect reports the fresh detection to exactly one of many concurrent callers", async () => {
    const ws = await getHclWorkspace();
    const cfg = await freshCfg();
    const env = { KIT_STATE_DIR: join(cfg, "kit/state") };
    const N = 24;
    const results = await Promise.all(
      Array.from({ length: N }, () => tool(ws, "first-detect", [ws.dir], env)),
    );
    const fresh = results.filter((r) => r.stdout.trim().length > 0);
    expect(fresh.length).toBe(1);
    expect(["tofu", "terraform"]).toContain(fresh[0].stdout.trim());
    await rm(cfg, { recursive: true, force: true });
  });

  it("concurrent resolve of distinct projects records every entry (no lost updates)", async () => {
    const cfg = await freshCfg();
    const env = { KIT_STATE_DIR: join(cfg, "kit/state") };
    const N = 24;
    const dirs = await Promise.all(
      Array.from({ length: N }, () => mkdtemp(join(tmpdir(), "proj-"))),
    );
    await Promise.all(
      dirs.map((d) =>
        runHook("hcl-tool.sh", { tool_name: "", tool_input: {}, cwd: d, args: ["resolve", d], env, dir: HOOKS_DIR }),
      ),
    );
    const state = JSON.parse(await readFile(join(cfg, "kit/hcl-tool.json"), "utf-8"));
    expect(Object.keys(state.projects).length).toBe(N);
    await Promise.all([
      rm(cfg, { recursive: true, force: true }),
      ...dirs.map((d) => rm(d, { recursive: true, force: true })),
    ]);
  });
});

