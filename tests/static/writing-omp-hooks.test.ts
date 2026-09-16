import { describe, it, expect } from "bun:test";
import { resolve } from "path";
import { collectDocTargets, buildLintCommand, appendSummary, createToolResultHandler } from "../../plugins/writing-omp/omp/hooks";

const PLUGIN_ROOT = "/plugin-root";
const CWD = "/session/worktree";

describe("collectDocTargets", () => {
  it("maps write to write mode and edit/apply_patch to edit mode for documentation files", () => {
    expect(collectDocTargets("write", { path: "/p/README.md" }, CWD)).toEqual([{ path: "/p/README.md", mode: "write" }]);
    expect(collectDocTargets("edit", { path: "/p/docs/a.rst" }, CWD)).toEqual([{ path: "/p/docs/a.rst", mode: "edit" }]);
    expect(collectDocTargets("apply_patch", { path: "/p/notes.TXT" }, CWD)).toEqual([{ path: "/p/notes.TXT", mode: "edit" }]);
  });

  it("resolves relative paths against the session cwd, not the process cwd", () => {
    expect(collectDocTargets("write", { path: "docs/plans/runbook.md" }, CWD)).toEqual([{ path: "/session/worktree/docs/plans/runbook.md", mode: "write" }]);
  });

  it("reads a multi-file batch from paths, keeps only documentation files, and deduplicates", () => {
    const input = { paths: ["README.md", "src/a.ts", "/abs/b.md", "README.md"] };
    expect(collectDocTargets("edit", input, CWD)).toEqual([
      { path: "/session/worktree/README.md", mode: "edit" },
      { path: "/abs/b.md", mode: "edit" },
    ]);
  });

  it("ignores code files, other tools, and malformed input", () => {
    expect(collectDocTargets("write", { path: "/p/a.ts" }, CWD)).toEqual([]);
    expect(collectDocTargets("read", { path: "/p/README.md" }, CWD)).toEqual([]);
    expect(collectDocTargets("write", { content: "x" }, CWD)).toEqual([]);
    expect(collectDocTargets("write", null, CWD)).toEqual([]);
    expect(collectDocTargets("write", { path: "" }, CWD)).toEqual([]);
    expect(collectDocTargets("edit", { paths: [42, ""] }, CWD)).toEqual([]);
  });
});

describe("buildLintCommand", () => {
  it("resolves the shared script through the plugin's hooks link and passes path and mode", () => {
    expect(buildLintCommand(PLUGIN_ROOT, { path: "/p/README.md", mode: "edit" })).toEqual([resolve(PLUGIN_ROOT, "hooks/vale-lint.sh"), "/p/README.md", "edit"]);
  });
});

describe("appendSummary", () => {
  it("appends a text block after the existing content", () => {
    expect(appendSummary([{ type: "text", text: "ok" }], "vale: 1 findings")).toEqual([{ type: "text", text: "ok" }, { type: "text", text: "vale: 1 findings" }]);
    expect(appendSummary(undefined, "s")).toEqual([{ type: "text", text: "s" }]);
  });
});

describe("createToolResultHandler", () => {
  const calls: { args: string[]; cwd: string }[] = [];
  const exec = async (command: string, args: string[], opts: { cwd: string }) => {
    calls.push({ args: [command, ...args], cwd: opts.cwd });
    return { stdout: args[0].endsWith("bad.md") ? `vale: 2 findings in ${args[0]}\n` : "", stderr: "", code: 0 };
  };
  const handler = createToolResultHandler(PLUGIN_ROOT, exec);

  it("runs the script in the session cwd against the cwd-resolved path and appends the summary", async () => {
    const result = await handler({ toolName: "write", input: { path: "docs/bad.md" }, content: [{ type: "text", text: "wrote" }] }, { cwd: CWD });
    expect(result).toEqual({ content: [{ type: "text", text: "wrote" }, { type: "text", text: "vale: 2 findings in /session/worktree/docs/bad.md" }] });
    expect(calls.at(-1)).toEqual({ args: [resolve(PLUGIN_ROOT, "hooks/vale-lint.sh"), "/session/worktree/docs/bad.md", "write"], cwd: CWD });
  });

  it("falls back to the process cwd when the context carries none", async () => {
    await handler({ toolName: "write", input: { path: "/p/bad.md" } });
    expect(calls.at(-1)?.cwd).toBe(process.cwd());
  });

  it("joins the summaries of a multi-file batch and omits clean files", async () => {
    const result = await handler({ toolName: "edit", input: { paths: ["a/bad.md", "clean.md", "b/bad.md"] }, content: [] }, { cwd: CWD });
    expect(result).toEqual({ content: [{ type: "text", text: "vale: 2 findings in /session/worktree/a/bad.md\nvale: 2 findings in /session/worktree/b/bad.md" }] });
  });

  it("returns undefined for clean files, errors, and non-documentation tools", async () => {
    expect(await handler({ toolName: "edit", input: { path: "/p/clean.md" }, content: [] }, { cwd: CWD })).toBeUndefined();
    expect(await handler({ toolName: "write", input: { path: "/p/bad.md" }, isError: true }, { cwd: CWD })).toBeUndefined();
    expect(await handler({ toolName: "bash", input: { command: "ls" } }, { cwd: CWD })).toBeUndefined();
  });

  it("swallows script failures", async () => {
    const failing = createToolResultHandler(PLUGIN_ROOT, async () => { throw new Error("boom"); });
    expect(await failing({ toolName: "write", input: { path: "/p/bad.md" } }, { cwd: CWD })).toBeUndefined();
  });
});
