import { describe, it, expect } from "bun:test";
import { checkWorkflowInvocation } from "../utils/workflow-invocation";

// Build a single stream-json (NDJSON) line for an assistant turn that calls a tool.
function toolLine(name: string, input: unknown): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name, input }] },
  });
}

const RUNNER = "/plugin/skills/build-flow/build.workflow.js";
const task = (id: string) => ({ id, title: id.toUpperCase(), prompt: `implement ${id}` });

// A correctly-shaped launch: scriptPath to the runner, nested-array batches, full tasks.
const validInput = {
  scriptPath: RUNNER,
  args: {
    startBatch: 0,
    maxFixRounds: 3,
    ledger: { decisions: [], conventions: [], deviations: [] },
    batches: [[task("a"), task("b")], [task("c")]],
  },
};

describe("checkWorkflowInvocation", () => {
  it("reports not-invoked when no Workflow tool call is present", () => {
    const out = [toolLine("Read", { file_path: "/x" }), toolLine("Skill", { skill: "build-flow" })].join("\n");
    const r = checkWorkflowInvocation(out);
    expect(r.invoked).toBe(false);
    expect(r.valid).toBe(false);
  });

  it("accepts a correctly-shaped launch (object args)", () => {
    const r = checkWorkflowInvocation(toolLine("Workflow", validInput));
    expect(r.invoked).toBe(true);
    expect(r.valid).toBe(true);
  });

  it("accepts args passed as a valid JSON string (runner normalizes it)", () => {
    const r = checkWorkflowInvocation(
      toolLine("Workflow", { scriptPath: RUNNER, args: JSON.stringify(validInput.args) }),
    );
    expect(r.invoked).toBe(true);
    expect(r.valid).toBe(true);
  });

  it("rejects a batch mis-shaped as an object { index, tasks }", () => {
    const bad = { scriptPath: RUNNER, args: { batches: [{ index: 0, tasks: [task("a")] }] } };
    const r = checkWorkflowInvocation(toolLine("Workflow", bad));
    expect(r.invoked).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.details).toMatch(/array/i);
  });

  it("rejects a call that passes run_in_background", () => {
    const r = checkWorkflowInvocation(
      toolLine("Workflow", { ...validInput, run_in_background: true }),
    );
    expect(r.invoked).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.details).toMatch(/run_in_background/i);
  });

  it("rejects empty batches", () => {
    const r = checkWorkflowInvocation(
      toolLine("Workflow", { scriptPath: RUNNER, args: { batches: [] } }),
    );
    expect(r.invoked).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.details).toMatch(/batch/i);
  });

  it("rejects tasks missing their prompt text", () => {
    const bad = { scriptPath: RUNNER, args: { batches: [[{ id: "a", title: "A" }]] } };
    const r = checkWorkflowInvocation(toolLine("Workflow", bad));
    expect(r.invoked).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.details).toMatch(/prompt/i);
  });

  it("rejects a non-JSON string args payload", () => {
    const r = checkWorkflowInvocation(
      toolLine("Workflow", { scriptPath: RUNNER, args: "not json {" }),
    );
    expect(r.invoked).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.details).toMatch(/json|string/i);
  });

  it("picks the valid call when the agent retries after a bad first attempt", () => {
    const bad = { scriptPath: RUNNER, args: { batches: [{ index: 0, tasks: [task("a")] }] } };
    const out = [toolLine("Workflow", bad), toolLine("Workflow", validInput)].join("\n");
    const r = checkWorkflowInvocation(out);
    expect(r.invoked).toBe(true);
    expect(r.valid).toBe(true);
  });
});
