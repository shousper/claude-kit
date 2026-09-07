// shared/stories/lib/doctor.mjs — board integrity detection + repair.
//
// Lives OUTSIDE cli.mjs so Section C's loop.mjs can import it without an
// import cycle (cli.mjs → loop.mjs for the `loop` subcommand; loop.mjs →
// doctor.mjs for the tick's auto-fix pass; cli.mjs → doctor.mjs for cmdDoctor).
// Corruption is expected (beads lesson): detect, report, adopt, repair.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import * as board from "./board.mjs";
import * as worktrees from "./worktrees.mjs";
import {
  GITIGNORE_BLOCK,
  LEGACY_CONFIG,
  LOCKS_DIR,
  STATE_DIR,
  WORKTREES_DIR,
  configPath,
  evidenceRoot,
  hasLegacyMarker,
  hasMarker,
  learningsPath,
  legacyConfigPath,
  localDir,
  loopStatePath,
  readJson,
  run,
  stateDir,
  stateStorePath,
  sweepStatePath,
  todayISO,
  writeFileAtomic,
  writeJsonAtomic,
} from "./util.mjs";

// A lease is stale when the claiming session has not touched the board for
// this long (every mutateStory call is a heartbeat). Doctor reclaims it so
// another worker can pick the story up — the worktree survives.
const HOUR_MS = 60 * 60 * 1000;
export const STALE_LEASE_MS = HOUR_MS;

// Every issue kind runDoctor reports, in one place — no bare string literal
// elsewhere in this module names an issue kind.
export const KIND = Object.freeze({
  CORRUPT: "corrupt",
  UNADOPTED: "unadopted",
  INVALID_ID: "invalid-id",
  INVALID: "invalid",
  FRONTMATTER_STATE: "frontmatter-state",
  DANGLING_DEP: "dangling-dep",
  MERGED_SELF: "merged-self",
  STALE_LEASE: "stale-lease",
  MISSING_WORKTREE: "missing-worktree",
  CYCLE: "cycle",
  ORPHAN_WORKTREE: "orphan-worktree",
  MERGED_LOCAL: "merged-local",
});

// Fixed-record kinds: what `fixed` entries report once an issue is repaired.
const FIX = Object.freeze({
  DEPS_REMOVED: "deps-removed",
  DONE: "done",
  LEASE_RECLAIMED: "lease-reclaimed",
  WORKTREE_RECLAIMED: "worktree-reclaimed",
  WORKTREE_REMOVED: "worktree-removed",
  ADOPTED: "adopted",
  LAYOUT_MIGRATED: "layout-migrated",
});

// Ratified: only the SAFE fix kinds auto-apply during a run (merged-local +
// merged-self flips + stale-lease reclaims + missing-worktree reclaims);
// every other kind stays detect-only until a human runs `story doctor --fix`.
// missing-worktree is the same safety class as stale-lease — reclaim an
// in-progress story with no worktree back to todo so a worker sees it now
// instead of after STALE_LEASE_MS; merged-self closes a story whose merge
// landed but whose status write crashed, so no worker redoes merged work.
export const AUTOFIX_KINDS = [
  KIND.MERGED_LOCAL,
  KIND.MERGED_SELF,
  KIND.STALE_LEASE,
  KIND.MISSING_WORKTREE,
  KIND.FRONTMATTER_STATE,
];

/**
 * Every doctor status change routes through here for parity with the rest of
 * the plugin: the stored-status state machine (board.assertTransition) is the
 * single authority on legal moves, so a doctor auto-fix that the state machine
 * would forbid fails loudly instead of silently writing an illegal status.
 * Delegates the transition itself to board.mjs's closeStory (target done,
 * which also clears feedback) / releaseClaim (every other target) — both
 * already clear the claim, so callers no longer hand-roll that delete.
 * Returns the re-statused copy with `updated` stamped (doctor writes via
 * saveStory directly, never through mutateStory, so nothing else stamps it).
 */
export function flipStatus(story, to) {
  const next = to === board.STATUS.DONE ? board.closeStory(story) : board.releaseClaim(story, to);
  return { ...next, updated: todayISO() };
}

function loadRawStories(dir, issues, { hard }) {
  const stories = [];
  for (const file of board.storyFiles(dir)) {
    try {
      stories.push({ ...board.parseStory(readFileSync(file, "utf8"), file), file });
    } catch (err) {
      issues.push({ kind: KIND.CORRUPT, file, detail: err.message, hard });
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
 * { fix: true, kinds: AUTOFIX_KINDS } so only those safe repairs run
 * unattended — everything else stays detect-only during a run.
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
  const archived = loadRawStories(board.archiveDir(root, config), issues, { hard: false });
  const known = new Set([...active, ...archived].map((s) => s.id).filter(Boolean));

  // Overlay execution state onto the raw parse (mirrors board.loadStories):
  // a migrated story's status/claim/etc live in the store, not the file, so
  // reading `active` raw-only would flag every healthy saved story as
  // "invalid" for having no on-disk status. Unmigrated legacy files still
  // carry their state in frontmatter and are unaffected by the no-op assign.
  const state = board.readStateStore(root).stories;
  for (const s of active) board.overlayState(s, state);

  for (const s of active) {
    if (!s.id) {
      issues.push({ kind: KIND.UNADOPTED, file: s.file, detail: "hand-written story without an id" });
      if (shouldFix(KIND.UNADOPTED)) fixed.push(adoptStory(root, config, s, known));
      continue;
    }
    // SECURITY: an id present but not matching board.ID_PATTERN never reaches a
    // path builder (loadStories skips it); surface it here so a human sees it.
    // adoptStory re-ids it (its ID_PATTERN.test guard mints a fresh id) and
    // renames the file — but only under `--fix`, so the raw id is never joined.
    if (!board.ID_PATTERN.test(s.id)) {
      issues.push({ kind: KIND.INVALID_ID, file: s.file, detail: `story id '${s.id}' is not a valid st- id` });
      if (shouldFix(KIND.INVALID_ID)) fixed.push(adoptStory(root, config, s, known));
      continue;
    }
    if (!s.title || !s.status || !board.STATUSES.includes(s.status)) {
      issues.push({ kind: KIND.INVALID, id: s.id, file: s.file, detail: `illegal or missing status '${s.status}'` });
      if (shouldFix(KIND.INVALID)) fixed.push(adoptStory(root, config, s, known));
      continue;
    }
    // Migration (state-layer rework): state fields still present in the .md
    // frontmatter. Safe auto-fix — saveStory strips them into the store.
    const raw = board.parseStory(readFileSync(s.file, "utf8"), s.file);
    if (board.STATE_FIELDS.some((k) => raw[k] !== undefined)) {
      issues.push({ kind: KIND.FRONTMATTER_STATE, id: s.id, file: s.file });
      if (shouldFix(KIND.FRONTMATTER_STATE)) board.saveStory(root, config, s);
    }
    const dangling = (s.depends_on ?? []).filter((dep) => !known.has(dep));
    for (const dep of dangling) issues.push({ kind: KIND.DANGLING_DEP, id: s.id, dep });
    if (shouldFix(KIND.DANGLING_DEP) && dangling.length) {
      board.saveStory(root, config, { ...s, depends_on: s.depends_on.filter((d) => known.has(d)) });
      fixed.push({ kind: FIX.DEPS_REMOVED, id: s.id, deps: dangling });
    }
    if (
      s.status === board.STATUS.IN_PROGRESS &&
      !existsSync(worktrees.worktreePath(root, s.id)) &&
      config.merge === "self" &&
      worktrees.isMergedSelf(root, s.id, { exec, base: config.baseBranch })
    ) {
      // A crash between integrateSelf's teardown and cmdDone's status write
      // strands the story in-progress with its work already merged (worktree
      // AND branch gone). Checked FIRST: the stale-lease/missing-worktree
      // reclaims below would send a worker off to redo merged work.
      issues.push({ kind: KIND.MERGED_SELF, id: s.id });
      if (shouldFix(KIND.MERGED_SELF)) {
        board.saveStory(root, config, flipStatus(s, board.STATUS.DONE));
        worktrees.teardown(root, s.id, { exec }); // clears any leftover branch
        fixed.push({ kind: FIX.DONE, id: s.id });
      }
    } else if (s.status === board.STATUS.IN_PROGRESS && s.claim?.lease && now - Date.parse(s.claim.lease) > staleLeaseMs) {
      issues.push({ kind: KIND.STALE_LEASE, id: s.id, session: s.claim?.session });
      if (shouldFix(KIND.STALE_LEASE)) {
        // pr-aware reclaim (Task E11): a story with a `pr` record re-enters
        // the feedback path (in-review + feedback: true) — its PR still
        // exists, so a fresh-claim `todo` would double-open PRs. Everything
        // else reclaims to todo as before.
        const next = s.pr?.number
          ? { ...flipStatus(s, board.STATUS.IN_REVIEW), feedback: true }
          : flipStatus(s, board.STATUS.TODO);
        board.saveStory(root, config, next);
        fixed.push({ kind: FIX.LEASE_RECLAIMED, id: s.id });
      }
    } else if (s.status === board.STATUS.IN_PROGRESS && s.claim && !existsSync(worktrees.worktreePath(root, s.id))) {
      // Missing-worktree (Stage 3): an in-progress story holds a live claim but
      // its .worktrees/<id> dir is gone (the claim's board write survived a
      // torn-down / never-created worktree). Such a story is invisible to
      // `story ready` (still claimed) AND to stale-lease for up to
      // STALE_LEASE_MS. Reclaim it to todo immediately so a worker can re-claim
      // it — mutually exclusive with stale-lease above (a stale claim reclaims
      // first, keeping any surviving worktree).
      issues.push({ kind: KIND.MISSING_WORKTREE, id: s.id, session: s.claim?.session });
      if (shouldFix(KIND.MISSING_WORKTREE)) {
        board.saveStory(root, config, flipStatus(s, board.STATUS.TODO));
        fixed.push({ kind: FIX.WORKTREE_RECLAIMED, id: s.id });
      }
    }
  }

  const cycle = findCycle(active.filter((s) => s.id && board.STATUSES.includes(s.status)));
  if (cycle) issues.push({ kind: KIND.CYCLE, ids: cycle, detail: "break it with story update --depends-on" });

  const wtDir = join(root, WORKTREES_DIR);
  const activeIds = new Set(active.filter(board.isActive).map((s) => s.id));
  for (const name of existsSync(wtDir) ? readdirSync(wtDir) : []) {
    if (activeIds.has(name)) continue;
    // A worktree dir whose name is not a valid id must NOT be handed to
    // teardown (worktreePath asserts the id and would throw, wedging an
    // unattended fix). Report it and skip — a human removes it deliberately.
    if (!board.ID_PATTERN.test(name)) {
      issues.push({ kind: KIND.INVALID_ID, detail: `worktree dir '${name}' is not a valid st- id` });
      continue;
    }
    issues.push({ kind: KIND.ORPHAN_WORKTREE, id: name });
    const owner = active.find((s) => s.id === name);
    if (shouldFix(KIND.ORPHAN_WORKTREE) && (!owner || owner.status === board.STATUS.DONE)) {
      worktrees.teardown(root, name, { exec });
      fixed.push({ kind: FIX.WORKTREE_REMOVED, id: name });
    }
  }

  if (config.merge === "local") {
    for (const s of active.filter((x) => x.status === board.STATUS.IN_REVIEW)) {
      if (!worktrees.isMergedLocal(root, s.id, { exec, base: config.baseBranch })) continue;
      issues.push({ kind: KIND.MERGED_LOCAL, id: s.id });
      if (shouldFix(KIND.MERGED_LOCAL)) {
        board.saveStory(root, config, flipStatus(s, board.STATUS.DONE));
        worktrees.teardown(root, s.id, { exec });
        fixed.push({ kind: FIX.DONE, id: s.id });
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
    status: board.STATUSES.includes(story.status) ? story.status : board.STATUS.TODO,
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
  return { kind: FIX.ADOPTED, id: s.id, file: target };
}

// ---------------------------------------------------------------- layout migration

const LEGACY_LOOP = /^story-loop\.(.+)\.local\.md$/;
const LEGACY_GITIGNORE_BLOCK = ".worktrees/\n.claude/*.local.*\n.claude/locks/\n.claude/story-evidence/\n";

/**
 * One-shot move from the pre-split .claude/ layout to .agents/shousper-stories/.
 * The caller holds the board lock. Files move; the only rewrites are the
 * config's budget key (the iteration cap became a stall budget) and the
 * project's ignore block. Stories, ids, branches, and worktrees are untouched.
 * Idempotent: a project already on the new layout returns null. .claude/agents/
 * is never touched — it may hold agents unrelated to stories.
 *
 * Ordering is the crash-safety: every legacy file moves first and the marker
 * flips last (new config written, then legacy config removed). The legacy
 * marker alone keys re-entry, so an interruption anywhere — including between
 * the two steps of the flip — leaves it in place and the next `story doctor`
 * finishes the job; every step skips work that is already done.
 */
export function migrateLayout(root) {
  if (!hasLegacyMarker(root)) return null;
  const legacyDir = dirname(legacyConfigPath(root));
  const moved = [];
  mkdirSync(localDir(root), { recursive: true });

  // Pre-split layout: every file the plugin used to keep under .claude/, and
  // where it lives now — built from the util.mjs path builders so this table
  // never drifts from the spelling the rest of the plugin uses.
  const legacyFiles = [
    ["story-state.local.json", stateStorePath(root)],
    ["story-learnings.local.md", learningsPath(root)],
    ["story-sweep.local.json", sweepStatePath(root)],
    ["story-evidence", evidenceRoot(root)],
  ];
  for (const [from, dest] of legacyFiles) {
    const src = join(legacyDir, from);
    if (!existsSync(src)) continue;
    renameSync(src, dest);
    moved.push([`.claude/${from}`, `${STATE_DIR}/${relative(stateDir(root), dest)}`]);
  }
  for (const name of readdirSync(legacyDir)) {
    const m = LEGACY_LOOP.exec(name);
    if (!m) continue;
    const dest = loopStatePath(root, m[1]);
    renameSync(join(legacyDir, name), dest);
    moved.push([`.claude/${name}`, `${STATE_DIR}/${relative(stateDir(root), dest)}`]);
  }
  // Ephemeral leftovers: the pre-per-session shared loop file and lockfiles
  // are discarded, not moved — fresh ones are created on demand.
  for (const stale of ["story-loop.local.md", LOCKS_DIR]) {
    rmSync(join(legacyDir, stale), { recursive: true, force: true });
  }

  // A new config already on disk means a previous run died between the two
  // flip steps: keep it (it may have been edited since) and just remove the
  // legacy marker.
  if (!hasMarker(root)) {
    const config = readJson(legacyConfigPath(root));
    const budgets = { ...(config.budgets ?? {}) };
    delete budgets.maxIterations;
    budgets.maxStalls ??= board.CONFIG_DEFAULTS.budgets.maxStalls;
    config.budgets = budgets;
    writeJsonAtomic(configPath(root), config);
  }
  unlinkSync(legacyConfigPath(root));
  moved.unshift([LEGACY_CONFIG, `${STATE_DIR}/config.json`]);

  const gitignore = migrateGitignore(root);
  const report = { kind: FIX.LAYOUT_MIGRATED, moved, gitignore };
  if (existsSync(join(legacyDir, "agents"))) {
    report.personas = `copy any story review personas from .claude/agents/ to ${STATE_DIR}/personas/ (not moved: that directory may hold unrelated agents)`;
  }
  return report;
}

function migrateGitignore(root) {
  const p = join(root, ".gitignore");
  const text = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (text.includes(LEGACY_GITIGNORE_BLOCK)) {
    writeFileSync(p, text.replace(LEGACY_GITIGNORE_BLOCK, GITIGNORE_BLOCK));
    return "rewritten";
  }
  const present = new Set(text.split("\n"));
  const missing = GITIGNORE_BLOCK.trimEnd().split("\n").filter((line) => !present.has(line));
  if (missing.length === 0) return "unchanged";
  writeFileSync(p, `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
  return "appended";
}
