// plugins/stories/lib/doctor.mjs — board integrity detection + repair.
//
// Lives OUTSIDE cli.mjs so Section C's loop.mjs can import it without an
// import cycle (cli.mjs → loop.mjs for the `loop` subcommand; loop.mjs →
// doctor.mjs for the tick's auto-fix pass; cli.mjs → doctor.mjs for cmdDoctor).
// Corruption is expected (beads lesson): detect, report, adopt, repair.
import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import * as board from "./board.mjs";
import * as worktrees from "./worktrees.mjs";
import { run, todayISO } from "./util.mjs";

// A lease is stale when the claiming session has not touched the board for
// this long (every mutateStory call is a heartbeat). Doctor reclaims it so
// another worker can pick the story up — the worktree survives.
export const STALE_LEASE_MS = 60 * 60 * 1000;

/**
 * Every doctor status change routes through here for parity with the rest of
 * the plugin: the stored-status state machine (board.assertTransition) is the
 * single authority on legal moves, so a doctor auto-fix that the state machine
 * would forbid fails loudly instead of silently writing an illegal status.
 * Returns the re-statused copy (updated stamped, claim untouched — callers
 * strip it) so call sites stay one-liners.
 */
export function flipStatus(story, to) {
  board.assertTransition(story.status, to);
  return { ...story, status: to, updated: todayISO() };
}

function loadRawStories(dir, issues, { hard }) {
  const stories = [];
  if (!existsSync(dir)) return stories;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".md") || name.startsWith("_")) continue;
    const file = join(dir, name);
    try {
      stories.push({ ...board.parseStory(readFileSync(file, "utf8"), file), file });
    } catch (err) {
      issues.push({ kind: "corrupt", file, detail: err.message, hard });
    }
  }
  return stories;
}

function findCycle(stories) {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.depends_on ?? []) {
      if (!byId.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const s of stories) {
    const cycle = visit(s.id);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Board integrity check + repair (corruption is expected — beads lesson).
 * NOT locked internally — callers hold the board lock (cmdDoctor does;
 * Section C's tick wraps its call in withLock(root, "board", …) too).
 *
 * opts: { fix = false, kinds = null, exec, now, staleLeaseMs }
 * `kinds` (only meaningful with fix: true) restricts WHICH issue kinds are
 * auto-fixed; null means all. Section C's loop tick passes
 * { fix: true, kinds: ["merged-local", "stale-lease"] } so only those safe
 * repairs run unattended — everything else stays detect-only during a run.
 *
 * fix=false only reports. Hard issues (unparseable active story files) make
 * cmdDoctor exit 1; everything else is soft.
 */
export function runDoctor(root, config, opts = {}) {
  const { fix = false, kinds = null, exec = run, now = Date.now(), staleLeaseMs = STALE_LEASE_MS } = opts;
  const shouldFix = (kind) => fix && (kinds === null || kinds.includes(kind));
  const issues = [];
  const fixed = [];
  const dir = board.storiesDir(root, config);
  const active = loadRawStories(dir, issues, { hard: true });
  const archived = loadRawStories(join(dir, "archive"), issues, { hard: false });
  const known = new Set([...active, ...archived].map((s) => s.id).filter(Boolean));

  // Overlay execution state onto the raw parse (mirrors board.loadStories):
  // a migrated story's status/claim/etc live in the store, not the file, so
  // reading `active` raw-only would flag every healthy saved story as
  // "invalid" for having no on-disk status. Unmigrated legacy files still
  // carry their state in frontmatter and are unaffected by the no-op assign.
  const state = board.readStateStore(root).stories;
  for (const s of active) {
    Object.assign(s, state[s.id]);
    s.status ??= "todo";
  }

  for (const s of active) {
    if (!s.id) {
      issues.push({ kind: "unadopted", file: s.file, detail: "hand-written story without an id" });
      if (shouldFix("unadopted")) fixed.push(adoptStory(root, config, s, known));
      continue;
    }
    // SECURITY: an id present but not matching board.ID_PATTERN never reaches a
    // path builder (loadStories skips it); surface it here so a human sees it.
    // adoptStory re-ids it (its ID_PATTERN.test guard mints a fresh id) and
    // renames the file — but only under `--fix`, so the raw id is never joined.
    if (!board.ID_PATTERN.test(s.id)) {
      issues.push({ kind: "invalid-id", file: s.file, detail: `story id '${s.id}' is not a valid st- id` });
      if (shouldFix("invalid-id")) fixed.push(adoptStory(root, config, s, known));
      continue;
    }
    if (!s.title || !s.status || !board.STATUSES.includes(s.status)) {
      issues.push({ kind: "invalid", id: s.id, file: s.file, detail: `illegal or missing status '${s.status}'` });
      if (shouldFix("invalid")) fixed.push(adoptStory(root, config, s, known));
      continue;
    }
    // Migration (state-layer rework): state fields still present in the .md
    // frontmatter. Safe auto-fix — saveStory strips them into the store.
    const raw = board.parseStory(readFileSync(s.file, "utf8"), s.file);
    if (board.STATE_FIELDS.some((k) => raw[k] !== undefined)) {
      issues.push({ kind: "frontmatter-state", id: s.id, file: s.file });
      if (shouldFix("frontmatter-state")) board.saveStory(root, config, s);
    }
    const dangling = (s.depends_on ?? []).filter((dep) => !known.has(dep));
    for (const dep of dangling) issues.push({ kind: "dangling-dep", id: s.id, dep });
    if (shouldFix("dangling-dep") && dangling.length) {
      board.saveStory(root, config, { ...s, depends_on: s.depends_on.filter((d) => known.has(d)) });
      fixed.push({ kind: "deps-removed", id: s.id, deps: dangling });
    }
    if (
      s.status === "in-progress" &&
      !existsSync(worktrees.worktreePath(root, s.id)) &&
      (config.merge ?? "self") === "self" &&
      worktrees.isMergedSelf(root, s.id, { exec, base: config.baseBranch ?? "main" })
    ) {
      // A crash between integrateSelf's teardown and cmdDone's status write
      // strands the story in-progress with its work already merged (worktree
      // AND branch gone). Checked FIRST: the stale-lease/missing-worktree
      // reclaims below would send a worker off to redo merged work.
      issues.push({ kind: "merged-self", id: s.id });
      if (shouldFix("merged-self")) {
        const next = flipStatus(s, "done");
        delete next.claim;
        delete next.feedback;
        board.saveStory(root, config, next);
        worktrees.teardown(root, s.id, { exec }); // clears any leftover branch
        fixed.push({ kind: "done", id: s.id });
      }
    } else if (s.status === "in-progress" && s.claim?.lease && now - Date.parse(s.claim.lease) > staleLeaseMs) {
      issues.push({ kind: "stale-lease", id: s.id, session: s.claim?.session });
      if (shouldFix("stale-lease")) {
        // pr-aware reclaim (Task E11): a story with a `pr` record re-enters
        // the feedback path (in-review + feedback: true) — its PR still
        // exists, so a fresh-claim `todo` would double-open PRs. Everything
        // else reclaims to todo as before.
        const next = s.pr?.number
          ? { ...flipStatus(s, "in-review"), feedback: true }
          : flipStatus(s, "todo");
        delete next.claim;
        board.saveStory(root, config, next);
        fixed.push({ kind: "lease-reclaimed", id: s.id });
      }
    } else if (s.status === "in-progress" && s.claim && !existsSync(worktrees.worktreePath(root, s.id))) {
      // Missing-worktree (Stage 3): an in-progress story holds a live claim but
      // its .worktrees/<id> dir is gone (the claim's board write survived a
      // torn-down / never-created worktree). Such a story is invisible to
      // `story ready` (still claimed) AND to stale-lease for up to
      // STALE_LEASE_MS. Reclaim it to todo immediately so a worker can re-claim
      // it — mutually exclusive with stale-lease above (a stale claim reclaims
      // first, keeping any surviving worktree).
      issues.push({ kind: "missing-worktree", id: s.id, session: s.claim?.session });
      if (shouldFix("missing-worktree")) {
        const next = flipStatus(s, "todo");
        delete next.claim;
        board.saveStory(root, config, next);
        fixed.push({ kind: "worktree-reclaimed", id: s.id });
      }
    }
  }

  const cycle = findCycle(active.filter((s) => s.id && board.STATUSES.includes(s.status)));
  if (cycle) issues.push({ kind: "cycle", ids: cycle, detail: "break it with story update --depends-on" });

  const wtDir = join(root, ".worktrees");
  const activeIds = new Set(
    active.filter((s) => s.status === "in-progress" || s.status === "in-review").map((s) => s.id),
  );
  for (const name of existsSync(wtDir) ? readdirSync(wtDir) : []) {
    if (activeIds.has(name)) continue;
    // A worktree dir whose name is not a valid id must NOT be handed to
    // teardown (worktreePath asserts the id and would throw, wedging an
    // unattended fix). Report it and skip — a human removes it deliberately.
    if (!board.ID_PATTERN.test(name)) {
      issues.push({ kind: "invalid-id", detail: `worktree dir '${name}' is not a valid st- id` });
      continue;
    }
    issues.push({ kind: "orphan-worktree", id: name });
    const owner = active.find((s) => s.id === name);
    if (shouldFix("orphan-worktree") && (!owner || owner.status === "done")) {
      worktrees.teardown(root, name, { exec });
      fixed.push({ kind: "worktree-removed", id: name });
    }
  }

  if ((config.merge ?? "self") === "local") {
    for (const s of active.filter((x) => x.status === "in-review")) {
      if (!worktrees.isMergedLocal(root, s.id, { exec, base: config.baseBranch ?? "main" })) continue;
      issues.push({ kind: "merged-local", id: s.id });
      if (shouldFix("merged-local")) {
        const next = flipStatus(s, "done");
        delete next.claim;
        delete next.feedback;
        board.saveStory(root, config, next);
        worktrees.teardown(root, s.id, { exec });
        fixed.push({ kind: "done", id: s.id });
      }
    }
  }

  return { ok: issues.length === 0, issues, fixed };
}

function adoptStory(root, config, story, known) {
  const s = board.applyDefaults({
    ...story,
    id: typeof story.id === "string" && board.ID_PATTERN.test(story.id) ? story.id : board.generateId([...known]),
    title: story.title || basename(story.file, ".md").replace(/[-_]+/g, " ").trim(),
    status: board.STATUSES.includes(story.status) ? story.status : "todo",
    priority: board.PRIORITIES.includes(story.priority) ? story.priority : undefined,
    complexity: board.COMPLEXITIES.includes(story.complexity) ? story.complexity : undefined,
  });
  // Parity with every other doctor status change: when adoption RE-STATUSES a
  // file that already had a legal board status (a real state-machine move),
  // route it through assertTransition so an illegal move fails loudly.
  // Adopting an invalid/missing status → todo is a repair, not a transition
  // (the source is not a legal state), so it is exempt.
  if (board.STATUSES.includes(story.status) && story.status !== s.status) {
    board.assertTransition(story.status, s.status);
  }
  known.add(s.id);
  const target = join(dirname(story.file), `${s.id}-${board.slugify(s.title)}.md`);
  if (target !== story.file) renameSync(story.file, target);
  board.saveStory(root, config, { ...s, file: target });
  return { kind: "adopted", id: s.id, file: target };
}
