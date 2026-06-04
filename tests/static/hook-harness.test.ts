import { describe, it, expect, afterAll } from "bun:test";
import { join } from "path";
import {
  getHclWorkspace,
  cleanupHookWorkspace,
  runHook,
} from "../utils/hook-workspace";
import { ROOT } from "../utils/paths";

afterAll(async () => {
  await cleanupHookWorkspace();
});

// --- session-start ---

describe("session-start.sh", () => {
  it("outputs hookSpecificOutput JSON with using-kit content", async () => {
    const result = await runHook("session-start.sh", {
      tool_name: "",
      tool_input: {},
      cwd: ROOT,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.hookSpecificOutput).toBeDefined();
    expect(json.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(json.hookSpecificOutput.additionalContext).toContain("EXTREMELY_IMPORTANT");
    expect(json.hookSpecificOutput.additionalContext).toContain("kit");
  });

  it("includes code-standards trigger instruction", async () => {
    const result = await runHook("session-start.sh", {
      tool_name: "",
      tool_input: {},
      cwd: ROOT,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.hookSpecificOutput.additionalContext).toContain("code-standards");
  });
});

// --- hook-workspace env support ---

describe("hook-workspace env support", () => {
  it("runHook forwards a custom env to the script", async () => {
    const ws = await getHclWorkspace();
    const result = await runHook("hcl-tool.sh", {
      tool_name: "",
      tool_input: {},
      cwd: ws.dir,
      args: ["root", ws.dir],
      env: { KIT_SENTINEL: "ok" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(ws.dir);
  });
});

// --- hook-workspace agent_id support ---

describe("hook-workspace agent_id support", () => {
  it("runHook includes agent_id in the hook JSON when provided", async () => {
    const ws = await getHclWorkspace();
    // record.sh keys the scratch by agent_id when present; prove the field arrives.
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(), "kit-cfg-"))));
    const { readFile } = await import("fs/promises");
    await runHook("record.sh", {
      tool_name: "Edit", tool_input: { file_path: join(ws.dir, "main.tf") }, cwd: ws.dir,
      session_id: "sess-x", agent_id: "agent-y", env: { CLAUDE_CONFIG_DIR: cfg },
    });
    // Keyed by agent_id, NOT session_id:
    await expect(readFile(join(cfg, "kit/state/touched-agent-y.txt"), "utf-8")).resolves.toContain("main.tf");
    await expect(readFile(join(cfg, "kit/state/touched-sess-x.txt"), "utf-8")).rejects.toThrow();
  });
});

// --- hcl-detect ---

describe("hcl-detect.sh", () => {
  it("is silent for a non-HCL project", async () => {
    const dir = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"nohcl-"))));
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"kit-cfg-"))));
    const r = await runHook("hcl-detect.sh", { tool_name:"", tool_input:{}, cwd: dir, env: { CLAUDE_CONFIG_DIR: cfg } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("emits a systemMessage for an undetected HCL project, then is silent", async () => {
    const ws = await getHclWorkspace();
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"kit-cfg-"))));
    const env = { CLAUDE_CONFIG_DIR: cfg };
    const first = await runHook("hcl-detect.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, env });
    const j1 = first.stdout.trim() ? JSON.parse(first.stdout) : null;
    expect(j1?.systemMessage ?? "").toContain("/kit:hcl-tool");
    const second = await runHook("hcl-detect.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, env });
    expect(second.stdout.trim()).toBe("");
  });

  it("hcl-detect prunes scratch files older than a day and keeps fresh ones", async () => {
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"kit-cfg-"))));
    const { mkdir, writeFile, utimes, stat } = await import("fs/promises");
    const stateDir = join(cfg, "kit/state");
    await mkdir(stateDir, { recursive: true });
    const oldF = join(stateDir, "touched-dead.txt");
    const freshF = join(stateDir, "touched-live.txt");
    await writeFile(oldF, "/x/main.tf\n");
    await writeFile(freshF, "/y/main.tf\n");
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000);
    await utimes(oldF, twoDaysAgo, twoDaysAgo);
    // cwd need not be HCL; prune runs regardless before the early-exits.
    const nonHcl = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"nohcl-"))));
    await runHook("hcl-detect.sh", { tool_name:"", tool_input:{}, cwd: nonHcl, env: { CLAUDE_CONFIG_DIR: cfg } });
    await expect(stat(oldF)).rejects.toThrow();   // pruned
    await expect(stat(freshF)).resolves.toBeDefined(); // kept
  });
});
