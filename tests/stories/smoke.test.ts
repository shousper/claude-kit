import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { makeRepo, STORY_BIN } from "./helpers";

// Spawn the real binary (shebang → node), exactly as hooks and skills will.
function story(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync({ cmd: [STORY_BIN, ...args], cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};

describe("bin/story end-to-end", () => {
  test("create → ready → claim → work → done drives a story to merged", async () => {
    const repo = await makeRepo();

    const created = story(repo.root, "create", "--title", "Smoke story", "--type", "chore", "--json");
    expect(created.code).toBe(0);
    const { id } = JSON.parse(created.stdout) as { id: string };
    expect(id).toMatch(/^st-[0-9a-f]{4}$/);

    const ready = story(repo.root, "ready", "--json");
    expect(ready.code).toBe(0);
    expect((JSON.parse(ready.stdout) as Array<{ id: string }>).map((s) => s.id)).toEqual([id]);

    expect(story(repo.root, "claim", id, "--session", "smoke").code).toBe(0);
    const wt = join(repo.root, ".worktrees", id);
    await Bun.write(join(wt, "smoke.txt"), "hello\n");
    git(wt, "add", "smoke.txt");
    git(wt, "commit", "-m", "smoke work");

    // note + show work from INSIDE the worktree (findRoot via git-common-dir)
    expect(story(wt, "note", id, "--body", "working from the worktree").code).toBe(0);

    expect(story(repo.root, "done", id, "--allow-unplanned").code).toBe(0);
    expect(existsSync(join(repo.root, "smoke.txt"))).toBe(true); // merged into main
    expect(existsSync(wt)).toBe(false); // worktree torn down

    const shown = story(repo.root, "show", id, "--json");
    expect((JSON.parse(shown.stdout) as { status: string }).status).toBe("done");

    expect(story(repo.root, "doctor", "--quiet").code).toBe(0);
    expect(story(repo.root, "archive", "--json").code).toBe(0);
    expect(existsSync(join(repo.root, "stories/archive"))).toBe(true);
    await repo.cleanup();
  }, 30_000);

  test("errors follow the convention through the binary: exit 1 + {error} JSON on stderr", async () => {
    const repo = await makeRepo();
    const r = story(repo.root, "done", "st-zzzz");
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(JSON.parse(r.stderr)).toEqual({ error: expect.stringContaining("st-zzzz") });
    await repo.cleanup();
  });
});
