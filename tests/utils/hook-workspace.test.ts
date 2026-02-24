import { describe, it, expect, afterAll } from "bun:test";
import { access } from "fs/promises";
import { join } from "path";
import { getHookWorkspace, getGoWorkspace, getRustWorkspace, cleanupHookWorkspace, runHook } from "./hook-workspace";

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

afterAll(async () => {
  await cleanupHookWorkspace();
});

describe("hook workspace", () => {
  it("creates a workspace with eslint and typescript installed", async () => {
    const ws = await getHookWorkspace();

    expect(await exists(join(ws.dir, "package.json"))).toBe(true);
    expect(await exists(join(ws.dir, "node_modules"))).toBe(true);
    expect(await exists(join(ws.dir, "node_modules/eslint"))).toBe(true);
    expect(await exists(join(ws.dir, "node_modules/typescript"))).toBe(true);
    expect(await exists(join(ws.dir, "tsconfig.json"))).toBe(true);
    expect(await exists(join(ws.dir, "eslint.config.mjs"))).toBe(true);
  }, 30_000);

  it("returns the same workspace on second call (cached)", async () => {
    const ws1 = await getHookWorkspace();
    const ws2 = await getHookWorkspace();
    expect(ws1.dir).toBe(ws2.dir);
  });
});

describe("go workspace", () => {
  it("creates a workspace with go.mod", async () => {
    const ws = await getGoWorkspace();
    expect(await exists(join(ws.dir, "go.mod"))).toBe(true);
    expect(await exists(join(ws.dir, "src"))).toBe(true);
  });

  it("returns the same workspace on second call (cached)", async () => {
    const ws1 = await getGoWorkspace();
    const ws2 = await getGoWorkspace();
    expect(ws1.dir).toBe(ws2.dir);
  });
});

describe("rust workspace", () => {
  it("creates a workspace with Cargo.toml and src/main.rs", async () => {
    const ws = await getRustWorkspace();
    expect(await exists(join(ws.dir, "Cargo.toml"))).toBe(true);
    expect(await exists(join(ws.dir, "src"))).toBe(true);
    expect(await exists(join(ws.dir, "src/main.rs"))).toBe(true);
  });

  it("returns the same workspace on second call (cached)", async () => {
    const ws1 = await getRustWorkspace();
    const ws2 = await getRustWorkspace();
    expect(ws1.dir).toBe(ws2.dir);
  });
});

describe("runHook", () => {
  it("runs a hook script with JSON input and captures output", async () => {
    const ws = await getHookWorkspace();
    const result = await runHook("eslint.sh", {
      tool_name: "Write",
      tool_input: { file_path: "/nonexistent/file.md" },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});
