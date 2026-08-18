import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadStories, readStateStore } from "../../plugins/stories/lib/board.mjs";
import { CliError } from "../../plugins/stories/lib/util.mjs";
import { flipStatus, runDoctor } from "../../plugins/stories/lib/doctor.mjs";
import { DEFAULT_CONFIG, makeRepo, runStory, storyText, writeStoryFile } from "./helpers";

type Issue = { kind: string; id?: string; dep?: string; ids?: string[]; hard?: boolean };
const kinds = (issues: Issue[]) => issues.map((i) => i.kind).sort();

const CONFIG = { storiesDir: "stories" };
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};

describe("story doctor — detection", () => {
  test("healthy board → exit 0, no issues", async () => {
    const repo = await makeRepo();
    // status omitted from frontmatter (defaults to "todo" via the overlay) —
    // a raw status field here would itself be a frontmatter-state issue.
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a" }));
    const r = await runStory(repo.root, ["doctor", "--json"]);
    expect(r.code).toBe(0);
    expect((r.json() as { issues: Issue[] }).issues).toEqual([]);
    await repo.cleanup();
  });

  test("detects dangling deps, cycles, illegal status, unadopted files, stale leases, orphan worktrees", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "todo", depends_on: "[st-dead]" }));
    await writeStoryFile(repo.root, "st-0002-b.md", storyText({ id: "st-0002", title: "b", status: "todo", depends_on: "[st-0003]" }));
    await writeStoryFile(repo.root, "st-0003-c.md", storyText({ id: "st-0003", title: "c", status: "todo", depends_on: "[st-0002]" }));
    await writeStoryFile(repo.root, "st-0004-d.md", storyText({ id: "st-0004", title: "d", status: "doing" }));
    await writeStoryFile(repo.root, "hand-written-idea.md", "---\ntitle: an idea\n---\n\njust a thought\n");
    await writeStoryFile(
      repo.root,
      "st-0005-e.md",
      storyText({
        id: "st-0005", title: "e", status: "in-progress",
        claim: "{session: dead-worker, lease: 2020-01-01T00:00:00.000Z}",
      }),
    );
    mkdirSync(join(repo.root, ".worktrees/st-90e0"), { recursive: true });

    const r = await runStory(repo.root, ["doctor", "--json"]);
    expect(r.code).toBe(0); // soft issues do not fail the command
    const { issues } = r.json() as { issues: Issue[] };
    expect(kinds(issues)).toEqual(
      // frontmatter-state fires for every story above with a raw status field
      // still in its file (st-0001/0002/0003/0005 — st-0004 is skipped, its
      // status is illegal so it never reaches the state-fields check).
      [
        "cycle", "dangling-dep",
        "frontmatter-state", "frontmatter-state", "frontmatter-state", "frontmatter-state",
        "invalid", "orphan-worktree", "stale-lease", "unadopted",
      ].sort(),
    );
    expect(issues.find((i) => i.kind === "dangling-dep")).toMatchObject({ id: "st-0001", dep: "st-dead" });
    expect(issues.find((i) => i.kind === "cycle")!.ids).toEqual(expect.arrayContaining(["st-0002", "st-0003"]));
    expect(issues.find((i) => i.kind === "stale-lease")).toMatchObject({ id: "st-0005" });
    expect(issues.find((i) => i.kind === "orphan-worktree")).toMatchObject({ id: "st-90e0" });
    await repo.cleanup();
  });

  test("unparseable story file is HARD corruption → exit 1", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", "no frontmatter here at all");
    const r = await runStory(repo.root, ["doctor", "--json"]);
    expect(r.code).toBe(1);
    const { issues } = r.json() as { issues: Issue[] };
    expect(issues[0]).toMatchObject({ kind: "corrupt", hard: true });
    await repo.cleanup();
  });

  test("--quiet prints nothing when healthy, the report when not", async () => {
    const repo = await makeRepo();
    const quiet = await runStory(repo.root, ["doctor", "--quiet"]);
    expect(quiet.code).toBe(0);
    expect(quiet.stdout).toBe("");
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "doing" }));
    const noisy = await runStory(repo.root, ["doctor", "--quiet", "--json"]);
    expect(noisy.stdout).not.toBe("");
    await repo.cleanup();
  });

  test("surfaces a malformed (traversal) story id as an invalid-id issue instead of using it", async () => {
    const repo = await makeRepo();
    await writeStoryFile(
      repo.root,
      "evil.md",
      storyText({ id: '"../../../../tmp/evil"', title: "evil", status: "in-progress" }),
    );
    const r = await runStory(repo.root, ["doctor", "--json"]);
    expect(r.code).toBe(0); // soft issue, not a hard corruption
    const invalid = (r.json() as { issues: Issue[] }).issues.find((i) => i.kind === "invalid-id");
    expect(invalid).toBeDefined();
    await repo.cleanup();
  });

  test("a fresh lease is not stale", async () => {
    const repo = await makeRepo();
    await writeStoryFile(
      repo.root,
      "st-0001-a.md",
      storyText({
        id: "st-0001", title: "a", status: "in-progress",
        claim: `{session: live, lease: ${new Date().toISOString()}}`,
      }),
    );
    const r = await runStory(repo.root, ["doctor", "--json"]);
    expect((r.json() as { issues: Issue[] }).issues.filter((i) => i.kind === "stale-lease")).toEqual([]);
    await repo.cleanup();
  });

  test("detects an in-progress story with a live claim but no worktree as missing-worktree", async () => {
    const repo = await makeRepo();
    // Fresh (non-stale) lease, in-progress, claimed — but NO .worktrees/st-0001
    // dir. Invisible to `story ready` (still claimed) and to stale-lease until
    // STALE_LEASE_MS elapses; doctor must surface it now.
    await writeStoryFile(
      repo.root,
      "st-0001-a.md",
      storyText({
        id: "st-0001", title: "a", status: "in-progress",
        claim: `{session: live, lease: ${new Date().toISOString()}}`,
      }),
    );
    const r = await runStory(repo.root, ["doctor", "--json"]);
    expect(r.code).toBe(0); // soft issue
    const { issues } = r.json() as { issues: Issue[] };
    expect(issues.find((i) => i.kind === "missing-worktree")).toMatchObject({ id: "st-0001" });
    expect(issues.find((i) => i.kind === "stale-lease")).toBeUndefined(); // fresh lease → not stale
    await repo.cleanup();
  });

  test("a stale claim with no worktree is reported as stale-lease, not missing-worktree (mutually exclusive)", async () => {
    const repo = await makeRepo();
    await writeStoryFile(
      repo.root,
      "st-0001-a.md",
      storyText({
        id: "st-0001", title: "a", status: "in-progress",
        claim: "{session: dead, lease: 2020-01-01T00:00:00.000Z}",
      }),
    );
    const { issues } = (await runStory(repo.root, ["doctor", "--json"])).json() as { issues: Issue[] };
    expect(issues.find((i) => i.kind === "stale-lease")).toMatchObject({ id: "st-0001" });
    expect(issues.find((i) => i.kind === "missing-worktree")).toBeUndefined();
    await repo.cleanup();
  });
});

describe("story doctor --fix", () => {
  test("reclaims stale leases (todo, claim cleared, worktree preserved)", async () => {
    const repo = await makeRepo();
    await writeStoryFile(
      repo.root,
      "st-0001-a.md",
      storyText({
        id: "st-0001", title: "a", status: "in-progress",
        claim: "{session: dead, lease: 2020-01-01T00:00:00.000Z}",
      }),
    );
    git(repo.root, "worktree", "add", "-b", "story/st-0001", join(repo.root, ".worktrees/st-0001"), "main");
    const r = await runStory(repo.root, ["doctor", "--fix", "--json"]);
    expect(r.code).toBe(0);
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s.status).toBe("todo");
    expect(s.claim).toBeUndefined();
    expect(existsSync(join(repo.root, ".worktrees/st-0001"))).toBe(true); // partial work preserved
    await repo.cleanup();
  });

  test("removes dangling deps, adopts hand-written files with id + defaults + rename", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "todo", depends_on: "[st-dead, st-0002]" }));
    await writeStoryFile(repo.root, "st-0002-b.md", storyText({ id: "st-0002", title: "b", status: "done" }));
    await writeStoryFile(repo.root, "my-great-idea.md", "---\ntitle: My great idea\npriority: P1\n---\n\n## Description\n\nkeep me\n");
    const r = await runStory(repo.root, ["doctor", "--fix", "--json"]);
    expect(r.code).toBe(0);
    const stories = loadStories(repo.root, CONFIG);
    expect(stories.find((s) => s.id === "st-0001")!.depends_on).toEqual(["st-0002"]);
    const adopted = stories.find((s) => s.title === "My great idea")!;
    expect(adopted.id).toMatch(/^st-[0-9a-f]{4}$/);
    expect(adopted.status).toBe("todo");
    expect(adopted.priority).toBe("P1"); // hand-written values kept
    expect(adopted.body).toContain("keep me");
    expect(adopted.file).toBe(join(repo.root, "stories", `${adopted.id}-my-great-idea.md`));
    expect(existsSync(join(repo.root, "stories/my-great-idea.md"))).toBe(false);
    await repo.cleanup();
  });

  test("repairs illegal status to todo, removes orphan worktrees, leaves cycles for humans", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0004-d.md", storyText({ id: "st-0004", title: "d", status: "doing" }));
    await writeStoryFile(repo.root, "st-0002-b.md", storyText({ id: "st-0002", title: "b", status: "todo", depends_on: "[st-0003]" }));
    await writeStoryFile(repo.root, "st-0003-c.md", storyText({ id: "st-0003", title: "c", status: "todo", depends_on: "[st-0002]" }));
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(repo.root, ".worktrees/st-90e0"), { recursive: true });
    const r = await runStory(repo.root, ["doctor", "--fix", "--json"]);
    expect(r.code).toBe(0);
    expect(loadStories(repo.root, CONFIG).find((s) => s.id === "st-0004")!.status).toBe("todo");
    expect(existsSync(join(repo.root, ".worktrees/st-90e0"))).toBe(false);
    const again = await runStory(repo.root, ["doctor", "--json"]);
    expect((again.json() as { issues: Array<{ kind: string }> }).issues.map((i) => i.kind)).toEqual(["cycle"]);
    await repo.cleanup();
  });

  test("local mode: flips merged in-review stories to done and tears down", async () => {
    const repo = await makeRepo({ ...DEFAULT_CONFIG, merge: "local" });
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "in-review" }));
    const wt = join(repo.root, ".worktrees/st-0001");
    git(repo.root, "worktree", "add", "-b", "story/st-0001", wt, "main");
    await Bun.write(join(wt, "reviewed.ts"), "x");
    git(wt, "add", "reviewed.ts");
    git(wt, "commit", "-m", "work");
    git(repo.root, "merge", "--no-ff", "story/st-0001", "-m", "human merge");
    const r = await runStory(repo.root, ["doctor", "--fix", "--json"]);
    expect(r.code).toBe(0);
    expect(loadStories(repo.root, CONFIG)[0].status).toBe("done");
    expect(existsSync(wt)).toBe(false);
    await repo.cleanup();
  });

  test("self mode: a story stranded in-progress AFTER its merge landed flips to done, not todo", async () => {
    const repo = await makeRepo();
    // The crash shape: `story done` merged and tore down the worktree+branch,
    // then died before the status write. Stale lease on top pins the ordering —
    // merged-self must win over the stale-lease/missing-worktree todo-reclaims,
    // which would send a worker off to redo already-merged work.
    await writeStoryFile(
      repo.root,
      "st-0001-a.md",
      storyText({
        id: "st-0001", title: "a", status: "in-progress",
        claim: "{session: crashed, lease: 2020-01-01T00:00:00.000Z}",
      }),
    );
    const wt = join(repo.root, ".worktrees/st-0001");
    git(repo.root, "worktree", "add", "-b", "story/st-0001", wt, "main");
    writeFileSync(join(wt, "impl.ts"), "code\n");
    git(wt, "add", "impl.ts");
    git(wt, "commit", "-m", "implement");
    git(repo.root, "merge", "--no-ff", "story/st-0001", "-m", "story st-0001: a");
    git(repo.root, "worktree", "remove", "--force", wt);
    git(repo.root, "branch", "-D", "story/st-0001");

    const detect = await runStory(repo.root, ["doctor", "--json"]);
    const { issues } = detect.json() as { issues: Issue[] };
    expect(issues.find((i) => i.kind === "merged-self")).toMatchObject({ id: "st-0001" });
    expect(issues.find((i) => i.kind === "stale-lease")).toBeUndefined();
    expect(issues.find((i) => i.kind === "missing-worktree")).toBeUndefined();

    const r = await runStory(repo.root, ["doctor", "--fix", "--json"]);
    expect(r.code).toBe(0);
    expect((r.json() as { fixed: Array<{ kind: string; id: string }> }).fixed)
      .toContainEqual({ kind: "done", id: "st-0001" });
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s.status).toBe("done");
    expect(s.claim).toBeUndefined();
    await repo.cleanup();
  });

  test("reclaims a missing-worktree story to todo and clears the claim", async () => {
    const repo = await makeRepo();
    await writeStoryFile(
      repo.root,
      "st-0001-a.md",
      storyText({
        id: "st-0001", title: "a", status: "in-progress",
        claim: `{session: live, lease: ${new Date().toISOString()}}`,
      }),
    );
    // No worktree exists for st-0001. --fix reclaims it so a worker sees it.
    const r = await runStory(repo.root, ["doctor", "--fix", "--json"]);
    expect(r.code).toBe(0);
    const { fixed } = r.json() as { fixed: Array<{ kind: string; id: string }> };
    expect(fixed).toContainEqual({ kind: "worktree-reclaimed", id: "st-0001" });
    const s = loadStories(repo.root, CONFIG)[0];
    expect(s.status).toBe("todo");
    expect(s.claim).toBeUndefined();
    // Board is now healthy — the reclaimed story is a clean todo.
    const again = await runStory(repo.root, ["doctor", "--json"]);
    expect((again.json() as { issues: Issue[] }).issues).toEqual([]);
    await repo.cleanup();
  });

  test("an illegal doctor status change fails loudly through the transition guard", async () => {
    // flipStatus is the single seam every doctor auto-fix routes its status
    // change through; it must reject any move the state machine forbids
    // (done is terminal) rather than silently writing an illegal status.
    expect(() => flipStatus({ status: "done" }, "in-progress")).toThrow(CliError);
    expect(() => flipStatus({ status: "done" }, "in-progress")).toThrow(/illegal transition/);
    // A legal doctor move (stale-lease/missing-worktree reclaim) still passes.
    expect(flipStatus({ status: "in-progress" }, "todo").status).toBe("todo");
    expect(flipStatus({ status: "in-review" }, "done").status).toBe("done");
  });

  test("fix restricted to safe kinds: reclaims the stale lease, leaves the unadopted file alone", async () => {
    const repo = await makeRepo();
    await writeStoryFile(
      repo.root,
      "st-0001-a.md",
      storyText({
        id: "st-0001", title: "a", status: "in-progress",
        claim: "{session: dead, lease: 2020-01-01T00:00:00.000Z}",
      }),
    );
    await writeStoryFile(repo.root, "loose-idea.md", "---\ntitle: loose idea\n---\n\nx\n");
    // Exactly the call Section C's loop tick makes (ratified decision):
    // only the safe kinds auto-fix; everything else stays detect-only.
    const report = runDoctor(repo.root, { storiesDir: "stories" }, {
      fix: true,
      kinds: ["merged-local", "stale-lease"],
    });
    expect(report.fixed.map((f: { kind: string }) => f.kind)).toEqual(["lease-reclaimed"]);
    // frontmatter-state is reported (raw status/claim still on disk) but not
    // in the fix kinds list, so it stays detect-only alongside unadopted.
    expect(kinds(report.issues as Issue[])).toEqual(["frontmatter-state", "stale-lease", "unadopted"].sort());
    expect(loadStories(repo.root, CONFIG).find((s) => s.id === "st-0001")!.status).toBe("todo");
    expect(existsSync(join(repo.root, "stories/loose-idea.md"))).toBe(true); // unadopted → detect-only
    await repo.cleanup();
  });

  test("frontmatter-state: doctor --fix migrates status/claim into the store and strips the file", async () => {
    const repo = await makeRepo();
    // write a legacy story file with state in frontmatter (bypass saveStory)
    writeFileSync(
      join(repo.root, "stories", "st-a1a1-legacy.md"),
      "---\nid: st-a1a1\ntitle: Legacy\nstatus: in-progress\nclaim: {session: old, lease: 2026-08-18T00:00:00Z}\n---\n\n## Description\n",
    );
    // a live worktree keeps this out of the unrelated missing-worktree check —
    // this test is isolating the frontmatter-state migration.
    mkdirSync(join(repo.root, ".worktrees", "st-a1a1"), { recursive: true });
    // now pinned just after the lease so it reads as fresh, not stale — this
    // test is about the frontmatter-state migration, not stale-lease reclaim.
    const report = runDoctor(repo.root, DEFAULT_CONFIG, { fix: true, now: Date.parse("2026-08-18T00:00:01Z") });
    expect(report.issues.some((i) => i.kind === "frontmatter-state" && i.id === "st-a1a1")).toBe(true);
    const raw = readFileSync(join(repo.root, "stories", "st-a1a1-legacy.md"), "utf8");
    expect(raw).not.toContain("status:");
    expect(readStateStore(repo.root).stories["st-a1a1"].status).toBe("in-progress");
    await repo.cleanup();
  });
});
