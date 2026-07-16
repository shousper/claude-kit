import { describe, it, expect } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile, realpath } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  readLoopState, writeLoopState, loopStatePath,
  appendLearning, readLearnings, learningsPath,
  extractSection, scopeStories, buildBlockReason, tick, runLoopCommand as runLoopCommandParsed,
} from "../../plugins/stories/lib/loop.mjs";
import { loadStories } from "../../plugins/stories/lib/board.mjs";
import { parseArgv } from "../../plugins/stories/lib/cli.mjs";

// Test-only shim: cli.mjs's parseArgv is the single parser production now feeds
// runLoopCommand with (no more re-serialize-then-reparse). Accept the old
// argv-array call shape here so existing test call sites read the same, but
// route it through the real parser rather than a bespoke test parser.
function runLoopCommand(argv: string[], opts: Record<string, unknown> = {}) {
  const { positionals, flags } = parseArgv(["loop", ...argv]);
  return runLoopCommandParsed({ positionals, flags }, opts);
}

export async function makeRoot(config: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "story-loop-")).then(realpath);
  await mkdir(join(dir, ".claude"), { recursive: true });
  await writeFile(
    join(dir, ".claude/story-workflow.json"),
    JSON.stringify({
      version: 1, storiesDir: "stories", merge: "self", gates: {}, defaults: {},
      budgets: { maxIterations: 10, maxFixRoundsPerStory: 3 },
      ...config,
    }),
  );
  return dir;
}

const baseState = () => ({
  goal: "complete all stories",
  session_id: "sess-1",
  iteration: 2,
  max_iterations: 10,
  attempts: { "st-a1b2": 1 },
});

describe("loop state file", () => {
  it("readLoopState returns null when the file is absent", async () => {
    expect(readLoopState(await makeRoot())).toBeNull();
  });

  it("round-trips state through frontmatter", async () => {
    const root = await makeRoot();
    writeLoopState(root, baseState());
    expect(readLoopState(root)).toEqual(baseState());
  });

  it("creates .claude/ when missing and leaves no temp files behind", async () => {
    const root = await mkdtemp(join(tmpdir(), "story-loop-bare-")).then(realpath);
    writeLoopState(root, baseState());
    writeLoopState(root, { ...baseState(), iteration: 3 });
    expect(readLoopState(root)!.iteration).toBe(3);
    expect(await readdir(join(root, ".claude"))).toEqual(["story-loop.local.md"]);
  });

  it("throws on a corrupt state file", async () => {
    const root = await makeRoot();
    await writeFile(loopStatePath(root), "definitely not frontmatter\n");
    expect(() => readLoopState(root)).toThrow(/corrupt/);
  });
});

describe("shared learnings", () => {
  it("readLearnings returns '' when the file is absent", async () => {
    expect(readLearnings(await makeRoot())).toBe("");
  });

  it("appendLearning writes a timestamped entry", async () => {
    const root = await makeRoot();
    await appendLearning(root, "Prefer bun test over npm test", { now: () => new Date("2026-07-08T10:00:00Z") });
    const text = await readFile(learningsPath(root), "utf8");
    expect(text).toContain("## 2026-07-08T10:00:00.000Z");
    expect(text).toContain("Prefer bun test over npm test");
  });

  it("readLearnings excerpts only the most recent entries", async () => {
    const root = await makeRoot();
    for (let i = 1; i <= 7; i++) await appendLearning(root, `entry-${i}`);
    const excerpt = readLearnings(root, { maxEntries: 5 });
    expect(excerpt).not.toContain("entry-1");
    expect(excerpt).not.toContain("entry-2");
    expect(excerpt).toContain("entry-3");
    expect(excerpt).toContain("entry-7");
  });

  it("concurrent appends both land (learnings lock)", async () => {
    const root = await makeRoot();
    await Promise.all([appendLearning(root, "from-worker-A"), appendLearning(root, "from-worker-B")]);
    const text = await readFile(learningsPath(root), "utf8");
    expect(text).toContain("from-worker-A");
    expect(text).toContain("from-worker-B");
  });
});

const STORY_BODY = [
  "## Description", "", "A sample.", "",
  "## Acceptance Criteria", "", "- [ ] bun test passes", "- [ ] CLI prints the id", "",
  "## Questions", "", "Should gates run twice?", "",
].join("\n");

describe("extractSection", () => {
  it("returns the section body, stopping at the next H2", () => {
    expect(extractSection(STORY_BODY, "Acceptance Criteria"))
      .toBe("- [ ] bun test passes\n- [ ] CLI prints the id");
  });

  it("returns '' for a missing section or empty body", () => {
    expect(extractSection(STORY_BODY, "Implementation Plan")).toBe("");
    expect(extractSection(undefined, "Questions")).toBe("");
  });

  it("matches headings case-insensitively", () => {
    expect(extractSection(STORY_BODY, "acceptance criteria")).toContain("bun test passes");
  });
});

describe("scopeStories", () => {
  const stories = [
    { id: "st-1111", epic: "st-9c01", status: "todo" },
    { id: "st-2222", status: "todo" },
    { id: "st-9c01", status: "todo" },
  ];

  it("'complete all stories' keeps everything", () => {
    expect(scopeStories(stories, "complete all stories")).toHaveLength(3);
  });

  it("epic:<id> keeps the epic and its children", () => {
    expect(scopeStories(stories, "epic:st-9c01").map((s: any) => s.id)).toEqual(["st-1111", "st-9c01"]);
  });

  it("an id list keeps exactly those stories", () => {
    expect(scopeStories(stories, "st-2222, st-9c01").map((s: any) => s.id)).toEqual(["st-2222", "st-9c01"]);
  });

  it("free-text goals keep the whole board", () => {
    expect(scopeStories(stories, "ship the beta")).toHaveLength(3);
  });
});

describe("buildBlockReason", () => {
  it("contains id, title, acceptance criteria, learnings, and the sanctioned commands", () => {
    const reason = buildBlockReason(
      { id: "st-a1b2", title: "Sample story", body: STORY_BODY },
      "- always run gates from the worktree",
      { iteration: 3, max_iterations: 10 },
    );
    expect(reason).toContain("st-a1b2 - Sample story");
    expect(reason).toContain("- [ ] bun test passes");
    expect(reason).toContain("story claim st-a1b2");
    expect(reason).toContain("story done st-a1b2");
    expect(reason).toContain("always run gates from the worktree");
    expect(reason).toContain("iteration 3/10");
  });
});

// Matches doctor.mjs's runDoctor report shape: {ok, issues, fixed}.
const okDoctor = () => ({ ok: true, issues: [], fixed: [] });
const todoReady = (stories: any[]) => stories.filter((s) => s.status === "todo");

function sampleStory(over: Record<string, unknown> = {}) {
  return {
    id: "st-a1b2", title: "Sample story", type: "feature", status: "todo",
    priority: "P2", depends_on: [], touches: [], body: STORY_BODY,
    ...over,
  };
}

async function runTick(opts: {
  root: string;
  sessionId?: string;
  stories?: any[];
  ready?: (stories: any[]) => any[];
  doctor?: () => { ok: boolean; issues: Array<Record<string, unknown>>; fixed: unknown[] };
  learnings?: string;
}) {
  return tick(opts.sessionId ?? "sess-1", {
    root: opts.root,
    loadStories: () => opts.stories ?? [sampleStory()],
    computeReady: opts.ready ?? todoReady,
    doctor: opts.doctor ?? okDoctor,
    readLearnings: () => opts.learnings ?? "- prefer bun test",
  });
}

describe("tick: session ownership + terminal decisions", () => {
  it("allows when no loop is active", async () => {
    const root = await makeRoot();
    const r = await runTick({ root });
    expect(r.decision).toBe("allow");
    expect(r.summary).toBeUndefined();
  });

  it("allows without touching state when the session does not own the loop", async () => {
    const root = await makeRoot();
    writeLoopState(root, baseState());
    const r = await runTick({ root, sessionId: "sess-OTHER" });
    expect(r.decision).toBe("allow");
    expect(readLoopState(root)!.iteration).toBe(2); // untouched
  });

  it("binds an unowned loop to the first session that ticks it", async () => {
    const root = await makeRoot();
    writeLoopState(root, { ...baseState(), session_id: "" });
    const r = await runTick({ root, sessionId: "sess-9" });
    expect(r.decision).toBe("block");
    expect(readLoopState(root)!.session_id).toBe("sess-9");
  });

  it("allows without driving when an owned loop is ticked with an empty sessionId (foreign)", async () => {
    const root = await makeRoot();
    writeLoopState(root, baseState()); // session_id: "sess-1"
    const r = await runTick({ root, sessionId: "" });
    expect(r.decision).toBe("allow");
    expect(readLoopState(root)!.iteration).toBe(2); // untouched — did not drive
    expect(readLoopState(root)!.session_id).toBe("sess-1"); // ownership unchanged
  });

  it("still drives when the ticking session matches the owning session", async () => {
    const root = await makeRoot();
    writeLoopState(root, baseState()); // session_id: "sess-1"
    const r = await runTick({ root, sessionId: "sess-1" });
    expect(r.decision).toBe("block");
    expect(readLoopState(root)!.iteration).toBe(3); // drove
  });

  it("removes a corrupt state file and allows with a restart summary", async () => {
    const root = await makeRoot();
    await writeFile(loopStatePath(root), "garbage\n");
    const r = await runTick({ root });
    expect(r.decision).toBe("allow");
    expect(r.summary).toMatch(/corrupt/i);
    expect(existsSync(loopStatePath(root))).toBe(false);
  });

  it("allows-stop with a clear reason when the config is corrupt (never crashes the hook, never drives on {})", async () => {
    const root = await makeRoot();
    writeLoopState(root, baseState()); // an active loop exists…
    await writeFile(join(root, ".claude/story-workflow.json"), "{ not json");
    // …but a corrupt config must NOT crash the tick and must NOT proceed with
    // an empty config — it allows the stop with an explanatory reason.
    const r = await tick("sess-1", { root });
    expect(r.decision).toBe("allow");
    expect(r.summary).toMatch(/cannot run/i);
    expect(r.summary).toMatch(/story-workflow\.json/);
  });

  it("allows with a board summary when the iteration budget is exhausted", async () => {
    const root = await makeRoot();
    writeLoopState(root, { ...baseState(), iteration: 10 });
    const r = await runTick({ root });
    expect(r.decision).toBe("allow");
    expect(r.summary).toMatch(/budget exhausted/i);
    expect(existsSync(loopStatePath(root))).toBe(false);
  });

  it("allows with parked questions when the board is drained (done/parked only)", async () => {
    const root = await makeRoot();
    writeLoopState(root, baseState());
    const stories = [
      sampleStory({ id: "st-d0d0", status: "done" }),
      sampleStory({ id: "st-b10c", status: "blocked", title: "Parked one" }),
    ];
    const r = await runTick({ root, stories });
    expect(r.decision).toBe("allow");
    expect(r.summary).toContain("st-b10c");
    expect(r.summary).toContain("Should gates run twice?"); // the Questions section
    expect(r.summary).toMatch(/1\/2 in scope done/);
    expect(existsSync(loopStatePath(root))).toBe(false);
  });

  it("allows-and-waits when nothing is claimable but work is still open", async () => {
    const root = await makeRoot();
    writeLoopState(root, baseState());
    const stories = [sampleStory({ status: "in-review" })];
    const r = await runTick({ root, stories, ready: () => [] });
    expect(r.decision).toBe("allow");
    expect(r.summary).toMatch(/idle|claimable/i);
    expect(r.summary).toContain("st-a1b2");
    expect(existsSync(loopStatePath(root))).toBe(true); // loop stays armed
  });

  it("blocks with the next ready story, incrementing iteration and attempts atomically", async () => {
    const root = await makeRoot();
    writeLoopState(root, { ...baseState(), attempts: {} });
    const r = await runTick({ root });
    expect(r.decision).toBe("block");
    expect(r.reason).toContain("st-a1b2 - Sample story");
    expect(r.reason).toContain("- [ ] bun test passes");
    expect(r.reason).toContain("prefer bun test");
    expect(r.systemMessage).toBe("story st-a1b2 · iteration 3/10");
    const after = readLoopState(root)!;
    expect(after.iteration).toBe(3);
    expect(after.attempts).toEqual({ "st-a1b2": 1 });
  });
});

const gitq = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(new TextDecoder().decode(r.stderr));
};

// A real repo on disk: the two auto-fix cases run tick with DEFAULT collaborators
// (real loadStories/computeReady/activeDiffs/runDoctor), so board + git are real.
async function makeGitRoot(config: Record<string, unknown> = {}): Promise<string> {
  const root = await makeRoot(config);
  await mkdir(join(root, "stories"), { recursive: true });
  gitq(root, "init", "-q", "-b", "main");
  gitq(root, "config", "user.email", "t@example.com");
  gitq(root, "config", "user.name", "t");
  await writeFile(join(root, "README.md"), "fixture\n");
  gitq(root, "add", "-A");
  gitq(root, "commit", "-qm", "init");
  return root;
}

const diskStory = (id: string, title: string, status: string, extra: string[] = []) => [
  "---", `id: ${id}`, `title: ${title}`, "type: feature", `status: ${status}`,
  "priority: P2", "depends_on: []", "touches: []", ...extra,
  "created: 2026-07-08", "updated: 2026-07-08", "---", "", "## Description", "", "x", "",
].join("\n");

describe("tick: doctor + budgets + goal scope", () => {
  it("skips stories that hit maxFixRoundsPerStory and dispatches the next one", async () => {
    const root = await makeRoot();
    writeLoopState(root, { ...baseState(), attempts: { "st-a1b2": 3 } });
    const stories = [sampleStory(), sampleStory({ id: "st-c3d4", title: "Second story" })];
    const r = await runTick({ root, stories });
    expect(r.decision).toBe("block");
    expect(r.reason).toContain("st-c3d4");
    expect(readLoopState(root)!.attempts).toEqual({ "st-a1b2": 3, "st-c3d4": 1 });
  });

  it("allows with a summary when every ready story is over its attempt budget", async () => {
    const root = await makeRoot();
    writeLoopState(root, { ...baseState(), attempts: { "st-a1b2": 3 } });
    const r = await runTick({ root });
    expect(r.decision).toBe("allow");
    expect(r.summary).toMatch(/attempt budget/i);
    expect(existsSync(loopStatePath(root))).toBe(false);
  });

  it("blocks with repair instructions on hard board corruption (and still burns budget)", async () => {
    const root = await makeRoot();
    writeLoopState(root, baseState());
    const r = await runTick({
      root,
      doctor: () => ({
        ok: false,
        issues: [{ kind: "dangling-dep", hard: true, detail: "st-dead depends on missing st-beef" }],
        fixed: [],
      }),
    });
    expect(r.decision).toBe("block");
    expect(r.reason).toContain("st-dead depends on missing st-beef");
    expect(r.reason).toContain("story doctor --fix");
    expect(r.systemMessage).toBe("story doctor · iteration 3/10");
    expect(readLoopState(root)!.iteration).toBe(3);
  });

  it("falls back to the issue kind when a hard issue carries no detail", async () => {
    const root = await makeRoot();
    writeLoopState(root, baseState());
    const r = await runTick({
      root,
      doctor: () => ({ ok: false, issues: [{ kind: "corrupt", hard: true }], fixed: [] }),
    });
    expect(r.decision).toBe("block");
    expect(r.reason).toContain("- corrupt"); // detail ?? kind
  });

  it("scopes the goal: epic:<id> drains independently of the rest of the board", async () => {
    const root = await makeRoot();
    writeLoopState(root, { ...baseState(), goal: "epic:st-9c01" });
    const stories = [
      sampleStory({ id: "st-9c01", status: "done" }),
      sampleStory({ id: "st-kid1", epic: "st-9c01", status: "done" }),
      sampleStory({ id: "st-else", status: "todo" }), // outside the goal
    ];
    const r = await runTick({ root, stories });
    expect(r.decision).toBe("allow");
    expect(r.summary).toMatch(/Goal complete/);
  });

  it("tick auto-fixes merged-local: an in-review story whose branch landed on main flips to done", async () => {
    const root = await makeGitRoot({ merge: "local" });
    await writeFile(join(root, "stories/st-4e6d-merged.md"), diskStory("st-4e6d", "Merged story", "in-review"));
    const wt = join(root, ".worktrees/st-4e6d");
    gitq(root, "worktree", "add", "-q", "-b", "story/st-4e6d", wt, "main");
    await writeFile(join(wt, "reviewed.ts"), "x");
    gitq(wt, "add", "reviewed.ts");
    gitq(wt, "commit", "-qm", "work");
    gitq(root, "merge", "--no-ff", "-q", "story/st-4e6d", "-m", "human merge");
    writeLoopState(root, baseState());
    const r = await tick("sess-1", { root }); // DEFAULT collaborators — the real runDoctor fixes, then the tick sees it
    expect(r.decision).toBe("allow");
    expect(r.summary).toMatch(/Goal complete/);
    expect(loadStories(root, { storiesDir: "stories" }).find((s: any) => s.id === "st-4e6d")!.status).toBe("done");
    expect(existsSync(wt)).toBe(false); // teardown ran
  });

  it("tick auto-fixes stale leases: an expired in-progress claim is reclaimed and redispatched", async () => {
    const root = await makeGitRoot();
    await writeFile(
      join(root, "stories/st-5a1e-stale.md"),
      diskStory("st-5a1e", "Stale story", "in-progress",
        ["claim: {session: dead-worker, lease: 2020-01-01T00:00:00.000Z}"]),
    );
    writeLoopState(root, { ...baseState(), attempts: {} });
    const r = await tick("sess-1", { root }); // DEFAULT collaborators
    expect(r.decision).toBe("block"); // reclaimed to todo -> ready -> dispatched this very tick
    expect(r.reason).toContain("st-5a1e - Stale story");
    const s = loadStories(root, { storiesDir: "stories" }).find((x: any) => x.id === "st-5a1e")!;
    expect(s.status).toBe("todo");
    expect(s.claim).toBeUndefined();
  });
});

describe("loop CLI subcommands", () => {
  it("start writes state with the config-default budget; a second start fails", async () => {
    const root = await makeRoot({ budgets: { maxIterations: 7, maxFixRoundsPerStory: 3 } });
    const r = await runLoopCommand(["start", "--goal", "epic:st-9c01"], { root });
    expect(r).toMatchObject({ started: true, goal: "epic:st-9c01", iteration: 0, max_iterations: 7 });
    expect(readLoopState(root)!.goal).toBe("epic:st-9c01");
    await expect(runLoopCommand(["start"], { root })).rejects.toThrow(/already active/);
  });

  it("start accepts --key=value syntax (shared cli.mjs parser, not the old weaker one)", async () => {
    const root = await makeRoot({ budgets: { maxIterations: 7, maxFixRoundsPerStory: 3 } });
    const r = await runLoopCommand(["start", "--goal=epic:st-9c01", "--max-iterations=3"], { root });
    expect(r).toMatchObject({ started: true, goal: "epic:st-9c01", max_iterations: 3 });
  });

  it("start --max-iterations overrides config", async () => {
    const root = await makeRoot();
    const r = await runLoopCommand(["start", "--max-iterations", "3"], { root });
    expect(r.max_iterations).toBe(3);
  });

  it("status reports active and inactive loops", async () => {
    const root = await makeRoot();
    expect(await runLoopCommand(["status"], { root })).toEqual({ active: false });
    writeLoopState(root, baseState());
    expect(await runLoopCommand(["status"], { root })).toMatchObject({ active: true, iteration: 2 });
  });

  it("stop deletes the state file and is idempotent", async () => {
    const root = await makeRoot();
    writeLoopState(root, baseState());
    expect(await runLoopCommand(["stop"], { root })).toEqual({ stopped: true });
    expect(existsSync(loopStatePath(root))).toBe(false);
    expect(await runLoopCommand(["stop"], { root })).toEqual({ stopped: false });
  });

  it("tick --hook shapes a block into Stop-hook JSON", async () => {
    const root = await makeRoot();
    writeLoopState(root, { ...baseState(), attempts: {} });
    const out = await runLoopCommand(["tick", "--hook"], {
      root,
      stdinText: JSON.stringify({ session_id: "sess-1", hook_event_name: "Stop", stop_hook_active: false }),
      tickDeps: { loadStories: () => [sampleStory()], computeReady: todoReady, doctor: okDoctor, readLearnings: () => "" },
    });
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("st-a1b2");
    expect(out.systemMessage).toBe("story st-a1b2 · iteration 3/10");
  });

  it("tick --hook maps allow-with-summary onto systemMessage only", async () => {
    const root = await makeRoot();
    writeLoopState(root, { ...baseState(), iteration: 10 });
    const out = await runLoopCommand(["tick", "--hook"], {
      root,
      stdinText: JSON.stringify({ session_id: "sess-1" }),
      tickDeps: { loadStories: () => [sampleStory()], computeReady: todoReady, doctor: okDoctor, readLearnings: () => "" },
    });
    expect(out.decision).toBeUndefined();
    expect(out.systemMessage).toMatch(/budget exhausted/i);
  });

  it("tick --hook returns {} on garbage stdin and never throws", async () => {
    const root = await makeRoot();
    const out = await runLoopCommand(["tick", "--hook"], { root, stdinText: "not json" });
    expect(out).toEqual({});
  });

  it("learn appends to the shared learnings file (design §6 cross-pollination)", async () => {
    const root = await makeRoot();
    expect(await runLoopCommand(["learn", "prefer", "bun", "test"], { root })).toEqual({ learned: true });
    expect(await readFile(learningsPath(root), "utf8")).toContain("prefer bun test");
    await expect(runLoopCommand(["learn"], { root })).rejects.toThrow(/needs text/);
  });

  it("unknown subcommand throws", async () => {
    await expect(runLoopCommand(["frobnicate"], { root: await makeRoot() })).rejects.toThrow(/unknown loop subcommand/);
  });
});
