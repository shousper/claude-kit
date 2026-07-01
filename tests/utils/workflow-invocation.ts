/**
 * Validates that an agent invoked the build-flow workflow *correctly*, by inspecting the
 * `Workflow` tool call it emitted in stream-json output.
 *
 * This encodes the launch contract the skill teaches (skills/build-flow/SKILL.md) and that
 * `build.workflow.js` enforces — the exact shape agents were observed getting wrong:
 *   - `batches` is a non-empty array of *arrays* of tasks (NOT objects like { index, tasks }),
 *   - each task carries id/title/prompt,
 *   - no `run_in_background` param (Workflow always runs in background),
 *   - args is an object or a valid JSON string of one (the runner normalizes either).
 */

export interface InvocationCheck {
  /** An assistant `Workflow` tool call was emitted. */
  invoked: boolean;
  /** That call matches the launch contract. */
  valid: boolean;
  /** Human-readable explanation for reporting. */
  details: string;
}

/** Parse stream-json (NDJSON) into event objects, skipping unparseable lines. */
export function parseStreamJson(stdout: string): any[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

/** Every `Workflow` tool_use input the assistant emitted, in order. */
export function findWorkflowCalls(stdout: string): any[] {
  return parseStreamJson(stdout)
    .filter((e) => e.type === "assistant")
    .flatMap((e) => (e.message?.content ?? []) as any[])
    .filter((b) => b.type === "tool_use" && b.name === "Workflow")
    .map((b) => b.input ?? {});
}

function targetsBuildFlow(input: any): boolean {
  if (typeof input.scriptPath === "string" && input.scriptPath.includes("build.workflow.js")) return true;
  // Inline script fallback: the bundled runner's meta name.
  if (typeof input.script === "string" && input.script.includes("build-flow-batch-runner")) return true;
  return false;
}

/** Validate a single Workflow call input against the launch contract. */
function validateCall(input: any): { valid: boolean; details: string } {
  if ("run_in_background" in input)
    return { valid: false, details: "passed run_in_background — Workflow has no such param and rejects it" };

  if (!targetsBuildFlow(input))
    return { valid: false, details: "call does not target build.workflow.js (scriptPath/script)" };

  let args = input.args;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch (e) {
      return { valid: false, details: `args is a string that is not valid JSON (${(e as Error).message})` };
    }
  }
  if (args == null || typeof args !== "object")
    return { valid: false, details: "args is missing or not an object" };

  const batches = args.batches;
  if (!Array.isArray(batches) || batches.length === 0)
    return { valid: false, details: "args.batches is missing, empty, or not an array" };

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    if (!Array.isArray(batch))
      return { valid: false, details: `batch ${b} is not an array of tasks (mis-shaped as an object?)` };
    if (batch.length === 0)
      return { valid: false, details: `batch ${b} has no tasks` };
    for (const t of batch) {
      if (!t || typeof t !== "object")
        return { valid: false, details: `batch ${b} contains a non-object task` };
      for (const field of ["id", "title", "prompt"] as const) {
        if (typeof t[field] !== "string" || t[field].trim() === "")
          return { valid: false, details: `a task in batch ${b} is missing "${field}"` };
      }
    }
  }

  const taskCount = batches.reduce((n: number, batch: any[]) => n + batch.length, 0);
  return { valid: true, details: `valid launch: ${batches.length} batch(es), ${taskCount} task(s)` };
}

export function checkWorkflowInvocation(stdout: string): InvocationCheck {
  const calls = findWorkflowCalls(stdout);
  if (calls.length === 0)
    return { invoked: false, valid: false, details: "No Workflow tool call found" };

  const results = calls.map(validateCall);
  const good = results.find((r) => r.valid);
  if (good) return { invoked: true, ...good };
  // No valid call — report the last attempt's reason (the agent's best/final try).
  return { invoked: true, ...results[results.length - 1] };
}
