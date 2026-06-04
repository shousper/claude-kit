import { mkdtemp, writeFile, mkdir, rm, realpath, chmod } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { HOOKS_DIR } from "./paths";

export interface HookWorkspace {
  dir: string;
}

let cached: HookWorkspace | undefined;
let cachedGo: HookWorkspace | undefined;
let cachedRust: HookWorkspace | undefined;
let cachedHcl: HookWorkspace | undefined;

export async function getHookWorkspace(): Promise<HookWorkspace> {
  if (cached) return cached;

  const dir = await mkdtemp(join(tmpdir(), "hook-test-")).then(realpath);

  await writeFile(join(dir, "package.json"), JSON.stringify({
    name: "hook-test-workspace",
    private: true,
    devDependencies: {
      eslint: "^9",
      typescript: "^5",
    },
  }));

  await writeFile(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "es2022",
      module: "nodenext",
      strict: true,
      noEmit: true,
    },
    include: ["src/**/*.ts"],
  }));

  await writeFile(join(dir, "eslint.config.mjs"), `export default [{ rules: { "no-unused-vars": "error" } }];\n`);

  const proc = Bun.spawn(["bun", "install"], {
    cwd: dir,
    stdout: "ignore",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`bun install failed (exit ${code}): ${stderr}`);
  }

  cached = { dir };
  return cached;
}

export async function getGoWorkspace(): Promise<HookWorkspace> {
  if (cachedGo) return cachedGo;

  const dir = await mkdtemp(join(tmpdir(), "hook-test-go-")).then(realpath);

  await writeFile(join(dir, "go.mod"), "module hook-test\n\ngo 1.21\n");
  await mkdir(join(dir, "src"), { recursive: true });

  cachedGo = { dir };
  return cachedGo;
}

export async function getRustWorkspace(): Promise<HookWorkspace> {
  if (cachedRust) return cachedRust;

  const dir = await mkdtemp(join(tmpdir(), "hook-test-rust-")).then(realpath);

  await writeFile(join(dir, "Cargo.toml"), [
    "[package]",
    'name = "hook-test"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
  ].join("\n"));
  await mkdir(join(dir, "src"), { recursive: true });
  // Create a valid main.rs so cargo check has something to compile
  await writeFile(join(dir, "src", "main.rs"), "fn main() {\n    println!(\"hello\");\n}\n");

  cachedRust = { dir };
  return cachedRust;
}

export async function getHclWorkspace(): Promise<HookWorkspace> {
  if (cachedHcl) return cachedHcl;
  const dir = await mkdtemp(join(tmpdir(), "hook-test-hcl-")).then(realpath);
  const git = (args: string[]) => Bun.spawn(["git", ...args], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
  await git(["init"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "test"]);
  await writeFile(join(dir, "main.tf"), 'resource "null_resource" "a" {}\n');
  await git(["add", "."]);
  await git(["commit", "-m", "init"]);
  cachedHcl = { dir };
  return cachedHcl;
}

/** Create an executable shim at <dir>/<name> that appends its argv to <dir>/<name>.log and exits 0. */
export async function makeFakeBin(dir: string, name: string, body?: string): Promise<void> {
  const script = body ?? `#!/usr/bin/env bash\necho "$@" >> "${join(dir, `${name}.log`)}"\nexit 0\n`;
  const path = join(dir, name);
  await writeFile(path, script);
  await chmod(path, 0o755);
}

export interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd: string;
  session_id?: string;
  agent_id?: string;
  stop_hook_active?: boolean;       // forwarded to the hook; defaults to false
  args?: string[];                  // appended as argv to the script
  env?: Record<string, string>;     // merged over process.env
}

export interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runHook(
  scriptName: string,
  input: HookInput,
): Promise<HookResult> {
  const scriptPath = resolve(HOOKS_DIR, scriptName);
  const json = JSON.stringify({
    session_id: input.session_id ?? "test-session",
    agent_id: input.agent_id,
    cwd: input.cwd,
    tool_name: input.tool_name,
    tool_input: input.tool_input,
    stop_hook_active: input.stop_hook_active ?? false,
  });

  const bash = Bun.which("bash") ?? "bash";
  const proc = Bun.spawn([bash, scriptPath, ...(input.args ?? [])], {
    stdin: new TextEncoder().encode(json),
    stdout: "pipe",
    stderr: "pipe",
    cwd: input.cwd,
    env: { ...process.env, ...(input.env ?? {}) },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return { exitCode: await proc.exited, stdout, stderr };
}

export async function cleanupHookWorkspace(): Promise<void> {
  const cleanups = [cached, cachedGo, cachedRust, cachedHcl].filter(Boolean);
  await Promise.all(
    cleanups.map((ws) =>
      rm(ws!.dir, { recursive: true, force: true }).catch((e) =>
        console.warn("hook workspace cleanup failed:", e.message),
      ),
    ),
  );
  cached = cachedGo = cachedRust = cachedHcl = undefined;
}
