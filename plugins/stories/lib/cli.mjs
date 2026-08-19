// plugins/stories/lib/cli.mjs — arg parsing + subcommand dispatch.
//
// Conventions (binding for every command):
//   --json      → machine-readable result on stdout
//   any error   → {"error": "..."} JSON on stderr, exit 1
//   exit 0      → the printed result is trustworthy
//
// The COMMANDS registry is the extension seam: section C registers `loop`,
// section E swaps the merge:"pr" branch in cmdDone for github.mjs.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative, resolve } from "node:path";
import { CliError, nowISO, run, todayISO, writeFileAtomic } from "./util.mjs";
import { runLoopCommand } from "./loop.mjs";
import * as board from "./board.mjs";
import { appendToSection, loadConfig, setSection } from "./board.mjs";
import * as worktrees from "./worktrees.mjs";
import * as gatesMod from "./gates.mjs";
import { withLock } from "./locks.mjs";
import { runDoctor } from "./doctor.mjs";

// Re-export the domain helpers that used to live here so existing importers
// (tests, and — historically — github.mjs) keep working while the definitions
// live in board.mjs. github.mjs/loop.mjs now import them from board directly.
export { appendToSection, loadConfig, setSection } from "./board.mjs";

const LIST_FLAGS = new Set(["depends-on", "touches", "gates"]);
const MERGE_MODES = ["self", "local", "pr"];

export function parseArgv(argv) {
  const [cmd, ...rest] = argv;
  const positionals = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    let key = arg.slice(2);
    let value;
    const eq = key.indexOf("=");
    if (eq !== -1) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (rest[i + 1] !== undefined && !rest[i + 1].startsWith("--") && !BOOL_FLAGS.has(key)) {
      value = rest[++i];
    }
    if (value === undefined) {
      flags[key] = true;
      continue;
    }
    if (!LIST_FLAGS.has(key)) {
      flags[key] = value;
      continue;
    }
    flags[key] = [...(flags[key] ?? []), ...value.split(",").map((s) => s.trim()).filter(Boolean)];
  }
  return { cmd, positionals, flags };
}

// Flags that never take a value (so a following positional is not swallowed).
const BOOL_FLAGS = new Set(["json", "quiet", "fix", "exclusive", "backlog"]);

/**
 * Resolve the MAIN checkout root from any cwd — including from inside a
 * story worktree (.worktrees/<id>), where the board and locks must still
 * target the primary working tree. `--git-common-dir` points at the main
 * .git from both.
 */
export function findRoot(cwd, exec = run) {
  const r = exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
  if (r.code !== 0) throw new CliError("not inside a git repository");
  const root = dirname(r.stdout.trim());
  if (!existsSync(join(root, ".claude", "story-workflow.json"))) {
    throw new CliError("no .claude/story-workflow.json found — run stories:setup (or `story init`) first");
  }
  return root;
}

function output(ctx, data, humanLines) {
  ctx.stdout.write(ctx.json ? `${JSON.stringify(data, null, 2)}\n` : `${humanLines.join("\n")}\n`);
}

// ---------------------------------------------------------------- init

// Canonical project-side ignore block (ratified decision) — MUST stay
// byte-identical across the four writers: cmdInit (here), the stories:setup
// skill (Section D2), the eval fixture (F3), and the README (F6).
const GITIGNORE_BLOCK = ".worktrees/\n.claude/*.local.*\n.claude/locks/\n.claude/story-evidence/\n";

async function cmdInit(ctx) {
  const r = ctx.exec("git", ["rev-parse", "--show-toplevel"], { cwd: ctx.cwd });
  if (r.code !== 0) throw new CliError("story init must run inside a git repository");
  const root = r.stdout.trim();
  const cfgPath = join(root, ".claude", "story-workflow.json");
  if (existsSync(cfgPath)) throw new CliError(".claude/story-workflow.json already exists");
  const config = typeof ctx.flags.config === "string" ? initConfigFromFile(ctx) : initConfigFromFlags(ctx);
  if (config.merge === "pr") {
    // Dynamic import (ratified cycle rule): cli.mjs must not import github.mjs statically.
    const { ensurePrRequirements } = await import("./github.mjs");
    const probe = await ensurePrRequirements(root, { exec: ctx.exec });
    if (!probe.ok) {
      throw new CliError(`pr mode prerequisites failed: ${probe.problems.join("; ")}`);
    }
  }
  writeFileAtomic(cfgPath, `${JSON.stringify(config, null, 2)}\n`);
  mkdirSync(join(board.storiesDir(root, config), "archive"), { recursive: true });
  appendFileSync(join(root, ".gitignore"), `\n${GITIGNORE_BLOCK}`);
  output(ctx, { ok: true, config: cfgPath }, [`initialized story workflow at ${cfgPath}`]);
}

function initConfigFromFlags(ctx) {
  const merge = ctx.flags.merge ?? "self";
  if (!MERGE_MODES.includes(merge)) {
    throw new CliError(`--merge must be one of ${MERGE_MODES.join("|")}, got '${merge}'`);
  }
  return {
    version: 1,
    storiesDir: "stories",
    merge,
    baseBranch: ctx.flags["base-branch"] ?? "main",
    gates: { test: { kind: "command", run: ctx.flags["test-command"] ?? "npm test" } },
    defaults: { feature: ["test"], bug: ["test"], chore: [] },
    gateLock: true,
    budgets: { maxIterations: 10, maxFixRoundsPerStory: 3 },
  };
}

/**
 * --config <answers.json>: the stories:setup interview (Section D2) writes
 * its answers to a file and hands it here VERBATIM — validated, never merged
 * with the flag-mode defaults. This is the only way to express review gates,
 * per-type gate defaults beyond the built-ins, and custom budgets at init.
 */
function initConfigFromFile(ctx) {
  if (ctx.flags.merge !== undefined || ctx.flags["base-branch"] !== undefined || ctx.flags["test-command"] !== undefined) {
    throw new CliError("--config cannot be combined with --merge/--base-branch/--test-command");
  }
  let config;
  try {
    config = JSON.parse(readFileSync(resolve(ctx.cwd, ctx.flags.config), "utf8"));
  } catch (err) {
    throw new CliError(`unreadable --config file: ${err.message}`);
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new CliError("--config must contain a JSON object");
  }
  if (!MERGE_MODES.includes(config.merge)) {
    throw new CliError(`config.merge must be one of ${MERGE_MODES.join("|")}, got '${config.merge}'`);
  }
  const gates = config.gates ?? {};
  for (const [name, def] of Object.entries(gates)) {
    if (def?.kind === "command" && typeof def.run === "string") continue;
    if (def?.kind === "review") continue;
    throw new CliError(`config.gates.${name}: kind must be "command" (with a run string) or "review"`);
  }
  for (const [type, names] of Object.entries(config.defaults ?? {})) {
    if (!Array.isArray(names)) throw new CliError(`config.defaults.${type} must be an array of gate names`);
    for (const name of names) {
      if (!gates[name]) throw new CliError(`config.defaults.${type} names undefined gate '${name}'`);
    }
  }
  for (const [key, value] of Object.entries(config.budgets ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new CliError(`config.budgets.${key} must be a number`);
    }
  }
  return config;
}

// ---------------------------------------------------------------- create

const DEFAULT_BODY = `
## Description

## Acceptance Criteria

- [ ] …

## Implementation Plan

## Implementation Notes

## Questions
`;

async function cmdCreate(ctx) {
  const root = findRoot(ctx.cwd, ctx.exec);
  const config = loadConfig(root);
  if (typeof ctx.flags.title !== "string" || !ctx.flags.title.trim()) {
    throw new CliError("--title is required");
  }
  const body = ctx.flags["body-file"]
    ? readFileSync(resolve(ctx.cwd, ctx.flags["body-file"]), "utf8")
    : DEFAULT_BODY;
  const story = await withLock(root, "board", () => {
    const all = board.loadStories(root, config, { includeArchive: true });
    const s = board.applyDefaults({
      id: board.generateId(all.map((x) => x.id)),
      title: ctx.flags.title,
      type: ctx.flags.type,
      epic: ctx.flags.epic,
      status: ctx.flags.backlog === true ? "backlog" : undefined,
      priority: ctx.flags.priority,
      complexity: ctx.flags.complexity !== undefined ? board.assertComplexity(ctx.flags.complexity) : undefined,
      depends_on: ctx.flags["depends-on"],
      discovered_from: ctx.flags["discovered-from"],
      touches: ctx.flags.touches,
      exclusive: ctx.flags.exclusive === true,
      gates: ctx.flags.gates,
      body,
    });
    for (const dep of s.depends_on) board.getStory(all, dep);
    for (const g of s.gates ?? []) {
      if (!(config.gates ?? {})[g]) {
        throw new CliError(`unknown gate '${g}' — define it in .claude/story-workflow.json`);
      }
    }
    return board.saveStory(root, config, s);
  });
  output(ctx, { id: story.id, file: story.file }, [story.id]);
}

// ---------------------------------------------------------------- ready/claim

function baseBranch(config) {
  return config.baseBranch ?? "main";
}

/**
 * Design §7 advisory: when an active story's ACTUAL diff has grown beyond its
 * declared touches into another active story's territory (declared ∪ actual),
 * warn on stderr and append an Implementation Note to the expanding story —
 * once per story pair, never halting anything. Correctness still comes from
 * merge-conflict handling + gates + review.
 */
async function warnTouchesExpansion(ctx, root, config, stories, diffs) {
  const active = stories.filter((s) => s.status === "in-progress" || s.status === "in-review");
  for (const a of active) {
    const expansion = (diffs.get(a.id) ?? []).filter((p) => !board.touchesOverlap([p], a.touches ?? []));
    if (!expansion.length) continue;
    for (const b of active) {
      if (b.id === a.id) continue;
      const overlap = expansion.filter((p) =>
        board.touchesOverlap([p], [...(b.touches ?? []), ...(diffs.get(b.id) ?? [])]),
      );
      const marker = `touches-expansion: overlaps ${b.id}`;
      if (!overlap.length || a.body.includes(marker)) continue;
      ctx.stderr.write(`warning: ${a.id} actual diff expanded into ${b.id}'s territory: ${overlap.join(", ")}\n`);
      await withLock(root, "board", () => {
        const fresh = board.getStory(board.loadStories(root, config), a.id);
        if (fresh.body.includes(marker)) return; // raced another warner
        board.saveStory(root, config, {
          ...fresh,
          updated: todayISO(),
          body: appendToSection(
            fresh.body,
            "## Implementation Notes",
            `- ${nowISO()}: ${marker} (${overlap.join(", ")}) — coordinate or split`,
          ),
        });
      });
    }
  }
}

async function cmdReady(ctx) {
  const root = findRoot(ctx.cwd, ctx.exec);
  const config = loadConfig(root);
  const stories = board.loadStories(root, config, { includeArchive: true });
  const diffs = worktrees.activeDiffs(root, config, stories, ctx.exec);
  await warnTouchesExpansion(ctx, root, config, stories, diffs);
  const ready = board.computeReady(stories, { diffs }).map((s) => ({ ...s, priority: s.priority ?? "P2" }));
  output(
    ctx,
    ready.map((s) => ({ id: s.id, title: s.title, priority: s.priority, feedback: s.feedback === true })),
    ready.length
      ? ready.map((s) => `${s.id}  ${s.priority}  ${s.feedback === true ? "[feedback] " : ""}${s.title}`)
      : ["(nothing ready)"],
  );
}

async function cmdClaim(ctx) {
  const [id] = ctx.positionals;
  if (!id) throw new CliError("usage: story claim <id>");
  const root = findRoot(ctx.cwd, ctx.exec);
  const config = loadConfig(root);
  const session = ctx.flags.session ?? ctx.env.CLAUDE_SESSION_ID ?? randomUUID();
  // Create-first ordering (Stage 3): the board is only mutated AFTER the
  // worktree exists, so a createWorktree failure (dirty base, disk, ref
  // collision) can never strand the story in-progress with a live claim and
  // no worktree. The readiness gate + transition check still run under the
  // board lock; the worktree is built between that check and the write, and
  // torn back down if the write itself fails. computeReady already treats a
  // pre-existing worktree/branch as claimable (feedback + stale-lease rounds),
  // so building it before the write does not change who may claim.
  const worktree = await withLock(root, "board", () => {
    const stories = board.loadStories(root, config, { includeArchive: true });
    const story = board.getStory(stories, id);
    const diffs = worktrees.activeDiffs(root, config, stories, ctx.exec, id);
    if (!board.computeReady(stories, { diffs }).some((s) => s.id === id)) {
      throw new CliError(
        `story ${id} is not ready (unfinished deps, touches conflict, already claimed, or wrong status) — run \`story ready\``,
      );
    }
    board.assertTransition(story.status, "in-progress");
    const preexisting = existsSync(worktrees.worktreePath(root, id));
    const path = worktrees.createWorktree(root, id, { exec: ctx.exec, base: baseBranch(config) });
    const next = { ...story, status: "in-progress", claim: { session, lease: nowISO() }, updated: todayISO() };
    delete next.feedback; // claiming a feedback item consumes the flag
    try {
      board.saveStory(root, config, next);
    } catch (err) {
      // The board write failed AFTER we created the worktree — tear the fresh
      // worktree back down so we do not leave an orphan behind a story that is
      // still todo/in-review. Only when WE just created it: a claim that reused
      // an existing worktree (feedback/stale-lease round) leaves the in-flight
      // branch's contents alone. Best-effort: surface the original write error.
      if (!preexisting) {
        try {
          worktrees.teardown(root, id, { exec: ctx.exec });
        } catch {
          /* teardown is best-effort; the original write error is what matters */
        }
      }
      throw err;
    }
    return path;
  });
  output(
    ctx,
    { id, worktree, branch: worktrees.branchName(id), session },
    [`claimed ${id} → ${worktree} (branch ${worktrees.branchName(id)})`],
  );
}

// ---------------------------------------------------------------- update/note/park

/**
 * Board mutation on one story under the board lock; fn edits a copy. Delegates
 * to board.mutateStory with heartbeat: true — worker mutations refresh the
 * claim.lease (the sweep's mutateBoard does not).
 */
async function mutateStory(ctx, id, fn) {
  const root = findRoot(ctx.cwd, ctx.exec);
  return board.mutateStory(root, loadConfig(root), id, fn, { heartbeat: true });
}

const SCALAR_UPDATES = { title: "title", type: "type", epic: "epic", "discovered-from": "discovered_from" };

async function cmdUpdate(ctx) {
  const [id] = ctx.positionals;
  if (!id) throw new CliError("usage: story update <id> --<field> <value> …");
  const story = await mutateStory(ctx, id, (s) => {
    const wasInProgress = s.status === "in-progress";
    if (ctx.flags.status !== undefined) {
      board.assertTransition(s.status, ctx.flags.status);
      s.status = ctx.flags.status;
      // A claim only survives while in-progress. Entering in-review clears it
      // (ratified: ownership is the branch/pr record; feedback pickup needs !claim).
      if (s.status !== "in-progress") delete s.claim;
    }
    for (const [flag, field] of Object.entries(SCALAR_UPDATES)) {
      if (ctx.flags[flag] !== undefined) s[field] = ctx.flags[flag];
    }
    if (ctx.flags.priority !== undefined) {
      if (!board.PRIORITIES.includes(ctx.flags.priority)) {
        throw new CliError(`priority must be one of ${board.PRIORITIES.join(", ")}`);
      }
      s.priority = ctx.flags.priority;
    }
    if (ctx.flags.complexity !== undefined) {
      if (wasInProgress) {
        // Complexity selects the planner model tier (plan.workflow.js). Locking
        // it during work makes "downgrade the planner" unreachable from inside
        // the worker loop — changing the tier is a board decision, made with a
        // human, on a story that is not being worked.
        throw new CliError(
          `complexity is set at board approval and locked while in-progress — release the story first (story update ${s.id} --status todo) and ask your human partner`,
        );
      }
      const next = board.assertComplexity(ctx.flags.complexity);
      // In-progress lock alone isn't enough: `story park` legally clears the
      // claim and drops status to blocked, and blocked→todo is a legal
      // transition — so unpark-then-downgrade-then-reclaim would otherwise
      // re-plan a parked story on a cheaper tier with no human in the loop.
      // cmdPark stamps `parked_complexity` with the highest tier ever
      // attempted; a downgrade below it is refused until a human explicitly
      // clears the lock with --clear-park-lock.
      if (s.parked_complexity !== undefined && ctx.flags["clear-park-lock"] !== true) {
        const nextIdx = board.COMPLEXITIES.indexOf(next);
        const lockedIdx = board.COMPLEXITIES.indexOf(s.parked_complexity);
        if (nextIdx < lockedIdx) {
          throw new CliError(
            `${s.id} was parked at complexity '${s.parked_complexity}' — downgrading below that tier needs a human decision: re-run with --clear-park-lock once your human partner has reviewed the park question`,
          );
        }
      }
      s.complexity = next;
      if (ctx.flags["clear-park-lock"] === true) delete s.parked_complexity;
    }
    if (ctx.flags["depends-on"] !== undefined) s.depends_on = ctx.flags["depends-on"];
    if (ctx.flags.touches !== undefined) s.touches = ctx.flags.touches;
    if (ctx.flags.gates !== undefined) s.gates = ctx.flags.gates;
    if (ctx.flags.exclusive !== undefined) s.exclusive = ctx.flags.exclusive === true || ctx.flags.exclusive === "true";
    if (ctx.flags.feedback !== undefined) {
      if (ctx.flags.feedback === "false") delete s.feedback;
      else s.feedback = true;
    }
    if (typeof ctx.flags["plan-file"] === "string") {
      const plan = readFileSync(resolve(ctx.cwd, ctx.flags["plan-file"]), "utf8");
      s.body = setSection(s.body, "## Implementation Plan", plan.trim());
    }
  });
  output(ctx, { id: story.id, status: story.status }, [`updated ${story.id}`]);
}

async function cmdNote(ctx) {
  const [id] = ctx.positionals;
  if (!id || typeof ctx.flags.body !== "string") throw new CliError("usage: story note <id> --body <text>");
  await mutateStory(ctx, id, (s) => {
    s.body = appendToSection(s.body, "## Implementation Notes", `- ${nowISO()}: ${ctx.flags.body}`);
  });
  output(ctx, { id, noted: true }, [`noted on ${id}`]);
}

async function cmdPark(ctx) {
  const [id] = ctx.positionals;
  if (!id || typeof ctx.flags.question !== "string") {
    throw new CliError("usage: story park <id> --question <text>");
  }
  await mutateStory(ctx, id, (s) => {
    board.assertTransition(s.status, "blocked");
    s.status = "blocked";
    delete s.claim; // park-and-continue: the worker moves on, the lease must not go stale
    // Stamp the tier the planner was actually attempted at. `story update`
    // refuses to downgrade complexity below this until a human clears it —
    // closes the unpark→downgrade→reclaim loophole (see cmdUpdate). Keep the
    // highest tier ever attempted across repeated park cycles.
    const attempted = s.complexity ?? "routine";
    if (s.parked_complexity === undefined || board.COMPLEXITIES.indexOf(attempted) > board.COMPLEXITIES.indexOf(s.parked_complexity)) {
      s.parked_complexity = attempted;
    }
    s.body = appendToSection(s.body, "## Questions", `- ${nowISO()}: ${ctx.flags.question}`);
  });
  output(ctx, { id, status: "blocked" }, [`parked ${id} — question recorded`]);
}

// ---------------------------------------------------------------- record

async function cmdRecord(ctx) {
  const [id] = ctx.positionals;
  const { gate, verdict, evidence } = ctx.flags;
  if (!id || typeof gate !== "string" || typeof verdict !== "string") {
    throw new CliError("usage: story record <id> --gate <name> --verdict pass|fail [--evidence <path>]");
  }
  const root = findRoot(ctx.cwd, ctx.exec);
  const config = loadConfig(root);
  board.getStory(board.loadStories(root, config), id); // must exist
  const def = (config.gates ?? {})[gate];
  if (!def || def.kind !== "review") {
    throw new CliError(`'${gate}' is not a review gate in .claude/story-workflow.json`);
  }
  const record = gatesMod.recordVerdict(root, id, {
    gate,
    verdict,
    evidence: typeof evidence === "string" ? evidence : undefined,
    session: ctx.env.CLAUDE_SESSION_ID,
  });
  output(ctx, record, [`recorded ${gate}=${verdict} for ${id}`]);
}

// ---------------------------------------------------------------- done

/**
 * The evidence gate (design §7): run every command gate in the worktree,
 * require a recorded pass verdict for every review gate, write the evidence
 * file, reconcile touches to the actual diff — and only then integrate per
 * merge mode. Closing a story on the model's say-so is impossible by
 * construction.
 */
async function cmdDone(ctx) {
  const [id] = ctx.positionals;
  if (!id) throw new CliError("usage: story done <id>");
  const root = findRoot(ctx.cwd, ctx.exec);
  const config = loadConfig(root);
  const base = config.baseBranch ?? "main";
  const story = board.getStory(board.loadStories(root, config), id);
  if (story.status === "done") {
    // Idempotent close: a retry after a crash-between-merge-and-write (or a
    // duplicated done) must succeed, not die on `illegal transition done → done`.
    output(ctx, { id, status: "done", already: true }, [`${id} already done — nothing to do`]);
    return;
  }
  if (story.status !== "in-progress") {
    throw new CliError(`story ${id} is '${story.status}', expected in-progress`);
  }
  const worktree = worktrees.worktreePath(root, id);
  if (!existsSync(worktree)) throw new CliError(`no worktree at ${worktree} — claim the story first`);

  // 0. Committed-work guard. Gates certify the WORKING TREE, but integration
  // merges the BRANCH — uncommitted work passes every gate, merges nothing
  // ("Already up to date"), and in self mode is destroyed with the worktree.
  // Observed in the wild: stories closed "done" with zero code on base.
  // Refuse before spending a single gate run.
  const status = ctx.exec("git", ["status", "--porcelain"], { cwd: worktree });
  if (status.code !== 0) {
    throw new CliError(`git status failed in ${worktree}: ${(status.stderr || status.stdout).trim()}`);
  }
  const dirtyPaths = status.stdout.split("\n").filter((l) => l.trim()).map((l) => l.slice(3).trim());
  if (dirtyPaths.length) {
    const storiesRel = relative(root, board.storiesDir(root, config));
    const boardEdits = dirtyPaths.filter((p) => p === storiesRel || p.startsWith(`${storiesRel}/`));
    const boardHint = boardEdits.length
      ? ` Board files (${boardEdits.join(", ")}) are CLI-managed — restore them (git -C ${worktree} checkout -- ${storiesRel} && git -C ${worktree} clean -fd -- ${storiesRel}), never commit them to the story branch.`
      : "";
    throw new CliError(
      `uncommitted changes in ${worktree} — story done merges the story BRANCH, so uncommitted work would be lost. ` +
        `Commit first: git -C ${worktree} add -A -- ':!${storiesRel}' && git -C ${worktree} commit -m "${id}: <what changed>", then re-run story done.` +
        boardHint,
    );
  }

  // 0b. Empty-branch guard: a branch with no commits beyond base merges
  // nothing. Almost always "forgot to commit"; a genuinely codeless story
  // (decision/spike whose artifact lives on the board or in evidence) closes
  // with an explicit --allow-empty.
  const ahead = ctx.exec("git", ["rev-list", "--count", `${base}..${worktrees.branchName(id)}`], { cwd: root });
  if (ahead.code !== 0) {
    throw new CliError(`cannot count commits on ${worktrees.branchName(id)}: ${(ahead.stderr || ahead.stdout).trim()}`);
  }
  if (ahead.stdout.trim() === "0" && ctx.flags["allow-empty"] !== true) {
    throw new CliError(
      `story branch ${worktrees.branchName(id)} has no commits beyond ${base} — nothing would merge and the story would close codeless. ` +
        `Commit your work in the worktree first, or re-run with --allow-empty if this story genuinely changes no code.`,
    );
  }

  // 0c. Plan guard: an execution-time implementation plan must be on record
  // before gates spend anything — the planner dispatch is stories:work step 3.
  const plan = board.getSection(story.body, "## Implementation Plan") ?? "";
  if (plan.split(/\s+/).filter(Boolean).length < 10 && ctx.flags["allow-unplanned"] !== true) {
    throw new CliError(
      `story ${id} has no implementation plan on record — the planning step was skipped. ` +
        `Save the planner's output first: story update ${id} --plan-file <file>, then re-run story done. ` +
        `Use --allow-unplanned only when a plan genuinely adds nothing (trivial chore, decision record).`,
    );
  }

  // 1. Command gates (in the worktree, serialized by the gate lock).
  const resolved = gatesMod.resolveGates(story, config);
  const results = await gatesMod.runCommandGates(story, resolved, {
    root,
    cwd: worktree,
    exec: ctx.exec,
    gateLock: config.gateLock !== false,
  });
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    throw new CliError(
      `command gate(s) failed: ${failed.map((f) => `${f.name} (exit ${f.exitCode})`).join(", ")} — story stays in-progress`,
    );
  }

  // 2. Review gates need a recorded pass verdict.
  const unmet = gatesMod.unmetReviewGates(root, id, resolved);
  if (unmet.length) {
    throw new CliError(
      `review gate(s) missing a pass verdict: ${unmet.map((g) => g.name).join(", ")} — record with: ` +
        unmet.map((g) => `story record ${id} --gate ${g.name} --verdict pass --evidence <path>`).join("; "),
    );
  }

  // 3. Evidence file: command results + review verdicts, timestamped.
  const reviews = resolved
    .filter((g) => g.kind === "review")
    .map((g) => ({ name: g.name, kind: "review", ...gatesMod.readVerdict(root, id, g.name) }));
  const evidence = gatesMod.writeEvidence(root, id, { gates: [...results, ...reviews] });

  const diff = worktrees.actualDiff(root, id, { exec: ctx.exec, base });
  const mode = config.merge ?? "self";

  if (mode === "pr") {
    // Dynamic import (ratified cycle rule): cli.mjs must not import github.mjs statically.
    const { integratePrMode } = await import("./github.mjs");
    const res = await integratePrMode(root, story, { exec: ctx.exec, diff });
    output(ctx, { id, status: "in-review", pr: res.number, created: res.created, evidence }, [
      `${id} in-review — PR #${res.number} ${res.created ? "opened" : "updated"} (the sweep tracks review state)`,
    ]);
    return;
  }

  // Post-integration board writes go through board.mutateStory with the root
  // resolved BEFORE integration — never back through mutateStory(ctx, …) →
  // findRoot(ctx.cwd). In self mode integrateSelf tears the worktree down, and
  // when `story done` was started from inside it, any later cwd-relative git
  // spawn dies on the deleted directory — stranding a merged story in-progress.
  if (mode === "self") {
    const { conflict } = await worktrees.integrateSelf(root, story, { exec: ctx.exec, base });
    if (conflict && worktrees.safeToDiscardOnConflict(root, id, { exec: ctx.exec, base })) {
      // A prior integrateSelf run's merge already landed on base (crash
      // between merge and board write) and this "conflict" is just the stale
      // branch re-merging over content that's already there — verified by
      // actual content (branch gone, or its tip is subsumed by base), not
      // merely a commit-message match. Tear down the stale worktree/branch
      // and fall through to close the story truthfully.
      worktrees.teardown(root, id, { exec: ctx.exec });
    } else if (conflict) {
      await board.mutateStory(root, config, id, (s) => {
        s.body = appendToSection(
          s.body,
          "## Implementation Notes",
          `- ${nowISO()}: integration conflict with ${base}; merge ${base} into ${worktrees.branchName(id)} in the worktree, resolve, then re-run \`story done ${id}\``,
        );
      }, { heartbeat: true });
      throw new CliError(
        `merge conflict integrating ${id} — story stays in-progress; resolve in the worktree and re-run story done`,
      );
    }
    await board.mutateStory(root, config, id, (s) => {
      const next = worktrees.reconcileTouches(s, diff);
      board.assertTransition(next.status, "done");
      next.status = "done";
      delete next.claim;
      delete next.feedback;
      return next;
    });
    await commitBoard(ctx, root, config, id);
    output(ctx, { id, status: "done", merged: true, evidence }, [`${id} done — merged into ${base}`]);
    return;
  }

  // local mode: hand off to the human, hold the reconciled touches.
  await board.mutateStory(root, config, id, (s) => {
    const next = worktrees.reconcileTouches(s, diff);
    board.assertTransition(next.status, "in-review");
    next.status = "in-review";
    delete next.claim;
    return next;
  });
  output(ctx, { id, status: "in-review", evidence }, [
    `${id} in-review — worktree left at ${worktree} for local review (doctor flips it to done once merged)`,
  ]);
}

/**
 * self mode is the only mode where the CLI owns base-branch commits (it just
 * made the merge commit), so a close also sweeps EVERY pending edit under
 * storiesDir — this story's status flip plus any piled-up earlier board writes
 * — into one commit, serialized by the same merge lock as the integration.
 * The pathspec keeps unrelated staged work out of the commit. Best-effort by
 * design: the story is already merged and done, so a failing commit (hooks,
 * index lock) warns on stderr and leaves the edits for the next close.
 */
async function commitBoard(ctx, root, config, id) {
  await withLock(root, "merge", () => {
    const dir = board.storiesDir(root, config);
    const dirty = ctx.exec("git", ["status", "--porcelain", "--", dir], { cwd: root });
    if (dirty.code !== 0 || !dirty.stdout.trim()) return;
    const add = ctx.exec("git", ["add", "-A", "--", dir], { cwd: root });
    const commit = add.code !== 0
      ? add
      : ctx.exec("git", ["commit", "-m", `story ${id}: board update`, "--", dir], { cwd: root });
    if (commit.code !== 0) {
      ctx.stderr.write(`warning: board commit failed (edits left for the next close): ${(commit.stderr || commit.stdout).trim()}\n`);
    }
  });
}

// ---------------------------------------------------------------- doctor

async function cmdDoctor(ctx) {
  const root = findRoot(ctx.cwd, ctx.exec);
  const config = loadConfig(root);
  const report = await withLock(root, "board", () =>
    runDoctor(root, config, { fix: ctx.flags.fix === true, exec: ctx.exec }),
  );
  const hard = report.issues.some((i) => i.hard === true);
  if (!(ctx.flags.quiet === true && report.ok)) {
    output(
      ctx,
      report,
      report.issues.length
        ? report.issues.map((i) =>
            `${i.hard ? "HARD " : ""}${i.kind}: ${i.id ?? i.ids?.join(" → ") ?? i.file ?? ""}${i.dep ? ` → ${i.dep}` : ""}${i.detail ? ` (${i.detail})` : ""}`,
          )
        : ["board healthy"],
    );
  }
  return hard ? 1 : 0;
}

// ---------------------------------------------------------------- archive

/**
 * Move done stories to stories/archive/ — keep the active set small enough
 * that raw-file grepping stays context-window-sized (< ~200 stories / ~25k
 * tokens; agents WILL grep the files directly — beads lesson).
 */
async function cmdArchive(ctx) {
  const root = findRoot(ctx.cwd, ctx.exec);
  const config = loadConfig(root);
  const archived = await withLock(root, "board", () => {
    const done = board.loadStories(root, config).filter((s) => s.status === "done");
    const dir = join(board.storiesDir(root, config), "archive");
    mkdirSync(dir, { recursive: true });
    for (const s of done) renameSync(s.file, join(dir, basename(s.file)));
    return done.map((s) => s.id);
  });
  output(ctx, { archived }, [archived.length ? `archived ${archived.join(", ")}` : "nothing to archive"]);
}

// ---------------------------------------------------------------- views

function publicView(story) {
  const { body, file, ...rest } = story;
  return rest;
}

const listLine = (s) => `${s.id}  ${String(s.status).padEnd(11)}  ${s.priority}  ${s.title}`;

async function cmdList(ctx) {
  const root = findRoot(ctx.cwd, ctx.exec);
  const config = loadConfig(root);
  let stories = board.loadStories(root, config);
  if (typeof ctx.flags.status === "string") stories = stories.filter((s) => s.status === ctx.flags.status);
  output(ctx, stories.map(publicView), stories.length ? stories.map(listLine) : ["(no stories)"]);
}

async function cmdBoard(ctx) {
  const root = findRoot(ctx.cwd, ctx.exec);
  const config = loadConfig(root);
  const stories = board.loadStories(root, config);
  const columns = {};
  for (const status of board.STATUSES) {
    columns[status] = stories.filter((s) => s.status === status).map(publicView);
  }
  const lines = [];
  for (const status of board.STATUSES) {
    if (!columns[status].length) continue;
    lines.push(`${status} (${columns[status].length})`);
    for (const s of columns[status]) lines.push(`  ${s.id}  ${s.priority}  ${s.title}`);
  }
  output(ctx, columns, lines.length ? lines : ["(board empty)"]);
}

async function cmdShow(ctx) {
  const [id] = ctx.positionals;
  if (!id) throw new CliError("usage: story show <id>");
  const root = findRoot(ctx.cwd, ctx.exec);
  const config = loadConfig(root);
  const s = board.getStory(board.loadStories(root, config, { includeArchive: true }), id);
  const stateLine = ["status: " + s.status]
    .concat(s.claim ? [`claim: ${s.claim.session} (lease ${s.claim.lease})`] : [])
    .concat(s.feedback ? ["feedback: true"] : [])
    .concat(s.pr?.number ? [`pr: #${s.pr.number}`] : []);
  output(ctx, { ...publicView(s), body: s.body }, [...stateLine, "", readFileSync(s.file, "utf8")]);
}

// ---------------------------------------------------------------- loop (Section C)

// `story loop start|status|stop|tick|learn` — the engine lives in loop.mjs.
// ctx.positionals/ctx.flags come from this module's single parseArgv, shared
// directly with runLoopCommand (no re-serializing into argv + re-parsing with
// a weaker local parser).
async function cmdLoop(ctx) {
  const root = findRoot(ctx.cwd, ctx.exec); // MAIN checkout root, even from inside a story worktree
  const flags = { ...ctx.flags };
  if (flags.session === undefined && ctx.env.CLAUDE_SESSION_ID) flags.session = ctx.env.CLAUDE_SESSION_ID;
  const result = await runLoopCommand({ positionals: ctx.positionals, flags }, { root });
  output(ctx, result, [loopHumanLine(ctx.positionals[0], result)]);
}

function loopHumanLine(sub, result) {
  if (sub === "start") return `story loop started - goal: ${result.goal} (0/${result.max_iterations})`;
  if (sub === "status") {
    if (Array.isArray(result.loops)) {
      return result.loops.length > 0
        ? result.loops
            .map((l) => `${l.session_id}: iteration ${l.iteration}/${l.max_iterations} - goal: ${l.goal}`)
            .join("\n")
        : "no active loops";
    }
    return result.active
      ? `loop active - iteration ${result.iteration}/${result.max_iterations} - goal: ${result.goal}`
      : "no active loop";
  }
  if (sub === "stop") return result.stopped ? "loop stopped" : "no active loop";
  if (sub === "learn") return "learning recorded";
  // tick: the (hook-shaped) JSON is the payload in both output modes —
  // stop-loop.sh pipes `story loop tick --hook` WITHOUT --json and parses stdout.
  return JSON.stringify(result);
}

// ---------------------------------------------------------------- sweep

async function cmdSweep(ctx) {
  const root = findRoot(ctx.cwd, ctx.exec);
  // Dynamic import (ratified cycle rule): cli.mjs must not import github.mjs statically.
  const { sweep } = await import("./github.mjs");
  const result = await sweep(root, { force: ctx.flags.force === true, exec: ctx.exec });
  output(ctx, result, [
    result.swept
      ? `swept — ${result.effects?.length ?? 0} effect(s) applied`
      : `sweep skipped (${result.reason})`,
  ]);
}

// ---------------------------------------------------------------- dispatch

const COMMANDS = {
  loop: cmdLoop,
  init: cmdInit,
  create: cmdCreate,
  ready: cmdReady,
  claim: cmdClaim,
  update: cmdUpdate,
  note: cmdNote,
  park: cmdPark,
  record: cmdRecord,
  done: cmdDone,
  doctor: cmdDoctor,
  archive: cmdArchive,
  list: cmdList,
  board: cmdBoard,
  show: cmdShow,
  sweep: cmdSweep,
};

export async function main(argv, io = {}) {
  const {
    cwd = process.cwd(),
    exec = run,
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
  } = io;
  const { cmd, positionals, flags } = parseArgv(argv);
  try {
    const handler = COMMANDS[cmd];
    if (!handler) {
      throw new CliError(
        cmd
          ? `unknown command '${cmd}' — commands: ${Object.keys(COMMANDS).join(", ")}`
          : `usage: story <command> — commands: ${Object.keys(COMMANDS).join(", ")}`,
      );
    }
    const ctx = { cwd, exec, env, stdout, stderr, positionals, flags, json: flags.json === true };
    return (await handler(ctx)) ?? 0;
  } catch (err) {
    if (!(err instanceof CliError)) throw err;
    stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    return err.exitCode;
  }
}
