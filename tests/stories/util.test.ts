import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARCHIVE_DIR,
  CliError,
  EVIDENCE_DIR,
  EXIT,
  execError,
  failureOutput,
  GITIGNORE_BLOCK,
  LOCAL_DIR,
  LOCKS_DIR,
  localDir,
  lockPath,
  locksDir,
  learningsPath,
  LOOP_STATE_FILE_RE,
  loopStateFileName,
  loopStatePath,
  nowISO,
  readJson,
  run,
  runOk,
  stateStorePath,
  sweepStatePath,
  evidenceRoot,
  todayISO,
  writeFileAtomic,
  writeJsonAtomic,
  WORKTREES_DIR,
} from "../../shared/stories/lib/util.mjs";
import { makeRepo } from "./helpers";

describe("run", () => {
  test("captures exit code and stdout", () => {
    const r = run("sh", ["-c", "echo hi"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("hi\n");
  });

  test("non-zero exit is returned, not thrown", () => {
    expect(run("sh", ["-c", "exit 3"]).code).toBe(3);
  });
});

describe("runOk", () => {
  test("throws CliError with stderr on failure", () => {
    expect(() => runOk("sh", ["-c", "echo boom >&2; exit 1"])).toThrow(CliError);
    expect(() => runOk("sh", ["-c", "echo boom >&2; exit 1"])).toThrow(/boom/);
  });

  test("uses the injected exec", () => {
    const fake = () => ({ code: 0, stdout: "faked", stderr: "" });
    expect(runOk("nonexistent-cmd", [], {}, fake).stdout).toBe("faked");
  });
});

describe("CliError", () => {
  test("defaults exitCode 1 and code null, carries overrides", () => {
    expect(new CliError("x").exitCode).toBe(1);
    expect(new CliError("x").code).toBeNull();
    expect(new CliError("x", { exitCode: 2 }).exitCode).toBe(2);
    expect(new CliError("x", { code: "LOCK_TIMEOUT" }).code).toBe("LOCK_TIMEOUT");
  });
});

describe("writeFileAtomic", () => {
  test("creates parent dirs and writes content", async () => {
    const repo = await makeRepo();
    const target = join(repo.root, "deep/nested/file.txt");
    writeFileAtomic(target, "content");
    expect(readFileSync(target, "utf8")).toBe("content");
    expect(existsSync(join(repo.root, "deep/nested"))).toBe(true);
    await repo.cleanup();
  });
});

describe("dates", () => {
  test("todayISO is YYYY-MM-DD, nowISO is full ISO", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nowISO()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("path segment constants", () => {
  test("name the state-root subdirectories", () => {
    expect(WORKTREES_DIR).toBe(".worktrees");
    expect(ARCHIVE_DIR).toBe("archive");
    expect(LOCKS_DIR).toBe("locks");
    expect(EVIDENCE_DIR).toBe("evidence");
  });

  test("GITIGNORE_BLOCK is built from WORKTREES_DIR and LOCAL_DIR", () => {
    expect(GITIGNORE_BLOCK).toBe(`${WORKTREES_DIR}/\n${LOCAL_DIR}/\n`);
  });
});

describe("local-state path builders", () => {
  test("build paths under localDir(root)", async () => {
    const repo = await makeRepo();
    expect(stateStorePath(repo.root)).toBe(join(localDir(repo.root), "state.json"));
    expect(learningsPath(repo.root)).toBe(join(localDir(repo.root), "learnings.md"));
    expect(sweepStatePath(repo.root)).toBe(join(localDir(repo.root), "sweep.json"));
    expect(locksDir(repo.root)).toBe(join(localDir(repo.root), "locks"));
    expect(lockPath(repo.root, "board")).toBe(join(locksDir(repo.root), "board.lock"));
    expect(evidenceRoot(repo.root)).toBe(join(localDir(repo.root), "evidence"));
    await repo.cleanup();
  });
});

describe("loop state file naming", () => {
  test("loopStateFileName sanitizes characters unsafe in a filename", () => {
    expect(loopStateFileName("abc-123_XYZ")).toBe("loop.abc-123_XYZ.md");
    expect(loopStateFileName("weird/id:1")).toBe("loop.weird_id_1.md");
  });

  test("loopStatePath joins localDir(root) with the sanitized filename", async () => {
    const repo = await makeRepo();
    expect(loopStatePath(repo.root, "sess-1")).toBe(join(localDir(repo.root), "loop.sess-1.md"));
    await repo.cleanup();
  });

  test("LOOP_STATE_FILE_RE matches loop state filenames only", () => {
    expect(LOOP_STATE_FILE_RE.test("loop.sess-1.md")).toBe(true);
    expect(LOOP_STATE_FILE_RE.test("state.json")).toBe(false);
    expect(LOOP_STATE_FILE_RE.test("learnings.md")).toBe(false);
  });
});

describe("readJson / writeJsonAtomic", () => {
  test("round-trips a value through disk as pretty, newline-terminated JSON", async () => {
    const repo = await makeRepo();
    const target = join(repo.root, "data.json");
    writeJsonAtomic(target, { a: 1 });
    expect(readFileSync(target, "utf8")).toBe('{\n  "a": 1\n}\n');
    expect(readJson(target)).toEqual({ a: 1 });
    await repo.cleanup();
  });
});

describe("exec failure helpers", () => {
  test("failureOutput prefers stderr, falls back to stdout, and trims", () => {
    expect(failureOutput({ stderr: "  boom  ", stdout: "" })).toBe("boom");
    expect(failureOutput({ stderr: "", stdout: "  out  " })).toBe("out");
  });

  test("execError builds a CliError naming the command, exit code, and output", () => {
    const err = execError("git", ["push"], { code: 1, stderr: "rejected", stdout: "" });
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toBe("git push failed (exit 1): rejected");
  });
});

describe("EXIT", () => {
  test("defines OK, ERROR, DENY and is frozen", () => {
    expect(EXIT).toEqual({ OK: 0, ERROR: 1, DENY: 2 });
    expect(Object.isFrozen(EXIT)).toBe(true);
  });
});
