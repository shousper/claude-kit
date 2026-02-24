import { describe, it, expect, afterAll } from "bun:test";
import { writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import {
  getHookWorkspace,
  getGoWorkspace,
  getRustWorkspace,
  cleanupHookWorkspace,
  runHook,
} from "../utils/hook-workspace";
import { ROOT } from "../utils/paths";

/** Extract the last JSON object from stdout that may contain preceding tool output. */
function extractJson(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  // Try parsing the whole thing first (clean JSON output)
  if (trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed); } catch {}
  }
  // Fall back to extracting trailing JSON after a newline
  const jsonStart = stdout.lastIndexOf("\n{");
  if (jsonStart === -1) throw new Error(`No JSON found in stdout: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(jsonStart));
}

const hasGofmt = !!Bun.which("gofmt");
const hasRustfmt = !!Bun.which("rustfmt");
const hasCargo = !!Bun.which("cargo");

afterAll(async () => {
  await cleanupHookWorkspace();
});

// --- ESLint ---

describe("eslint.sh", () => {
  it("exits cleanly for non-JS/TS files (skip)", async () => {
    const ws = await getHookWorkspace();
    const filePath = join(ws.dir, "README.md");
    await writeFile(filePath, "# Hello\n");

    const result = await runHook("eslint.sh", {
      tool_name: "Write",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("exits cleanly for unknown tool names (skip)", async () => {
    const ws = await getHookWorkspace();
    const result = await runHook("eslint.sh", {
      tool_name: "Read",
      tool_input: { file_path: "/whatever" },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("succeeds on a clean JS file", async () => {
    const ws = await getHookWorkspace();
    await mkdir(join(ws.dir, "src"), { recursive: true });
    const filePath = join(ws.dir, "src/clean.js");
    await writeFile(filePath, "const x = 1;\nconsole.log(x);\n");

    const result = await runHook("eslint.sh", {
      tool_name: "Write",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Successfully formatted");
  }, 30_000);

  it("reports lint errors via JSON with decision: block", async () => {
    const ws = await getHookWorkspace();
    await mkdir(join(ws.dir, "src"), { recursive: true });
    const filePath = join(ws.dir, "src/dirty.js");
    await writeFile(filePath, "const unused = 1;\n");

    const result = await runHook("eslint.sh", {
      tool_name: "Edit",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    const json = extractJson(result.stdout);
    expect(json.decision).toBe("block");
    expect(json.reason).toContain("linting issues");
    expect(json.stopReason).toContain("eslint found");
  }, 30_000);
});

// --- TypeScript ---

describe("typescript.sh", () => {
  it("exits cleanly for non-TS files (skip)", async () => {
    const ws = await getHookWorkspace();
    await mkdir(join(ws.dir, "src"), { recursive: true });
    const filePath = join(ws.dir, "src/skip.js");
    await writeFile(filePath, "const x = 1;\n");

    const result = await runHook("typescript.sh", {
      tool_name: "Write",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("succeeds on a valid TypeScript file", async () => {
    const ws = await getHookWorkspace();
    await mkdir(join(ws.dir, "src"), { recursive: true });
    const filePath = join(ws.dir, "src/valid.ts");
    await writeFile(filePath, "const x: number = 42;\nconsole.log(x);\n");

    const result = await runHook("typescript.sh", {
      tool_name: "Write",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Successfully type-checked");
  }, 30_000);

  it("reports type errors via JSON with decision: block", async () => {
    const ws = await getHookWorkspace();
    await mkdir(join(ws.dir, "src"), { recursive: true });
    const filePath = join(ws.dir, "src/broken.ts");
    await writeFile(filePath, 'const x: number = "not a number";\n');

    const result = await runHook("typescript.sh", {
      tool_name: "Edit",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    const json = extractJson(result.stdout);
    expect(json.decision).toBe("block");
    expect(json.reason).toContain("type error");
    expect(json.stopReason).toContain("tsc found");
  }, 30_000);
});

// --- gofmt ---

describe.skipIf(!hasGofmt)("gofmt.sh", () => {
  it("exits cleanly for non-Go files (skip)", async () => {
    const ws = await getGoWorkspace();
    const filePath = join(ws.dir, "README.md");
    await writeFile(filePath, "# Hello\n");

    const result = await runHook("gofmt.sh", {
      tool_name: "Write",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("formats a Go file successfully", async () => {
    const ws = await getGoWorkspace();
    const filePath = join(ws.dir, "src/main.go");
    // Badly formatted but valid Go
    await writeFile(filePath, 'package main\n\nimport "fmt"\n\nfunc main(){\nfmt.Println("hello")\n}\n');

    const result = await runHook("gofmt.sh", {
      tool_name: "Write",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Successfully formatted");
    // Verify the file was actually formatted (gofmt -w modifies in place)
    const formatted = await readFile(filePath, "utf-8");
    expect(formatted).toContain("func main() {");
  });

  it("fails on invalid Go syntax", async () => {
    const ws = await getGoWorkspace();
    const filePath = join(ws.dir, "src/bad.go");
    await writeFile(filePath, "package main\n\nfunc {{{ invalid\n");

    const result = await runHook("gofmt.sh", {
      tool_name: "Edit",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    // gofmt exits 1 on failure (no JSON block)
    expect(result.exitCode).toBe(1);
  });
});

// --- rustfmt ---

describe.skipIf(!hasRustfmt)("rustfmt.sh", () => {
  it("exits cleanly for non-Rust files (skip)", async () => {
    const ws = await getRustWorkspace();
    const filePath = join(ws.dir, "README.md");
    await writeFile(filePath, "# Hello\n");

    const result = await runHook("rustfmt.sh", {
      tool_name: "Write",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("formats a Rust file successfully", async () => {
    const ws = await getRustWorkspace();
    const filePath = join(ws.dir, "src/fmt_test.rs");
    // Badly formatted but valid Rust
    await writeFile(filePath, 'fn hello(){println!("hello");}\n');

    const result = await runHook("rustfmt.sh", {
      tool_name: "Write",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Successfully formatted");
    // Verify formatting happened
    const formatted = await readFile(filePath, "utf-8");
    expect(formatted).toContain("fn hello() {");
  });

  it("fails on invalid Rust syntax", async () => {
    const ws = await getRustWorkspace();
    const filePath = join(ws.dir, "src/bad.rs");
    await writeFile(filePath, "fn {{{ invalid\n");

    const result = await runHook("rustfmt.sh", {
      tool_name: "Edit",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    // rustfmt exits 1 on failure (no JSON block)
    expect(result.exitCode).toBe(1);
  });
});

// --- cargo-check ---

describe.skipIf(!hasCargo)("cargo-check.sh", () => {
  it("exits cleanly for non-Rust files (skip)", async () => {
    const ws = await getRustWorkspace();
    const filePath = join(ws.dir, "README.md");
    await writeFile(filePath, "# Hello\n");

    const result = await runHook("cargo-check.sh", {
      tool_name: "Write",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("succeeds on valid Rust code", async () => {
    const ws = await getRustWorkspace();
    const filePath = join(ws.dir, "src/main.rs");
    await writeFile(filePath, "fn main() {\n    println!(\"hello\");\n}\n");

    const result = await runHook("cargo-check.sh", {
      tool_name: "Write",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    // cargo-check exits 0 silently on success (no stdout)
    expect(result.exitCode).toBe(0);
  }, 60_000);

  it("reports compilation errors via JSON with decision: block", async () => {
    const ws = await getRustWorkspace();
    const filePath = join(ws.dir, "src/main.rs");
    // Deliberate compilation error: undefined variable
    await writeFile(filePath, "fn main() {\n    println!(\"{}\", undefined_var);\n}\n");

    const result = await runHook("cargo-check.sh", {
      tool_name: "Edit",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    const json = extractJson(result.stdout);
    expect(json.decision).toBe("block");
    expect(json.stopReason).toContain("cargo check");
  }, 60_000);
});

// --- clippy ---

describe.skipIf(!hasCargo)("clippy.sh", () => {
  it("exits cleanly for non-Rust files (skip)", async () => {
    const ws = await getRustWorkspace();
    const filePath = join(ws.dir, "README.md");
    await writeFile(filePath, "# Hello\n");

    const result = await runHook("clippy.sh", {
      tool_name: "Write",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("succeeds on clean Rust code", async () => {
    const ws = await getRustWorkspace();
    const filePath = join(ws.dir, "src/main.rs");
    await writeFile(filePath, "fn main() {\n    println!(\"hello\");\n}\n");

    const result = await runHook("clippy.sh", {
      tool_name: "Write",
      tool_input: { file_path: filePath },
      cwd: ws.dir,
    });

    expect(result.exitCode).toBe(0);
  }, 60_000);
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
