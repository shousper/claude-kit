import { describe, it, expect } from "bun:test";
import { resolve } from "path";
import { runHook } from "../utils/hook-workspace";
import { ROOT, WRITING_CLAUDE_ROOT } from "../utils/paths";

const HAS_VALE = Bun.which("vale") !== null;
const HOOKS = resolve(WRITING_CLAUDE_ROOT, "hooks");
const FIXTURES = resolve(ROOT, "tests/fixtures/vale");
const run = (tool_name: string, file_path: string) => runHook("vale.sh", { dir: HOOKS, tool_name, tool_input: { file_path }, cwd: FIXTURES });

describe("writing-claude hooks/vale.sh", () => {
  it("is silent for other tools and missing paths", async () => {
    expect((await run("Read", resolve(FIXTURES, "bad.md"))).stdout).toBe("");
    expect((await run("Write", "")).stdout).toBe("");
  });

  describe.skipIf(!HAS_VALE)("with vale installed", () => {
    it("returns the summary as PostToolUse additionalContext", async () => {
      const r = await run("Write", resolve(FIXTURES, "bad.md"));
      expect(r.exitCode).toBe(0);
      const payload = JSON.parse(r.stdout);
      expect(payload.hookSpecificOutput.hookEventName).toBe("PostToolUse");
      expect(payload.hookSpecificOutput.additionalContext).toMatch(/^vale: \d+ findings in bad\.md/);
    });

    it("prints nothing for clean prose", async () => {
      expect((await run("Edit", resolve(FIXTURES, "clean.md"))).stdout).toBe("");
    });
  });
});
