import { describe, it, expect } from "bun:test";
import { isToolCall, type NormalizedEvent } from "../utils/harness/types";

describe("normalized event model", () => {
  it("identifies tool-call events", () => {
    const e: NormalizedEvent = { kind: "tool_call", tool: "read", input: { path: "skill://tdd" } };
    expect(isToolCall(e, "read")).toBe(true);
    expect(isToolCall(e, "Skill")).toBe(false);
  });

  it("does not treat text events as tool calls", () => {
    expect(isToolCall({ kind: "text", text: "read" }, "read")).toBe(false);
  });
});
