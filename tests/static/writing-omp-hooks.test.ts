import { describe, it, expect } from "bun:test";
import { resolve } from "path";
import { collectDocTarget, buildLintCommand, appendSummary, createToolResultHandler } from "../../plugins/writing-omp/omp/hooks";

const PLUGIN_ROOT = "/plugin-root";

describe("collectDocTarget", () => {
  it("maps write to write mode and edit/apply_patch to edit mode for documentation files", () => {
    expect(collectDocTarget("write", { path: "/p/README.md" })).toEqual({ path: "/p/README.md", mode: "write" });
    expect(collectDocTarget("edit", { path: "/p/docs/a.rst" })).toEqual({ path: "/p/docs/a.rst", mode: "edit" });
    expect(collectDocTarget("apply_patch", { path: "/p/notes.TXT" })).toEqual({ path: "/p/notes.TXT", mode: "edit" });
  });

  it("ignores code files, other tools, and malformed input", () => {
    expect(collectDocTarget("write", { path: "/p/a.ts" })).toBeNull();
    expect(collectDocTarget("read", { path: "/p/README.md" })).toBeNull();
    expect(collectDocTarget("write", { content: "x" })).toBeNull();
    expect(collectDocTarget("write", null)).toBeNull();
    expect(collectDocTarget("write", { path: "" })).toBeNull();
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
  const calls: string[][] = [];
  const exec = async (command: string, args: string[]) => {
    calls.push([command, ...args]);
    return { stdout: args[0].endsWith("bad.md") ? "vale: 2 findings in bad.md\n" : "", stderr: "", code: 0 };
  };
  const handler = createToolResultHandler(PLUGIN_ROOT, exec);

  it("returns a content override carrying the summary when the script reports findings", async () => {
    const result = await handler({ toolName: "write", input: { path: "/p/bad.md" }, content: [{ type: "text", text: "wrote" }] });
    expect(result).toEqual({ content: [{ type: "text", text: "wrote" }, { type: "text", text: "vale: 2 findings in bad.md" }] });
    expect(calls.at(-1)).toEqual([resolve(PLUGIN_ROOT, "hooks/vale-lint.sh"), "/p/bad.md", "write"]);
  });

  it("returns undefined for clean files, errors, and non-documentation tools", async () => {
    expect(await handler({ toolName: "edit", input: { path: "/p/clean.md" }, content: [] })).toBeUndefined();
    expect(await handler({ toolName: "write", input: { path: "/p/bad.md" }, isError: true })).toBeUndefined();
    expect(await handler({ toolName: "bash", input: { command: "ls" } })).toBeUndefined();
  });

  it("swallows script failures", async () => {
    const failing = createToolResultHandler(PLUGIN_ROOT, async () => { throw new Error("boom"); });
    expect(await failing({ toolName: "write", input: { path: "/p/bad.md" } })).toBeUndefined();
  });
});
