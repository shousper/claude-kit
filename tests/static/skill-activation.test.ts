import { describe, it, expect } from "bun:test";
import { checkSkillActivation } from "../utils/skill-activation";

function streamLine(block: any): string {
  return JSON.stringify({ type: "assistant", message: { content: [block] } });
}

describe("checkSkillActivation", () => {
  it("matches a bare kit skill invoked bare", () => {
    const out = streamLine({ type: "tool_use", name: "Skill", input: { skill: "tdd" } });
    expect(checkSkillActivation(out, "tdd").activated).toBe(true);
  });

  it("matches a bare kit skill invoked namespaced", () => {
    const out = streamLine({ type: "tool_use", name: "Skill", input: { skill: "kit:tdd" } });
    expect(checkSkillActivation(out, "tdd").activated).toBe(true);
  });

  it("matches a namespaced stories skill invoked namespaced", () => {
    const out = streamLine({ type: "tool_use", name: "Skill", input: { skill: "stories:work" } });
    expect(checkSkillActivation(out, "stories:work").activated).toBe(true);
  });

  it("matches a namespaced stories skill invoked bare", () => {
    const out = streamLine({ type: "tool_use", name: "Skill", input: { skill: "work" } });
    expect(checkSkillActivation(out, "stories:work").activated).toBe(true);
  });

  it("matches the fully-qualified name in assistant text", () => {
    const out = streamLine({ type: "text", text: "I'll use stories:work for this." });
    expect(checkSkillActivation(out, "stories:work").activated).toBe(true);
  });

  it("kit text fallback still searches kit-qualified name", () => {
    const out = streamLine({ type: "text", text: "Loading kit:tdd now." });
    expect(checkSkillActivation(out, "tdd").activated).toBe(true);
  });

  it("does not match a different skill", () => {
    const out = streamLine({ type: "tool_use", name: "Skill", input: { skill: "stories:plan" } });
    expect(checkSkillActivation(out, "stories:work").activated).toBe(false);
  });

  it("reports no parseable events on empty output", () => {
    const res = checkSkillActivation("", "tdd");
    expect(res.activated).toBe(false);
    expect(res.details).toBe("No parseable events in output");
  });
});
