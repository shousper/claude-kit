// plugins/stories/lib/github.mjs — PR mode (merge: "pr"). Design §9.
//
// Every gh/git invocation goes through the injectable `exec` (util.mjs run()
// signature — sync in production; call sites always await, so async test
// fakes work identically).
//
// Import-cycle rule (ratified): the pure domain helpers this module needs
// (appendToSection, loadConfig, mutateStory, readBodySection) live in board.mjs
// — never imported from cli.mjs, which would violate the module boundary. This
// module is imported only DYNAMICALLY (cli.mjs inside handlers; loop.mjs inside
// tick), so nothing here closes a static cycle.
import { promises as fs } from "node:fs";
import path from "node:path";
import { CliError, nowISO, run as defaultRun } from "./util.mjs";
import { withLock } from "./locks.mjs";
import * as board from "./board.mjs";
import { appendToSection, loadConfig } from "./board.mjs";
import { latestEvidence, resolveGates, runCommandGates, writeEvidence } from "./gates.mjs";
import { actualDiff, branchName, reconcileTouches, teardown, worktreePath } from "./worktrees.mjs";

export const SWEEP_STATE_FILE = path.join(".claude", "story-sweep.local.json");

async function must(exec, cmd, args, opts) {
  const res = await exec(cmd, args, opts);
  if (res.code !== 0) {
    throw new CliError(`${cmd} ${args.join(" ")} failed (exit ${res.code}): ${res.stderr || res.stdout}`);
  }
  return res;
}

// ------------------------------------------------------- board adapters
// B's board.mjs primitives take NO locks (the single-writer invariant lives
// with callers). These adapters are the ONLY way this module touches the
// board. Unlike cli.mjs's mutateStory, mutateBoard does NOT refresh
// claim.lease — sweep mutations are not worker heartbeats.

/** Board-locked read-modify-write; fn edits a copy or returns a replacement. */
export async function mutateBoard(root, config, id, fn) {
  return board.mutateStory(root, config, id, fn, { heartbeat: false });
}

export function appendNote(root, config, id, text) {
  return mutateBoard(root, config, id, (s) => {
    s.body = appendToSection(s.body, "## Implementation Notes", `- ${nowISO()}: ${text}`);
  });
}

export function appendQuestion(root, config, id, text) {
  return mutateBoard(root, config, id, (s) => {
    s.body = appendToSection(s.body, "## Questions", `- ${nowISO()}: ${text}`);
  });
}

/**
 * Sweep-facing gate runner: resolve + run command gates, WRITE the evidence
 * file (B's runCommandGates deliberately does not — cmdDone owns that write
 * on the done path; the sweep owns it here), reduce to {pass, results}.
 */
export async function runGatesWithEvidence(root, story, { cwd, exec = defaultRun } = {}) {
  const config = loadConfig(root);
  const results = await runCommandGates(story, resolveGates(story, config), {
    root,
    cwd,
    exec,
    gateLock: config.gateLock !== false,
  });
  writeEvidence(root, story.id, { gates: results, context: "sweep" });
  return {
    pass: results.every((r) => r.pass),
    results: results.map((r) => ({ gate: r.name, pass: r.pass })),
  };
}

// ------------------------------------------------------- pr creation

export function buildPrBody(story, evidence) {
  const ac = board.readBodySection(story.body, "Acceptance Criteria");
  const lines = [
    `Story: \`${story.id}\``,
    "",
    "## Acceptance Criteria",
    ac || "_none recorded_",
    "",
    "## Gate Evidence",
  ];
  if (!evidence || !evidence.gates?.length) {
    lines.push("_no gate evidence recorded_");
  } else {
    for (const g of evidence.gates) {
      const passed = g.kind === "review" ? g.verdict === "pass" : g.pass === true;
      lines.push(`- ${g.name}: ${passed ? "pass" : "FAIL"} (${evidence.at})`);
    }
  }
  return lines.join("\n");
}

export async function createPr(root, story, { exec = defaultRun } = {}) {
  const config = loadConfig(root);
  const wt = worktreePath(root, story.id);
  const branch = branchName(story.id);
  await must(exec, "git", ["push", "-u", "origin", branch], { cwd: wt });
  const body = buildPrBody(story, latestEvidence(root, story.id));
  const res = await must(exec, "gh", [
    "pr", "create",
    "--title", `${story.id}: ${story.title}`,
    "--head", branch,
    "--base", config.baseBranch ?? "main",
    "--body", body,
  ], { cwd: wt });
  const m = res.stdout.match(/\/pull\/(\d+)/);
  if (!m) throw new CliError(`could not parse PR number from gh pr create output: ${res.stdout}`);
  const number = Number(m[1]);
  // Best effort: repos without auto-merge (or with squash-only policy) just
  // fail here — Task E9b's sweep fallback merges approved+clean PRs for them.
  const method = `--${config.pr?.mergeMethod || "merge"}`;
  const auto = await exec("gh", ["pr", "merge", String(number), "--auto", method], { cwd: wt });
  return { number, url: res.stdout.trim(), autoMerge: auto.code === 0 };
}

/**
 * The pr-mode integration cmdDone dispatches to (replacing B19's seam throw).
 * One board-locked write does everything the ratified in-review-ownership
 * decision requires — mirror of B19's local block: reconcile touches to the
 * ACTUAL diff, delete the claim, land in-review, record/update the pr map,
 * append the note.
 */
export async function integratePrMode(root, story, { exec = defaultRun, now = () => new Date(), diff } = {}) {
  const config = loadConfig(root);
  const paths = diff ?? actualDiff(root, story.id, { exec, base: config.baseBranch ?? "main" });
  const existing = story.pr && story.pr.number ? Number(story.pr.number) : null;
  let created = null;
  if (existing) {
    await must(exec, "git", ["push", "origin", branchName(story.id)], { cwd: worktreePath(root, story.id) });
  } else {
    created = await createPr(root, story, { exec });
  }
  const number = existing ?? created.number;
  const note = existing
    ? `pushed update to PR #${number} after re-running gates`
    : `opened PR #${number} (${created.url})${created.autoMerge ? ", auto-merge enabled" : ""}`;
  await mutateBoard(root, config, story.id, (s) => {
    const next = reconcileTouches(s, paths);
    board.assertTransition(next.status, "in-review");
    next.status = "in-review";
    delete next.claim; // ratified: ownership of an in-review story is its pr record
    delete next.feedback;
    next.pr = existing
      ? { ...next.pr, lastSync: now().toISOString() }
      : { number, lastSync: now().toISOString(), syncAttempts: 0 };
    next.body = appendToSection(next.body, "## Implementation Notes", `- ${nowISO()}: ${note}`);
    return next;
  });
  return { number, created: !existing };
}

// ------------------------------------------------------- sweep detection

export function isFeedback(story) {
  return story.feedback === true || story.feedback === "true";
}

export function actionableItems(detail, sinceIso) {
  const since = sinceIso ? Date.parse(sinceIso) : 0;
  const self = detail.author?.login;
  const items = [];
  for (const r of detail.reviews || []) {
    if (Date.parse(r.submittedAt) <= since) continue;
    if (r.author?.login === self) continue;
    const commented = r.state === "COMMENTED" && r.body?.trim();
    if (r.state !== "CHANGES_REQUESTED" && !commented) continue;
    items.push({ kind: "review", author: r.author?.login, state: r.state, body: r.body });
  }
  for (const c of detail.comments || []) {
    if (Date.parse(c.createdAt) <= since) continue;
    if (c.author?.login === self) continue;
    if (!c.body?.trim()) continue;
    items.push({ kind: "comment", author: c.author?.login, body: c.body });
  }
  return items;
}

export function detectEffects(stories, prs, detailsByNumber, nowIso) {
  const byNumber = new Map(prs.map((p) => [Number(p.number), p]));
  const effects = [];
  for (const story of stories) {
    const number = Number(story.pr?.number);
    if (!number) continue;
    const pr = byNumber.get(number);
    if (!pr) continue;
    if (story.status === "done" || story.status === "blocked") continue;
    if (pr.state === "MERGED") {
      effects.push({ type: "merged", id: story.id, number });
      continue;
    }
    if (pr.state === "CLOSED") {
      effects.push({ type: "closed", id: story.id, number });
      continue;
    }
    // Feedback/drift only apply to unflagged stories awaiting review; a worker
    // already owns anything in-progress or flagged.
    if (story.status !== "in-review" || isFeedback(story)) continue;
    const detail = detailsByNumber.get(number);
    const items = detail ? actionableItems(detail, story.pr.lastSync) : [];
    if (items.length) {
      effects.push({ type: "feedback", id: story.id, number, items, cursor: pr.updatedAt });
      continue;
    }
    if (pr.reviewDecision === "APPROVED" && pr.mergeStateStatus === "CLEAN") {
      // Approved + mergeable + quiet. Repos where createPr's `--auto` failed
      // (autoMerge: false) would otherwise strand approved PRs forever.
      effects.push({ type: "merge", id: story.id, number });
      continue;
    }
    if (pr.mergeStateStatus === "BEHIND" || pr.mergeStateStatus === "DIRTY") {
      effects.push({ type: "drift", id: story.id, number, conflictLikely: pr.mergeStateStatus === "DIRTY" });
    }
  }
  return effects;
}

// ------------------------------------------------------- detail fetching

export async function fetchDetails(numbers, { exec = defaultRun, cwd, cap = 4 } = {}) {
  const out = new Map();
  const queue = [...numbers];
  const worker = async () => {
    while (queue.length) {
      const n = queue.shift();
      const res = await exec("gh", ["pr", "view", String(n), "--json", "author,reviews,comments"], { cwd });
      if (res.code !== 0) continue; // skipped this sweep; cursor stays put, retried next sweep
      out.set(n, JSON.parse(res.stdout));
    }
  };
  await Promise.all(Array.from({ length: Math.min(cap, numbers.length) }, worker));
  return out;
}

// ------------------------------------------------------- sweep effects

function formatFeedback(items) {
  return items
    .map((i) => `- [${i.kind} by @${i.author}${i.state ? ` — ${i.state}` : ""}] ${i.body || "(no comment)"}`)
    .join("\n");
}

export async function applyEffect(root, effect, deps = {}) {
  const config = loadConfig(root);
  const story = board.getStory(board.loadStories(root, config), effect.id);
  switch (effect.type) {
    case "feedback":
      return applyFeedback(root, config, story, effect);
    case "closed":
      return applyClosed(root, config, story, effect);
    case "merged":
      return applyMerged(root, config, story, effect, deps);
    case "merge":
      return applyApprovedMerge(root, config, story, effect, deps);
    case "drift":
      return applyDrift(root, config, story, effect, deps);
    default:
      throw new CliError(`unknown sweep effect: ${effect.type}`);
  }
}

export async function applyEffects(root, effects, deps = {}) {
  const applied = [];
  for (const effect of effects) applied.push(await applyEffect(root, effect, deps));
  return applied;
}

async function applyFeedback(root, config, story, effect) {
  await mutateBoard(root, config, story.id, (s) => {
    s.feedback = true;
    s.pr = { ...s.pr, lastSync: effect.cursor };
    s.body = appendToSection(
      s.body,
      "## Implementation Notes",
      `- ${nowISO()}: PR #${effect.number} review feedback — claim this story and address via kit:receiving-review:\n${formatFeedback(effect.items)}`,
    );
  });
  return { id: story.id, type: "feedback" };
}

async function applyClosed(root, config, story, effect) {
  await mutateBoard(root, config, story.id, (s) => {
    board.assertTransition(s.status, "blocked");
    s.status = "blocked";
    delete s.feedback;
    delete s.claim;
    s.body = appendToSection(
      s.body,
      "## Questions",
      `- ${nowISO()}: PR #${effect.number} was closed without merging. Reopen it, open a fresh PR from the existing ${branchName(story.id)} branch, or cancel this story?`,
    );
  });
  return { id: story.id, type: "closed" };
}

async function applyMerged(root, config, story, effect, { exec = defaultRun, teardownFn = teardown } = {}) {
  await mutateBoard(root, config, story.id, (s) => {
    board.assertTransition(s.status, "done");
    s.status = "done";
    delete s.feedback;
    delete s.claim;
    s.body = appendToSection(
      s.body,
      "## Implementation Notes",
      `- ${nowISO()}: PR #${effect.number} merged on GitHub; story closed by sweep`,
    );
  });
  try {
    await teardownFn(root, story.id, { exec });
  } catch (e) {
    await appendNote(root, config, story.id, `worktree teardown failed: ${e.message} — remove .worktrees/${story.id} manually`);
  }
  const pull = await exec("git", ["pull", "--ff-only"], { cwd: root });
  if (pull.code !== 0) {
    await appendNote(root, config, story.id, `post-merge 'git pull --ff-only' failed (${pull.stderr.trim()}); pull main manually`);
  }
  return { id: story.id, type: "merged" };
}

// applyApprovedMerge and applyDrift land in E9b/E9 — stubs so the switch
// above compiles ahead of those tasks.

async function applyApprovedMerge(root, config, story, effect, { exec = defaultRun } = {}) {
  const method = `--${config.pr?.mergeMethod || "merge"}`;
  const res = await exec("gh", ["pr", "merge", String(effect.number), method], { cwd: root });
  if (res.code !== 0) {
    await appendNote(
      root,
      config,
      story.id,
      `PR #${effect.number} is approved and mergeable but 'gh pr merge' failed (${(res.stderr || res.stdout).trim()}) — merge manually`,
    );
    return { id: story.id, type: "merge", outcome: "failed" };
  }
  await appendNote(root, config, story.id, `PR #${effect.number} approved + clean — merged by sweep; next sweep closes the story`);
  return { id: story.id, type: "merge", outcome: "merged" };
}

async function applyDrift(root, config, story, effect, { exec = defaultRun, runGates = runGatesWithEvidence } = {}) {
  const budget = config.budgets?.maxFixRoundsPerStory ?? 3;
  const attempts = Number(story.pr?.syncAttempts ?? 0);
  if (attempts >= budget) {
    await mutateBoard(root, config, story.id, (s) => {
      board.assertTransition(s.status, "blocked");
      s.status = "blocked";
      delete s.claim;
      s.body = appendToSection(
        s.body,
        "## Questions",
        `- ${nowISO()}: PR #${effect.number}: absorbed main ${attempts} times without landing (budget ${budget}). Merge or close it manually?`,
      );
    });
    return { id: story.id, type: "drift", outcome: "parked" };
  }
  await mutateBoard(root, config, story.id, (s) => {
    s.pr = { ...s.pr, syncAttempts: attempts + 1 };
  });

  const wt = worktreePath(root, story.id);
  const base = config.baseBranch ?? "main";
  await must(exec, "git", ["fetch", "origin", base], { cwd: wt });
  const merge = await exec("git", ["merge", `origin/${base}`, "--no-edit"], { cwd: wt });
  if (merge.code !== 0) {
    await exec("git", ["merge", "--abort"], { cwd: wt });
    await mutateBoard(root, config, story.id, (s) => {
      s.feedback = true;
      s.body = appendToSection(
        s.body,
        "## Implementation Notes",
        `- ${nowISO()}: PR #${effect.number}: merging ${base} into the story branch conflicts. Claim this story, resolve the conflict in .worktrees/${story.id}, re-run gates, push.`,
      );
    });
    return { id: story.id, type: "drift", outcome: "conflict" };
  }

  // Absorbing main invalidates prior gate evidence — re-run command gates now.
  const gate = await runGates(root, story, { cwd: wt, exec });
  if (!gate.pass) {
    const failed = gate.results.filter((r) => !r.pass).map((r) => r.gate).join(", ");
    await mutateBoard(root, config, story.id, (s) => {
      s.feedback = true;
      s.body = appendToSection(
        s.body,
        "## Implementation Notes",
        `- ${nowISO()}: PR #${effect.number}: absorbed ${base} but gates failed (${failed}). Claim this story, fix, re-gate, push.`,
      );
    });
    return { id: story.id, type: "drift", outcome: "gates-failed" };
  }

  await must(exec, "git", ["push", "origin", branchName(story.id)], { cwd: wt });
  await appendNote(root, config, story.id, `PR #${effect.number}: absorbed ${base}, gates green, pushed`);
  return { id: story.id, type: "drift", outcome: "pushed" };
}

// ------------------------------------------------------- the sweep

async function readSweepState(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, SWEEP_STATE_FILE), "utf8"));
  } catch {
    return {};
  }
}

async function writeSweepState(root, state) {
  const file = path.join(root, SWEEP_STATE_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state));
  await fs.rename(tmp, file);
}

export async function sweep(root, opts = {}) {
  const { exec = defaultRun, now = () => new Date(), intervalMs = 60_000, force = false, cap = 4, lockTimeoutMs = 250, runGates, teardownFn } = opts;
  const config = loadConfig(root);
  if (config.merge !== "pr") return { swept: false, reason: "not-pr-mode" };
  try {
    return await withLock(
      root,
      "sweep",
      () => sweepLocked(root, config, { exec, now, intervalMs, force, cap, runGates, teardownFn }),
      { timeoutMs: lockTimeoutMs },
    );
  } catch (e) {
    if (e?.code === "LOCK_TIMEOUT") return { swept: false, reason: "locked" };
    throw e;
  }
}

async function sweepLocked(root, config, { exec, now, intervalMs, force, cap, runGates, teardownFn }) {
  const state = await readSweepState(root);
  const nowDate = now();
  if (!force && state.lastSweep && nowDate.getTime() - Date.parse(state.lastSweep) < intervalMs) {
    return { swept: false, reason: "recent", lastSweep: state.lastSweep };
  }
  // Written before the gh calls: on persistent gh failure we still respect the interval.
  await writeSweepState(root, { lastSweep: nowDate.toISOString() });

  const stories = board.loadStories(root, config).filter((s) => s.pr && s.pr.number);
  if (!stories.length) return { swept: true, effects: [] };

  const list = await must(exec, "gh", [
    "pr", "list", "--state", "all", "--limit", "200",
    "--json", "number,state,reviewDecision,mergeStateStatus,updatedAt,headRefName",
  ], { cwd: root });
  const prs = JSON.parse(list.stdout);
  const byNumber = new Map(prs.map((p) => [Number(p.number), p]));

  const changed = stories
    .filter((s) => {
      const pr = byNumber.get(Number(s.pr.number));
      if (!pr || pr.state !== "OPEN") return false;
      if (s.status !== "in-review" || isFeedback(s)) return false;
      return !s.pr.lastSync || Date.parse(pr.updatedAt) > Date.parse(s.pr.lastSync);
    })
    .map((s) => Number(s.pr.number));

  const details = await fetchDetails(changed, { exec, cwd: root, cap });
  const effects = detectEffects(stories, prs, details, nowDate.toISOString());

  // Advance the per-story cursor for fetched-but-quiet PRs so they are not
  // re-fetched every sweep. Cursor = the updatedAt we just processed (never
  // "now" — an event landing between list and now must stay detectable).
  // One batched board-locked write; feedback effects carry their own cursor.
  const feedbackIds = new Set(effects.filter((e) => e.type === "feedback").map((e) => e.id));
  await withLock(root, "board", () => {
    for (const story of board.loadStories(root, config)) {
      const number = Number(story.pr?.number);
      if (!number || !details.has(number) || feedbackIds.has(story.id)) continue;
      board.saveStory(root, config, { ...story, pr: { ...story.pr, lastSync: byNumber.get(number).updatedAt } });
    }
  });

  const applied = await applyEffects(root, effects, { exec, now, runGates, teardownFn });
  return { swept: true, effects: applied };
}

// ------------------------------------------------------- init probes

export async function ensurePrRequirements(root, { exec = defaultRun } = {}) {
  const problems = [];
  const auth = await exec("gh", ["auth", "status"], { cwd: root });
  if (auth.code !== 0) {
    problems.push("`gh auth status` failed — run `gh auth login` before using merge mode \"pr\"");
  }
  const remote = await exec("git", ["remote", "get-url", "origin"], { cwd: root });
  if (remote.code !== 0) {
    problems.push("no `origin` remote — add one (`git remote add origin …`) before using merge mode \"pr\"");
    return { ok: false, problems };
  }
  const perm = await exec(
    "gh",
    ["repo", "view", "--json", "viewerPermission", "--jq", ".viewerPermission"],
    { cwd: root },
  );
  const level = perm.stdout.trim();
  if (perm.code !== 0 || !["ADMIN", "MAINTAIN", "WRITE"].includes(level)) {
    problems.push(
      `no push access to origin (viewerPermission=${level || "unknown"}) — PR mode needs write access to push story branches`,
    );
  }
  return { ok: problems.length === 0, problems };
}
