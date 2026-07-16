/**
 * Detects whether a live agent activated a given skill by inspecting stream-json
 * output for Skill tool calls (preferred) or qualified text mentions.
 *
 * Skill keys may be bare kit names ("tdd") or plugin-namespaced ("stories:work").
 * Bare names belong to the kit plugin.
 */

import { parseStreamJson } from "./stream-json";

export interface ActivationCheck {
  activated: boolean;
  details: string;
}

/** "tdd" → {qualified: "kit:tdd", bare: "tdd"}; "stories:work" → {qualified: "stories:work", bare: "work"} */
function skillNames(skill: string): { qualified: string; bare: string } {
  const i = skill.indexOf(":");
  if (i === -1) return { qualified: `kit:${skill}`, bare: skill };
  return { qualified: skill, bare: skill.slice(i + 1) };
}

export function checkSkillActivation(stdout: string, skill: string): ActivationCheck {
  const events = parseStreamJson(stdout);
  if (events.length === 0)
    return { activated: false, details: "No parseable events in output" };

  const { qualified, bare } = skillNames(skill);

  for (const event of events) {
    if (event.type !== "assistant") continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use" && block.name === "Skill") {
        const invoked = block.input?.skill;
        if (invoked === qualified || invoked === bare)
          return { activated: true, details: `Skill tool called with "${invoked}"` };
      }
    }
  }

  for (const event of events) {
    if (event.type !== "assistant") continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "text" && block.text?.includes(qualified))
        return { activated: true, details: `Found "${qualified}" in assistant text` };
    }
  }

  const toolCalls = events
    .filter((e: any) => e.type === "assistant")
    .flatMap((e: any) => (e.message?.content ?? []).filter((b: any) => b.type === "tool_use"))
    .map((b: any) => `${b.name}(${JSON.stringify(b.input).slice(0, 80)})`);

  return {
    activated: false,
    details: toolCalls.length > 0
      ? `Tools called: ${toolCalls.join(", ")}`
      : "No tool calls found",
  };
}
