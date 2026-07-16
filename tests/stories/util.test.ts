import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CliError, nowISO, run, runOk, todayISO, writeFileAtomic } from "../../plugins/stories/lib/util.mjs";
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
