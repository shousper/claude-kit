import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { checkSkillActivation } from "../utils/skill-activation";
import { claude } from "../utils/harness/claude";
import { omp } from "../utils/harness/omp";
import { ROOT } from "../utils/paths";

const CLAUDE_FIXTURE = readFileSync(resolve(ROOT, "tests/fixtures/events/claude-skill-activation.jsonl"), "utf-8");
const OMP_FIXTURE = readFileSync(resolve(ROOT, "tests/fixtures/events/omp-skill-activation.jsonl"), "utf-8");

interface ContentBlock {
  type: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
}

function streamLine(block: ContentBlock): string {
  return JSON.stringify({ type: "assistant", message: { content: [block] } });
}

describe("checkSkillActivation", () => {
  it("detects activation for claude via the Skill tool call fixture", () => {
    const result = checkSkillActivation(claude, CLAUDE_FIXTURE, "tdd");
    expect(result.activated).toBe(true);
    expect(result.invalid).toBe(false);
  });

  it("detects activation for omp via the skill:// read fixture", () => {
    const result = checkSkillActivation(omp, OMP_FIXTURE, "tdd");
    expect(result.activated).toBe(true);
    expect(result.invalid).toBe(false);
  });

  it("matches a bare kit skill invoked bare", () => {
    const out = streamLine({ type: "tool_use", name: "Skill", input: { skill: "tdd" } });
    expect(checkSkillActivation(claude, out, "tdd").activated).toBe(true);
  });

  it("matches a bare kit skill invoked namespaced", () => {
    const out = streamLine({ type: "tool_use", name: "Skill", input: { skill: "kit:tdd" } });
    expect(checkSkillActivation(claude, out, "tdd").activated).toBe(true);
  });

  it("matches a namespaced stories skill invoked namespaced", () => {
    const out = streamLine({ type: "tool_use", name: "Skill", input: { skill: "stories:work" } });
    expect(checkSkillActivation(claude, out, "stories:work").activated).toBe(true);
  });

  it("matches a namespaced stories skill invoked bare", () => {
    const out = streamLine({ type: "tool_use", name: "Skill", input: { skill: "work" } });
    expect(checkSkillActivation(claude, out, "stories:work").activated).toBe(true);
  });

  it("falls back to the fully-qualified name in assistant text", () => {
    const out = streamLine({ type: "text", text: "I'll use stories:work for this." });
    expect(checkSkillActivation(claude, out, "stories:work").activated).toBe(true);
  });

  it("text fallback searches the kit-qualified name for bare skills", () => {
    const out = streamLine({ type: "text", text: "Loading kit:tdd now." });
    expect(checkSkillActivation(claude, out, "tdd").activated).toBe(true);
  });

  it("does not match a different skill", () => {
    const out = streamLine({ type: "tool_use", name: "Skill", input: { skill: "stories:plan" } });
    expect(checkSkillActivation(claude, out, "stories:work").activated).toBe(false);
  });

  it("reports no parseable events on empty output", () => {
    const res = checkSkillActivation(claude, "", "tdd");
    expect(res.activated).toBe(false);
    expect(res.invalid).toBe(false);
    expect(res.details).toBe("No parseable events in output");
  });

  it("invalidates a run that silently changed model", () => {
    const stdout = '{"type":"retry_fallback_applied","from":"anthropic/claude-sonnet-4-5","to":"xai-oauth/grok-build"}';
    expect(checkSkillActivation(omp, stdout, "tdd").invalid).toBe(true);
  });
});
