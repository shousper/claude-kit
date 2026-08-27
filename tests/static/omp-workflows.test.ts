import { describe, it, expect } from "bun:test";
import { run as runBuildFlow } from "../../plugins/kit-omp/skills/build-flow/build.workflow.mjs";
import { run as runCodeReview } from "../../plugins/kit-omp/skills/code-review/review.workflow.mjs";

// Exercises the bespoke OMP workflow modules (`run(host, args)`, host = { agent, parallel,
// phase, log }) the same way tests/static/build-flow-runner.test.ts exercises the Claude
// build.workflow.js: script agent() responses per role, identified by the runner's own
// prompt text. The one structural difference is the call shape — OMP's agent() takes only
// { agent, label, schema }, never { model, effort } — so every stub below asserts that too.

type AgentOpts = { agent?: string; label?: string; schema?: unknown };

type Run = {
  status?: string;
  reason?: string;
  blockedAtBatch?: number;
  results?: unknown[];
  findings?: Array<{ severity: string; issue: string }>;
  ledger?: { decisions: string[]; conventions: string[]; deviations: string[] };
  verification?: { passed: boolean };
  agentCalls: number;
};

const ALLOWED_AGENTS: Record<string, true> = { "kit-worker": true, "kit-arbiter": true, "kit-verifier": true };

/** Wraps a stub agent() with the shape assertion every call in this file must satisfy:
 *  a resolved OMP agent name, and no model/effort leaking through from the ported Claude
 *  prompts' call sites. */
function assertOmpCallShape(opts?: AgentOpts): void {
  expect(opts?.agent).toBeDefined();
  expect(ALLOWED_AGENTS[opts!.agent as string]).toBe(true);
  expect(opts).not.toHaveProperty("model");
  expect(opts).not.toHaveProperty("effort");
}

// agentImpl lets a test stand in for the implementer agent; by default any agent() call is
// a failure, which proves the guards return BEFORE doing work.
async function runRunner(
  args: unknown,
  agentImpl?: (prompt: string, opts?: AgentOpts) => Promise<unknown>,
): Promise<Run> {
  let agentCalls = 0;
  const agent = async (prompt: string, opts?: AgentOpts) => {
    agentCalls++;
    assertOmpCallShape(opts);
    if (agentImpl) return agentImpl(prompt, opts);
    throw new Error("agent() must not run when there are no batches to build");
  };
  const parallel = async (thunks: Array<() => Promise<unknown>>) => Promise.all(thunks.map((t) => t()));
  const phase = () => {};
  const log = () => {};

  const out = (await runBuildFlow({ agent, parallel, phase, log }, args)) ?? {};
  return { ...(out as object), agentCalls } as Run;
}

describe("build-flow OMP workflow input handling", () => {
  it("blocks (not silently 'done') when args carries no batches", async () => {
    const r = await runRunner({ ledger: { decisions: [], conventions: [], deviations: [] } });
    expect(r.agentCalls).toBe(0);
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/batch/i);
  });

  it("blocks loudly (not silently 'done') on zero batches from a JSON-string args", async () => {
    const r = await runRunner(JSON.stringify({ startBatch: 0, batches: [] }));
    expect(r.agentCalls).toBe(0);
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/batch/i);
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

// --- Execution-flow tests -------------------------------------------------
// Roles are identified by the runner's own prompt text (ported verbatim from
// build.workflow.js), so these break if the ported prompts drift.

type Role = "impl" | "spec" | "quality" | "fix" | "recheck" | "verify" | "verify-fix" | "unknown";
const roleOf = (p: string): Role =>
  p.includes("You are implementing ONE task") ? "impl"
  : p.includes("spec-compliance reviewer") ? "spec"
  : p.includes("code-quality reviewer") ? "quality"
  : p.includes("Reviewers found issues") ? "fix"
  : p.includes("A fix agent just addressed") ? "recheck"
  : p.includes("Final verification for the whole run") ? "verify"
  : p.includes("full-suite verification failed") ? "verify-fix"
  : "unknown";

interface Call { role: Role; prompt: string; opts?: AgentOpts }

type Respond = (
  role: Role,
  ctx: { prompt: string; opts?: AgentOpts; occurrence: number; calls: Call[] },
) => unknown;

async function runFlow(args: unknown, respond: Respond): Promise<Run & { calls: Call[] }> {
  const calls: Call[] = [];
  const r = await runRunner(args, async (prompt, opts) => {
    const role = roleOf(prompt);
    calls.push({ role, prompt, opts });
    const occurrence = calls.filter((c) => c.role === role).length - 1;
    return respond(role, { prompt, opts, occurrence, calls });
  });
  return { ...r, calls };
}

const clean = { approved: true, findings: [] };
const impl = { summary: "done", filesTouched: ["x.ts"], testsPassed: true };
const verified = { passed: true, summary: "all tests pass, lint clean" };
const allClean: Respond = (role) =>
  role === "impl" || role === "fix" || role === "verify-fix" ? impl
  : role === "verify" ? verified
  : clean;

const task = (id: string) => ({ id, title: id.toUpperCase(), prompt: `TASKMARK:${id}` });

describe("build-flow OMP workflow execution flow", () => {
  it("reaches status: 'done' on a clean pass and records it in the ledger", async () => {
    const ledger = { decisions: [], conventions: [], deviations: [] };
    const r = await runFlow({ batches: [[task("a")]], ledger }, allClean);

    expect(r.status).toBe("done");
    expect(r.results).toHaveLength(1);
    expect(r.calls.map((c) => c.role)).toEqual(["impl", "spec", "quality", "verify"]);
    expect(r.ledger?.decisions).toHaveLength(2);
    expect(r.ledger?.decisions[0]).toMatch(/reviewed clean/i);
    expect(r.ledger?.decisions[1]).toMatch(/verification/i);
  });

  it("returns blocked with blockedAtBatch when recheck findings never converge within maxFixRounds", async () => {
    const dirty = { approved: false, findings: [{ severity: "important", issue: "still broken" }] };
    const r = await runFlow(
      { batches: [[task("a")]], maxFixRounds: 2 },
      (role) =>
        role === "impl" || role === "fix" ? impl
        : role === "spec" || role === "recheck" ? dirty
        : role === "verify" ? verified
        : clean,
    );

    expect(r.status).toBe("blocked");
    expect(r.blockedAtBatch).toBe(0);
    expect(r.reason).toMatch(/unresolved/i);
    expect(r.findings?.length).toBeGreaterThan(0);
  });

  it("escalates the fix agent from kit-worker to kit-arbiter on the final fix round", async () => {
    const dirty = { approved: false, findings: [{ severity: "critical", issue: "x" }] };
    const r = await runFlow(
      { batches: [[task("a")]], maxFixRounds: 2 },
      (role) =>
        role === "impl" || role === "fix" ? impl
        : role === "spec" || role === "recheck" ? dirty
        : role === "verify" ? verified
        : clean,
    );

    const fixAgents = r.calls.filter((c) => c.role === "fix").map((c) => c.opts?.agent);
    expect(fixAgents).toEqual(["kit-worker", "kit-arbiter"]);
  });

  it("escalates the quality review to kit-arbiter only on the final batch", async () => {
    const r = await runFlow({ batches: [[task("a")], [task("b")]] }, allClean);

    expect(r.status).toBe("done");
    const quality = r.calls.filter((c) => c.role === "quality");
    expect(quality.map((c) => c.opts?.agent)).toEqual(["kit-worker", "kit-arbiter"]);
  });

  it("runs final verification on kit-verifier and dispatches a kit-worker verify-fix on failure", async () => {
    const r = await runFlow({ batches: [[task("a")]] }, (role, { occurrence }) => {
      if (role === "verify")
        return occurrence === 0
          ? { passed: false, summary: "1 test failing", failures: [{ check: "t1", detail: "x != y" }] }
          : verified;
      return allClean(role, { prompt: "", occurrence, calls: [] });
    });

    expect(r.status).toBe("done");
    const verifyCalls = r.calls.filter((c) => c.role === "verify");
    expect(verifyCalls).toHaveLength(2);
    expect(verifyCalls.every((c) => c.opts?.agent === "kit-verifier")).toBe(true);
    const verifyFix = r.calls.filter((c) => c.role === "verify-fix");
    expect(verifyFix.map((c) => c.opts?.agent)).toEqual(["kit-worker"]);
    expect(r.verification?.passed).toBe(true);
  });

  it("blocks immediately when an implementer needs human input, before any review", async () => {
    const r = await runFlow({ batches: [[task("a")]] }, (role) =>
      role === "impl" ? { needsHumanInput: { reason: "task is ambiguous" } } : impl,
    );

    expect(r.status).toBe("blocked");
    expect(r.blockedAtBatch).toBe(0);
    expect(r.reason).toBe("task is ambiguous");
    expect(r.calls.every((c) => c.role === "impl")).toBe(true);
  });

  it("blocks (not crashes) when a batch is an object instead of a task array", async () => {
    const r = await runFlow({ batches: [{ index: 0, tasks: [task("a")] }] }, allClean);

    expect(r.agentCalls).toBe(0);
    expect(r.status).toBe("blocked");
    expect(r.blockedAtBatch).toBe(0);
    expect(r.reason).toMatch(/array/i);
  });

  it("observes ONLY kit-worker/kit-arbiter/kit-verifier agent names, never model/effort, across a full run", async () => {
    const r = await runFlow({ batches: [[task("a")], [task("b")]] }, allClean);

    expect(r.status).toBe("done");
    expect(r.calls.length).toBeGreaterThan(0);
    for (const call of r.calls) {
      expect(ALLOWED_AGENTS[call.opts?.agent as string]).toBe(true);
      expect(call.opts).not.toHaveProperty("model");
      expect(call.opts).not.toHaveProperty("effort");
    }
  });
});

// --- Code-review workflow -------------------------------------------------

describe("code-review OMP workflow", () => {
  it("returns { diffRef, findings }: fans dimensions to kit-worker (kit-arbiter for architecture) and keeps only verified findings", async () => {
    const calls: Array<{ prompt: string; opts?: AgentOpts }> = [];
    const agent = async (prompt: string, opts?: AgentOpts) => {
      calls.push({ prompt, opts });
      assertOmpCallShape(opts);
      if (prompt.startsWith("Review the diff")) {
        if (prompt.includes('"correctness"')) {
          return { findings: [{ severity: "critical", issue: "off-by-one", file: "a.ts", line: 5 }] };
        }
        if (prompt.includes('"quality"')) {
          return { findings: [{ severity: "minor", issue: "unverified nit" }] };
        }
        return { findings: [] };
      }
      if (prompt.startsWith("Adversarially check")) {
        return { real: prompt.includes("off-by-one") };
      }
      throw new Error(`unexpected prompt: ${prompt}`);
    };
    const parallel = async (thunks: Array<() => Promise<unknown>>) => Promise.all(thunks.map((t) => t()));

    const result = (await runCodeReview({ agent, parallel, phase: () => {}, log: () => {} }, { diffRef: "main" })) as {
      diffRef: string;
      findings: Array<{ dimension: string; verified: boolean }>;
    };

    expect(result.diffRef).toBe("main");
    expect(result.findings).toEqual([
      { severity: "critical", issue: "off-by-one", file: "a.ts", line: 5, dimension: "correctness", verified: true },
    ]);

    const reviewCalls = calls.filter((c) => c.prompt.startsWith("Review the diff"));
    expect(reviewCalls.map((c) => c.opts?.agent)).toEqual([
      "kit-worker", "kit-worker", "kit-worker", "kit-worker", "kit-arbiter",
    ]);
  });

  it("drops unverified findings and defaults diffRef to main", async () => {
    const agent = async (prompt: string) => {
      if (prompt.startsWith("Review the diff")) return { findings: [{ severity: "minor", issue: "nit" }] };
      if (prompt.startsWith("Adversarially check")) return { real: false };
      throw new Error("unexpected prompt");
    };
    const parallel = async (thunks: Array<() => Promise<unknown>>) => Promise.all(thunks.map((t) => t()));

    const result = (await runCodeReview({ agent, parallel }, {})) as { diffRef: string; findings: unknown[] };

    expect(result.diffRef).toBe("main");
    expect(result.findings).toEqual([]);
  });
});
