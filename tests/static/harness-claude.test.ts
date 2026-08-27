import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { claude } from "../utils/harness/claude";
import { ROOT } from "../utils/paths";

const FIXTURE = readFileSync(resolve(ROOT, "tests/fixtures/events/claude-skill-activation.jsonl"), "utf-8");
const ERROR_FIXTURE = readFileSync(resolve(ROOT, "tests/fixtures/events/claude-error-result.jsonl"), "utf-8");

describe("claude adapter", () => {
  it("pins sonnet and never inherits the session model", () => {
    const args = claude.buildArgs("hi", {});
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
  });

  it("emits --max-turns when bounded", () => {
    expect(claude.buildArgs("hi", { maxTurns: 3 })).toContain("--max-turns");
  });

  it("extracts tool calls from assistant events", () => {
    const calls = claude.parse(FIXTURE).filter((e) => e.kind === "tool_call");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tool: "Skill", input: { skill: "kit:tdd" } });
  });

  it("detects activation by namespaced or bare skill name", () => {
    const events = claude.parse(FIXTURE);
    expect(claude.skillActivationSignal(events, "tdd")).toBe(true);
    expect(claude.skillActivationSignal(events, "kit:tdd")).toBe(true);
    expect(claude.skillActivationSignal(events, "brainstorming")).toBe(false);
  });

  it("surfaces a failed run as a structured error event", () => {
    const events = claude.parse(ERROR_FIXTURE);
    expect(events).toContainEqual({
      kind: "error",
      message: "Error: tool execution failed after 3 retries",
    });
  });
});
