import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  actualDiff,
  branchName,
  createWorktree,
  integrateSelf,
  isMergedLocal,
  reconcileTouches,
  teardown,
  worktreePath,
} from "../../plugins/stories/lib/worktrees.mjs";
import { makeRepo, type Repo } from "./helpers";

const gitIn = (repo: Repo, cwd: string, ...args: string[]) => {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
};

describe("createWorktree", () => {
  test("creates .worktrees/<id> on branch story/<id> off main", async () => {
    const repo = await makeRepo();
    const path = createWorktree(repo.root, "st-4f2a");
    expect(path).toBe(join(repo.root, ".worktrees", "st-4f2a"));
    expect(existsSync(path)).toBe(true);
    expect(gitIn(repo, path, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("story/st-4f2a");
    await repo.cleanup();
  });

  test("is idempotent when the worktree exists, and reuses an existing branch", async () => {
    const repo = await makeRepo();
    createWorktree(repo.root, "st-4f2a");
    expect(createWorktree(repo.root, "st-4f2a")).toBe(worktreePath(repo.root, "st-4f2a"));
    // simulate feedback round: worktree torn down, branch kept
    gitIn(repo, repo.root, "worktree", "remove", "--force", worktreePath(repo.root, "st-4f2a"));
    const path = createWorktree(repo.root, "st-4f2a");
    expect(gitIn(repo, path, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("story/st-4f2a");
    await repo.cleanup();
  });
});

describe("actualDiff", () => {
  test("unions committed, staged, unstaged, and untracked paths", async () => {
    const repo = await makeRepo();
    const wt = createWorktree(repo.root, "st-4f2a");
    writeFileSync(join(wt, "committed.ts"), "a");
    gitIn(repo, wt, "add", "committed.ts");
    gitIn(repo, wt, "commit", "-m", "c");
    writeFileSync(join(wt, "staged.ts"), "b");
    gitIn(repo, wt, "add", "staged.ts");
    writeFileSync(join(wt, "README.md"), "# modified fixture\n"); // unstaged edit of tracked file
    mkdirSync(join(wt, "sub"));
    writeFileSync(join(wt, "sub", "untracked.ts"), "c");
    expect(actualDiff(repo.root, "st-4f2a")).toEqual([
      "README.md",
      "committed.ts",
      "staged.ts",
      "sub/untracked.ts",
    ]);
    await repo.cleanup();
  });

  test("returns [] when the worktree does not exist", async () => {
    const repo = await makeRepo();
    expect(actualDiff(repo.root, "st-0000")).toEqual([]);
    await repo.cleanup();
  });

  test("surfaces a git failure instead of silently reporting no changes", async () => {
    const repo = await makeRepo();
    createWorktree(repo.root, "st-4f2a");
    // A git that crashes must NOT look like an empty diff — that would
    // under-report the story's footprint into computeReady / reconcileTouches.
    const failingExec = (cmd: string, args: string[]) => ({
      code: 128,
      stdout: "",
      stderr: `fatal: bad revision '${args.join(" ")}'`,
    });
    expect(() => actualDiff(repo.root, "st-4f2a", { exec: failingExec })).toThrow(/failed \(128\)/);
    await repo.cleanup();
  });
});

describe("branchName", () => {
  test("story/<id>", () => {
    expect(branchName("st-4f2a")).toBe("story/st-4f2a");
  });
});

describe("integrateSelf", () => {
  test("merges the story branch into main under the merge lock, tears down worktree+branch", async () => {
    const repo = await makeRepo();
    const wt = createWorktree(repo.root, "st-4f2a");
    writeFileSync(join(wt, "feature.ts"), "code");
    gitIn(repo, wt, "add", "feature.ts");
    gitIn(repo, wt, "commit", "-m", "feature");
    const locked: string[] = [];
    const lock = async (_root: string, name: string, fn: () => unknown) => {
      locked.push(name);
      return fn();
    };
    const r = await integrateSelf(repo.root, { id: "st-4f2a", title: "story: with colon" }, { lock });
    expect(r).toEqual({ merged: true, conflict: false });
    expect(locked).toEqual(["merge"]);
    expect(existsSync(join(repo.root, "feature.ts"))).toBe(true); // landed on main
    expect(existsSync(worktreePath(repo.root, "st-4f2a"))).toBe(false);
    expect(gitIn(repo, repo.root, "branch", "--list", "story/st-4f2a").trim()).toBe("");
    expect(gitIn(repo, repo.root, "log", "-1", "--format=%s")).toContain("story st-4f2a");
    await repo.cleanup();
  });

  test("conflict → aborts the merge cleanly, keeps worktree and branch, reports conflict", async () => {
    const repo = await makeRepo();
    const wt = createWorktree(repo.root, "st-4f2a");
    writeFileSync(join(wt, "shared.txt"), "worktree version\n");
    gitIn(repo, wt, "add", "shared.txt");
    gitIn(repo, wt, "commit", "-m", "worktree side");
    writeFileSync(join(repo.root, "shared.txt"), "main version\n");
    gitIn(repo, repo.root, "add", "shared.txt");
    gitIn(repo, repo.root, "commit", "-m", "main side");
    const r = await integrateSelf(repo.root, { id: "st-4f2a", title: "t" }, {});
    expect(r).toEqual({ merged: false, conflict: true });
    expect(gitIn(repo, repo.root, "status", "--porcelain").trim()).toBe(""); // merge aborted, tree clean
    expect(existsSync(worktreePath(repo.root, "st-4f2a"))).toBe(true);
    await repo.cleanup();
  });

  test("refuses when the root checkout is not on the base branch", async () => {
    const repo = await makeRepo();
    createWorktree(repo.root, "st-4f2a");
    gitIn(repo, repo.root, "checkout", "-b", "elsewhere");
    await expect(integrateSelf(repo.root, { id: "st-4f2a", title: "t" }, {})).rejects.toThrow(/on 'main'/);
    await repo.cleanup();
  });
});

describe("isMergedLocal", () => {
  test("true only after the branch landed on base", async () => {
    const repo = await makeRepo();
    const wt = createWorktree(repo.root, "st-4f2a");
    writeFileSync(join(wt, "f.ts"), "x");
    gitIn(repo, wt, "add", "f.ts");
    gitIn(repo, wt, "commit", "-m", "f");
    expect(isMergedLocal(repo.root, "st-4f2a")).toBe(false);
    gitIn(repo, repo.root, "merge", "--no-ff", "story/st-4f2a", "-m", "human merge");
    expect(isMergedLocal(repo.root, "st-4f2a")).toBe(true);
    expect(isMergedLocal(repo.root, "st-0000")).toBe(false); // no branch at all
    await repo.cleanup();
  });
});

describe("teardown", () => {
  test("removes worktree and branch; falls back to rm for unregistered dirs", async () => {
    const repo = await makeRepo();
    createWorktree(repo.root, "st-4f2a");
    teardown(repo.root, "st-4f2a");
    expect(existsSync(worktreePath(repo.root, "st-4f2a"))).toBe(false);
    expect(gitIn(repo, repo.root, "branch", "--list", "story/st-4f2a").trim()).toBe("");
    mkdirSync(worktreePath(repo.root, "st-dead"), { recursive: true }); // orphan dir, not a git worktree
    teardown(repo.root, "st-dead");
    expect(existsSync(worktreePath(repo.root, "st-dead"))).toBe(false);
    await repo.cleanup();
  });

  test("refuses the destructive rm when the worktree entry escapes .worktrees (symlink)", async () => {
    const repo = await makeRepo();
    mkdirSync(join(repo.root, ".worktrees"), { recursive: true });
    // A .worktrees/<id> that is a symlink to a dir OUTSIDE the project. git
    // worktree remove will fail (unregistered), so teardown falls to rmSync —
    // which must refuse because the real path escapes <root>/.worktrees/.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "wt-escape-")));
    writeFileSync(join(outside, "precious.txt"), "do not delete");
    symlinkSync(outside, worktreePath(repo.root, "st-4f2a"));
    expect(() => teardown(repo.root, "st-4f2a")).toThrow(/refusing to remove/);
    expect(existsSync(join(outside, "precious.txt"))).toBe(true); // target untouched
    await repo.cleanup();
  });
});

describe("reconcileTouches", () => {
  test("pins touches to the actual diff; keeps declared when the diff is empty", () => {
    expect(reconcileTouches({ touches: ["src/**"] }, ["src/a.ts", "src/b.ts"]).touches).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(reconcileTouches({ touches: ["src/**"] }, []).touches).toEqual(["src/**"]);
  });
});
