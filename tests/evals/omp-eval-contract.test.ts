import { describe, it, expect } from "bun:test";
import { runEval } from "../utils/eval-runner";
import { omp } from "../utils/harness/omp";

// Fingerprints the eval-kernel contract build.workflow.mjs and review.workflow.mjs bind to.
// When OMP replaced `parallel()` + result-returning agent() with handle-returning agent() +
// wait(), every build-flow launch died with "parallel is not defined" and nothing in this
// repo noticed for a week: the static tests mocked the old contract. This runs the real
// kernel and fails the moment any of these facts change.

const RUN_EVALS = process.env.RUN_EVALS === "1";
const TIMEOUT = 180_000;

const CELL = `
const line = ["CONTRACT",
  "parallel=" + typeof parallel,
  "agent=" + typeof agent,
  "wait=" + typeof wait,
  "read=" + typeof read,
  "write=" + typeof write,
].join(" ");
const h = await agent("Reply with exactly the single word: pong. Call no tools.", { agent: "scout", label: "canary" });
console.log(line
  + " handle.wait=" + typeof h.wait
  + " handle.cancel=" + typeof h.cancel
  + " handle.id=" + (h.id === "canary"));
await h.wait({ timeout: 120 });
const h2 = await agent("Wait in a loop for 10 seconds.", { agent: "scout" });
let timeoutErr = "none";
try {
  await h2.wait({ timeout: 1 });
} catch (err) {
  timeoutErr = err.name;
}
console.log("timeout=" + timeoutErr);
if (h2.cancel) h2.cancel();
`;

const PROMPT =
  "Run exactly ONE eval cell with language js containing the code between the two ---- lines, " +
  "verbatim and unmodified, then reply with everything the cell printed (both console.log lines) " +
  "verbatim and nothing else. Do not read any files, do not call any other tool.\n----\n" + CELL + "\n----";

const EXPECTED =
  /CONTRACT parallel=undefined agent=function wait=function read=function write=function handle\.wait=function handle\.cancel=function handle\.id=true.*timeout=TimeoutError/s;

describe.skipIf(!RUN_EVALS)("omp eval-kernel contract", () => {
  it(
    "exposes handle-returning agent() with wait(), and no parallel()",
    async () => {
      const result = await runEval(omp, PROMPT, {
        timeout: TIMEOUT,
        ephemeral: true,
        dangerouslySkipPermissions: true,
      });
      expect(result.stdout, `stderr: ${result.stderr.slice(0, 400)}`).toMatch(EXPECTED);
    },
    TIMEOUT * omp.timeoutScale + 30_000,
  );
});
