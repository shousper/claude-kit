import { describe, it, expect, afterAll } from "bun:test";
import { writeFile, mkdir, mkdir as mkdirP, readFile, readFile as readFileP } from "fs/promises";
import { join } from "path";
import {
  getHookWorkspace,
  getGoWorkspace,
  getRustWorkspace,
  getHclWorkspace,
  makeFakeBin,
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

// --- hcl-record ---

describe("hcl-record.sh", () => {
  it("ignores non-HCL files and writes nothing", async () => {
    const ws = await getHclWorkspace();
    const cfg = await import("os").then(os => import("fs/promises").then(fs => fs.mkdtemp(join(os.tmpdir(), "kit-cfg-"))));
    const filePath = join(ws.dir, "README.md");
    await writeFile(filePath, "# hi\n");
    const r = await runHook("hcl-record.sh", {
      tool_name: "Write", tool_input: { file_path: filePath }, cwd: ws.dir,
      session_id: "rec-1", env: { CLAUDE_CONFIG_DIR: cfg },
    });
    expect(r.exitCode).toBe(0);
    const scratch = join(cfg, "kit/state/hcl-touched-rec-1.txt");
    await expect(readFileP(scratch, "utf-8")).rejects.toThrow();
  });

  it("records an edited .tf file path", async () => {
    const ws = await getHclWorkspace();
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(), "kit-cfg-"))));
    const filePath = join(ws.dir, "main.tf");
    const r = await runHook("hcl-record.sh", {
      tool_name: "Edit", tool_input: { file_path: filePath }, cwd: ws.dir,
      session_id: "rec-2", env: { CLAUDE_CONFIG_DIR: cfg },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(""); // silent
    const scratch = join(cfg, "kit/state/hcl-touched-rec-2.txt");
    const contents = await readFileP(scratch, "utf-8");
    expect(contents).toContain(filePath);
  });
});

// --- hook-workspace agent_id support ---

describe("hook-workspace agent_id support", () => {
  it("runHook includes agent_id in the hook JSON when provided", async () => {
    const ws = await getHclWorkspace();
    // hcl-record keys the scratch by agent_id when present; prove the field arrives.
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(), "kit-cfg-"))));
    await runHook("hcl-record.sh", {
      tool_name: "Edit", tool_input: { file_path: join(ws.dir, "main.tf") }, cwd: ws.dir,
      session_id: "sess-x", agent_id: "agent-y", env: { CLAUDE_CONFIG_DIR: cfg },
    });
    // Keyed by agent_id, NOT session_id:
    await expect(readFileP(join(cfg, "kit/state/hcl-touched-agent-y.txt"), "utf-8")).resolves.toContain("main.tf");
    await expect(readFileP(join(cfg, "kit/state/hcl-touched-sess-x.txt"), "utf-8")).rejects.toThrow();
  });
});

// --- hcl-fmt ---

function extractJsonOrNull(stdout: string): any {
  const t = stdout.trim();
  if (!t) return null;
  return JSON.parse(t);
}

describe("hcl-fmt.sh", () => {
  it("does nothing when the scratch file is absent", async () => {
    const ws = await getHclWorkspace();
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"kit-cfg-"))));
    const r = await runHook("hcl-fmt.sh", {
      tool_name: "", tool_input: {}, cwd: ws.dir, session_id: "fmt-empty",
      env: { CLAUDE_CONFIG_DIR: cfg },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("runs fmt on the recorded directory using the resolved tool", async () => {
    const ws = await getHclWorkspace();
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"kit-cfg-"))));
    const bin = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"fakebin-"))));
    await makeFakeBin(bin, "tofu");        // fake tofu logs its argv
    const env = { CLAUDE_CONFIG_DIR: cfg, PATH: `${bin}:${process.env.PATH}` };

    // Pre-set tool to tofu so detection is deterministic.
    await runHook("hcl-tool.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, args:["set", ws.dir, "tofu"], env });
    // Record an edit.
    await runHook("hcl-record.sh", { tool_name:"Edit", tool_input:{ file_path: join(ws.dir,"main.tf") }, cwd: ws.dir, session_id:"fmt-run", env });

    const r = await runHook("hcl-fmt.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, session_id:"fmt-run", env });
    expect(r.exitCode).toBe(0);
    const log = await readFileP(join(bin, "tofu.log"), "utf-8");
    expect(log).toContain("fmt");
    expect(log).toContain(ws.dir); // touched file path contains the dir
    // scratch consumed
    await expect(readFileP(join(cfg, "kit/state/hcl-touched-fmt-run.txt"), "utf-8")).rejects.toThrow();
  });

  it("hcl-fmt formats the specific touched file, not the whole directory", async () => {
    const ws = await getHclWorkspace();
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"kit-cfg-"))));
    const bin = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"fakebin-"))));
    await makeFakeBin(bin, "tofu");
    const env = { CLAUDE_CONFIG_DIR: cfg, PATH: `${bin}:${process.env.PATH}` };
    await runHook("hcl-tool.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, args:["set", ws.dir, "tofu"], env });
    await runHook("hcl-record.sh", { tool_name:"Edit", tool_input:{ file_path: join(ws.dir,"main.tf") }, cwd: ws.dir, session_id:"gf", env });
    await runHook("hcl-fmt.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, session_id:"gf", env });
    const log = (await readFileP(join(bin, "tofu.log"), "utf-8")).trim();
    // fmt was called with the FILE path, not the bare directory
    expect(log).toContain(join(ws.dir, "main.tf"));
    expect(log.split(/\s+/)).toContain("fmt");
  });

  it("hcl-fmt stays silent (no notice) when the resolved tool is not installed", async () => {
    const ws = await getHclWorkspace();
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"kit-cfg-"))));
    const emptyBin = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"emptybin-"))));
    const env = { CLAUDE_CONFIG_DIR: cfg, PATH: emptyBin }; // neither tofu nor terraform on PATH
    await runHook("hcl-record.sh", { tool_name:"Edit", tool_input:{ file_path: join(ws.dir,"main.tf") }, cwd: ws.dir, session_id:"ni", env });
    const r = await runHook("hcl-fmt.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, session_id:"ni", env });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(""); // no systemMessage when tool absent
  });

  it("skips validate when .terraform is absent and runs it when present", async () => {
    const ws = await getHclWorkspace();
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"kit-cfg-"))));
    const bin = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"fakebin-"))));
    await makeFakeBin(bin, "tofu");
    const env = { CLAUDE_CONFIG_DIR: cfg, PATH: `${bin}:${process.env.PATH}` };
    await runHook("hcl-tool.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, args:["set", ws.dir, "tofu"], env });

    // No .terraform yet → validate must NOT appear.
    await runHook("hcl-record.sh", { tool_name:"Edit", tool_input:{ file_path: join(ws.dir,"main.tf") }, cwd: ws.dir, session_id:"v1", env });
    await runHook("hcl-fmt.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, session_id:"v1", env });
    let log = await readFileP(join(bin, "tofu.log"), "utf-8");
    expect(log).not.toContain("validate");

    // Now create .terraform → validate must appear.
    await mkdirP(join(ws.dir, ".terraform"), { recursive: true });
    await runHook("hcl-record.sh", { tool_name:"Edit", tool_input:{ file_path: join(ws.dir,"main.tf") }, cwd: ws.dir, session_id:"v2", env });
    await runHook("hcl-fmt.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, session_id:"v2", env });
    log = await readFileP(join(bin, "tofu.log"), "utf-8");
    expect(log).toContain("validate");
  });

  it("emits a first-detection systemMessage, then is silent next time", async () => {
    const ws = await getHclWorkspace();
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"kit-cfg-"))));
    const bin = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"fakebin-"))));
    await makeFakeBin(bin, "tofu");
    const env = { CLAUDE_CONFIG_DIR: cfg, PATH: `${bin}:${process.env.PATH}` };

    await runHook("hcl-record.sh", { tool_name:"Edit", tool_input:{ file_path: join(ws.dir,"main.tf") }, cwd: ws.dir, session_id:"n1", env });
    const first = await runHook("hcl-fmt.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, session_id:"n1", env });
    const j1 = extractJsonOrNull(first.stdout);
    expect(j1?.systemMessage ?? "").toContain("/kit:hcl-tool");

    await runHook("hcl-record.sh", { tool_name:"Edit", tool_input:{ file_path: join(ws.dir,"main.tf") }, cwd: ws.dir, session_id:"n2", env });
    const second = await runHook("hcl-fmt.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, session_id:"n2", env });
    const j2 = extractJsonOrNull(second.stdout);
    expect(j2?.systemMessage ?? "").not.toContain("/kit:hcl-tool");
  });

  it("hcl-fmt formats a subagent's edits on SubagentStop (keyed by agent_id)", async () => {
    const ws = await getHclWorkspace();
    const cfg = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"kit-cfg-"))));
    const bin = await import("fs/promises").then(fs => import("os").then(os => fs.mkdtemp(join(os.tmpdir(),"fakebin-"))));
    await makeFakeBin(bin, "tofu");
    const env = { CLAUDE_CONFIG_DIR: cfg, PATH: `${bin}:${process.env.PATH}` };
    await runHook("hcl-tool.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, args:["set", ws.dir, "tofu"], env });
    // Subagent records an edit (agent_id present)
    await runHook("hcl-record.sh", { tool_name:"Edit", tool_input:{ file_path: join(ws.dir,"main.tf") }, cwd: ws.dir, session_id:"S", agent_id:"A", env });
    // SubagentStop fires hcl-fmt with the same agent_id
    const r = await runHook("hcl-fmt.sh", { tool_name:"", tool_input:{}, cwd: ws.dir, session_id:"S", agent_id:"A", env });
    expect(r.exitCode).toBe(0);
    const log = await readFileP(join(bin, "tofu.log"), "utf-8");
    expect(log).toContain("fmt");
    // scratch for agent A consumed
    await expect(readFileP(join(cfg, "kit/state/hcl-touched-A.txt"), "utf-8")).rejects.toThrow();
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
    const oldF = join(stateDir, "hcl-touched-dead.txt");
    const freshF = join(stateDir, "hcl-touched-live.txt");
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
