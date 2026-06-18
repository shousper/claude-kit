import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { SKILLS_DIR } from "../utils/paths";

// The bundled runner is authored against the Workflow runtime, which injects globals
// (args, agent, parallel, phase, log), supports top-level await, and allows a top-level
// `return`. We replicate that contract here by compiling the source into an AsyncFunction
// so we can exercise the runner's input-handling and early-exit guards WITHOUT spawning
// real agents. This guards the failure that broke the first real build-flow run: `args`
// passed as a JSON string -> zero batches -> a silent `done` that looked like success.

const SRC = readFileSync(
  resolve(SKILLS_DIR, "build-flow", "build.workflow.js"),
  "utf-8",
).replace("export const meta", "const meta"); // `export` is illegal inside a Function body

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<any>;

type Run = { status?: string; reason?: string; results?: unknown[]; agentCalls: number };

// agentImpl lets a test stand in for the implementer agent; by default any agent() call is
// a failure, which proves the guards return BEFORE doing work.
async function runRunner(
  args: unknown,
  agentImpl?: (prompt: string) => Promise<unknown>,
): Promise<Run> {
  let agentCalls = 0;
  const agent = async (prompt: string) => {
    agentCalls++;
    if (agentImpl) return agentImpl(prompt);
    throw new Error("agent() must not run when there are no batches to build");
  };
  const parallel = async (thunks: Array<() => Promise<unknown>>) =>
    Promise.all(thunks.map((t) => t()));
  const phase = () => {};
  const log = () => {};

  const fn = new AsyncFunction("args", "agent", "parallel", "phase", "log", SRC);
  const out = (await fn(args, agent, parallel, phase, log)) ?? {};
  return { ...(out as object), agentCalls } as Run;
}

describe("build-flow runner input handling", () => {
  it("blocks (not silently 'done') when args carries no batches", async () => {
    const r = await runRunner({ ledger: { decisions: [], conventions: [], deviations: [] } });
    expect(r.agentCalls).toBe(0);
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/batch/i);
  });

  it("blocks when args is a JSON string that parses to no batches", async () => {
    const r = await runRunner(JSON.stringify({ startBatch: 0, batches: [] }));
    expect(r.agentCalls).toBe(0);
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/batch/i);
  });

  it("blocks with a clear reason when args is a non-JSON string", async () => {
    const r = await runRunner("not valid json {");
    expect(r.agentCalls).toBe(0);
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/json|string|object/i);
  });

  it("normalizes a JSON-string args and runs the parsed batch", async () => {
    const args = JSON.stringify({
      batches: [[{ id: "t1", title: "T1", prompt: "implement the resource group" }]],
    });
    let seen = "";
    const r = await runRunner(args, async (prompt) => {
      seen = prompt;
      return { needsHumanInput: { reason: "halt for test" } }; // stop after first agent
    });
    expect(r.agentCalls).toBe(1);
    expect(seen).toContain("implement the resource group");
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("halt for test");
  });
});
