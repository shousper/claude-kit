import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { KIT_CLAUDE_ROOT, STORIES_ROOT } from "../utils/paths";

const WORKFLOWS = [
  { base: resolve(KIT_CLAUDE_ROOT, "skills/build-flow"), file: "build.workflow.js", name: "build-flow-batch-runner" },
  { base: resolve(KIT_CLAUDE_ROOT, "skills/code-review"), file: "review.workflow.js", name: "code-review-runner" },
  { base: resolve(STORIES_ROOT, "skills/work"), file: "plan.workflow.js", name: "story-planners" },
];

describe("bundled workflow scripts", () => {
  for (const wf of WORKFLOWS) {
    const path = resolve(wf.base, wf.file);

    describe(wf.file, () => {
      it("exists", () => {
        expect(existsSync(path)).toBe(true);
      });

      it("begins with a pure-literal meta export", () => {
        const src = readFileSync(path, "utf-8").trimStart();
        expect(src.startsWith("export const meta")).toBe(true);
      });

      it("declares the expected meta name and a description", () => {
        const src = readFileSync(path, "utf-8");
        expect(src).toContain(`name: '${wf.name}'`);
        expect(/description:\s*['"]/.test(src)).toBe(true);
      });

      it("uses workflow hooks and returns a value", () => {
        const src = readFileSync(path, "utf-8");
        expect(src.includes("agent(")).toBe(true);
        expect(src.includes("return")).toBe(true);
      });
    });
  }
});
