import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFileSync as writeSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CliError } from "../../plugins/stories/lib/util.mjs";
import { lockPath, withLock } from "../../plugins/stories/lib/locks.mjs";
import { makeRepo, STORIES_LIB } from "./helpers";

describe("withLock", () => {
  test("runs fn, returns its result, and removes the lockfile", async () => {
    const repo = await makeRepo();
    const result = await withLock(repo.root, "board", async () => {
      expect(existsSync(lockPath(repo.root, "board"))).toBe(true);
      return 42;
    });
    expect(result).toBe(42);
    expect(existsSync(lockPath(repo.root, "board"))).toBe(false);
    await repo.cleanup();
  });

  test("releases the lock even when fn throws", async () => {
    const repo = await makeRepo();
    await expect(withLock(repo.root, "board", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(existsSync(lockPath(repo.root, "board"))).toBe(false);
    await repo.cleanup();
  });

  test("different lock names do not contend", async () => {
    const repo = await makeRepo();
    await withLock(repo.root, "board", () =>
      withLock(repo.root, "merge", async () => "nested", { timeoutMs: 500 }),
    );
    await repo.cleanup();
  });

  test("times out with CliError code LOCK_TIMEOUT when held by a live process", async () => {
    const repo = await makeRepo();
    mkdirSync(join(repo.root, ".claude", "locks"), { recursive: true });
    // Held by *this* (alive) process, freshly — not reclaimable.
    writeFileSync(lockPath(repo.root, "board"), JSON.stringify({ pid: process.pid, at: Date.now() }));
    const err = await withLock(repo.root, "board", async () => "never", { timeoutMs: 300, pollMs: 25 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe("LOCK_TIMEOUT"); // pinned: E10's sweep contention catch keys on this
    expect(err.message).toMatch(/timed out/);
    await repo.cleanup();
  });
});

describe("stale reclaim", () => {
  const plant = (root: string, body: string) => {
    mkdirSync(join(root, ".claude", "locks"), { recursive: true });
    writeFileSync(lockPath(root, "board"), body);
  };

  test("reclaims when old AND pid is dead", async () => {
    const repo = await makeRepo();
    plant(repo.root, JSON.stringify({ pid: 999_999_999, at: Date.now() - 60_000 }));
    const r = await withLock(repo.root, "board", async () => "won", { timeoutMs: 2_000, staleMs: 30_000 });
    expect(r).toBe("won");
    await repo.cleanup();
  });

  test("does NOT reclaim when old but pid is alive", async () => {
    const repo = await makeRepo();
    plant(repo.root, JSON.stringify({ pid: process.pid, at: Date.now() - 60_000 }));
    await expect(
      withLock(repo.root, "board", async () => "never", { timeoutMs: 300, staleMs: 30_000, pollMs: 25 }),
    ).rejects.toThrow(/timed out/);
    await repo.cleanup();
  });

  test("does NOT reclaim a fresh lock even with a dead pid", async () => {
    const repo = await makeRepo();
    plant(repo.root, JSON.stringify({ pid: 999_999_999, at: Date.now() }));
    await expect(
      withLock(repo.root, "board", async () => "never", { timeoutMs: 300, staleMs: 30_000, pollMs: 25 }),
    ).rejects.toThrow(/timed out/);
    await repo.cleanup();
  });

  test("reclaims a corrupt lockfile", async () => {
    const repo = await makeRepo();
    plant(repo.root, "not json at all");
    const r = await withLock(repo.root, "board", async () => "won", { timeoutMs: 2_000 });
    expect(r).toBe("won");
    await repo.cleanup();
  });
});

describe("cross-process mutual exclusion", () => {
  test("two concurrent processes never overlap inside the lock", async () => {
    const repo = await makeRepo();
    const locksUrl = pathToFileURL(join(STORIES_LIB, "locks.mjs")).href;
    const worker = join(repo.root, "worker.mjs");
    writeSync(
      worker,
      [
        `import { withLock } from ${JSON.stringify(locksUrl)};`,
        `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";`,
        `import { setTimeout as sleep } from "node:timers/promises";`,
        `const root = process.argv[2];`,
        `await withLock(root, "board", async () => {`,
        `  appendFileSync(root + "/trace.txt", "start " + process.pid + "\\n");`,
        `  const n = Number(readFileSync(root + "/counter.txt", "utf8"));`,
        `  await sleep(150);`,
        `  writeFileSync(root + "/counter.txt", String(n + 1));`,
        `  appendFileSync(root + "/trace.txt", "end " + process.pid + "\\n");`,
        `});`,
      ].join("\n"),
    );
    writeSync(join(repo.root, "counter.txt"), "0");
    writeSync(join(repo.root, "trace.txt"), "");

    const spawnWorker = () =>
      Bun.spawn({ cmd: [process.execPath, worker, repo.root], cwd: repo.root, stdout: "pipe", stderr: "pipe" });
    const [a, b] = [spawnWorker(), spawnWorker()];
    const [ca, cb] = await Promise.all([a.exited, b.exited]);
    expect(ca).toBe(0);
    expect(cb).toBe(0);

    // Lost-update check: read-modify-write with a 150 ms sleep inside the
    // critical section — without the lock this reliably yields "1".
    expect(readFileSync(join(repo.root, "counter.txt"), "utf8")).toBe("2");
    // No interleaving: strictly start/end pairs.
    expect(readFileSync(join(repo.root, "trace.txt"), "utf8")).toMatch(
      /^start (\d+)\nend \1\nstart (\d+)\nend \2\n$/,
    );
    await repo.cleanup();
  }, 15_000);
});
