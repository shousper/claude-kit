import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  evidenceDir,
  readVerdict,
  recordVerdict,
  resolveGates,
  runCommandGates,
  unmetReviewGates,
  writeEvidence,
} from "../../plugins/stories/lib/gates.mjs";
import { makeRepo, runStory, storyText, writeStoryFile, DEFAULT_CONFIG } from "./helpers";

const story = (o: Record<string, unknown> = {}) => ({ id: "st-0001", title: "t", type: "feature", ...o });

describe("resolveGates", () => {
  test("story.gates override wins; else defaults[type]; else []", () => {
    expect(resolveGates(story(), DEFAULT_CONFIG).map((g: any) => g.name)).toEqual(["test"]);
    expect(resolveGates(story({ type: "ui" }), DEFAULT_CONFIG).map((g: any) => g.name)).toEqual(["test", "visual"]);
    expect(resolveGates(story({ gates: ["visual"] }), DEFAULT_CONFIG).map((g: any) => g.name)).toEqual(["visual"]);
    expect(resolveGates(story({ type: "unknown-type" }), DEFAULT_CONFIG)).toEqual([]);
    expect(() => resolveGates(story({ gates: ["nope"] }), DEFAULT_CONFIG)).toThrow(/gate 'nope'/);
  });
});

describe("runCommandGates", () => {
  const gateDefs = (over: Record<string, unknown> = {}) => [
    { name: "test", kind: "command", run: "run-tests", ...over },
    { name: "visual", kind: "review", capture: "x" }, // review gates are never executed here
  ];

  test("runs each command gate via sh -c in the story worktree cwd, capturing pass/fail", async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const exec = (cmd: string, args: string[], opts: { cwd?: string } = {}) => {
      calls.push({ cmd, args, cwd: opts.cwd });
      return { code: args[1] === "run-tests" ? 0 : 1, stdout: "", stderr: "" };
    };
    const results = await runCommandGates(story(), gateDefs(), {
      root: "/repo", cwd: "/repo/.worktrees/st-0001", exec, lock: async (_r: string, _n: string, fn: () => unknown) => fn(),
    });
    expect(calls).toEqual([{ cmd: "sh", args: ["-c", "run-tests"], cwd: "/repo/.worktrees/st-0001" }]);
    expect(results).toEqual([{ name: "test", kind: "command", run: "run-tests", exitCode: 0, pass: true }]);
  });

  test("serializes under the 'gate' lock by default; per-gate lock:false and gateLock:false skip it", async () => {
    const locked: string[] = [];
    const lock = async (_root: string, name: string, fn: () => unknown) => {
      locked.push(name);
      return fn();
    };
    const exec = () => ({ code: 0, stdout: "", stderr: "" });
    await runCommandGates(story(), gateDefs(), { root: "/r", cwd: "/w", exec, lock });
    expect(locked).toEqual(["gate"]);
    locked.length = 0;
    await runCommandGates(story(), gateDefs({ lock: false }), { root: "/r", cwd: "/w", exec, lock });
    expect(locked).toEqual([]);
    await runCommandGates(story(), gateDefs(), { root: "/r", cwd: "/w", exec, lock, gateLock: false });
    expect(locked).toEqual([]);
  });

  test("a failing gate is reported, not thrown", async () => {
    const exec = () => ({ code: 7, stdout: "", stderr: "boom" });
    const results = await runCommandGates(story(), [{ name: "test", kind: "command", run: "x" }], {
      root: "/r", cwd: "/w", exec, lock: async (_r: string, _n: string, fn: () => unknown) => fn(),
    });
    expect(results[0]).toMatchObject({ name: "test", exitCode: 7, pass: false });
  });
});

describe("verdicts + evidence", () => {
  test("recordVerdict/readVerdict round-trip; unmetReviewGates needs a pass", async () => {
    const repo = await makeRepo();
    expect(readVerdict(repo.root, "st-0001", "visual")).toBeNull();
    const gates = resolveGates(story({ type: "ui" }), DEFAULT_CONFIG);
    expect(unmetReviewGates(repo.root, "st-0001", gates).map((g: any) => g.name)).toEqual(["visual"]);
    recordVerdict(repo.root, "st-0001", { gate: "visual", verdict: "fail", evidence: "shot.png" });
    expect(unmetReviewGates(repo.root, "st-0001", gates).length).toBe(1);
    recordVerdict(repo.root, "st-0001", { gate: "visual", verdict: "pass", evidence: "shot.png" });
    expect(readVerdict(repo.root, "st-0001", "visual")).toMatchObject({ verdict: "pass", evidence: "shot.png" });
    expect(unmetReviewGates(repo.root, "st-0001", gates)).toEqual([]);
    expect(() => recordVerdict(repo.root, "st-0001", { gate: "visual", verdict: "meh" })).toThrow(/pass\|fail/);
    await repo.cleanup();
  });

  test("writeEvidence drops a timestamped json under .claude/story-evidence/<id>/", async () => {
    const repo = await makeRepo();
    const file = writeEvidence(repo.root, "st-0001", { gates: [{ name: "test", pass: true }] });
    expect(file.startsWith(join(evidenceDir(repo.root, "st-0001"), ""))).toBe(true);
    expect(readdirSync(evidenceDir(repo.root, "st-0001")).some((f) => /^\d{4}-\d{2}-\d{2}T.*\.json$/.test(f))).toBe(true);
    const payload = JSON.parse(readFileSync(file, "utf8"));
    expect(payload).toMatchObject({ story: "st-0001", gates: [{ name: "test", pass: true }] });
    expect(Date.parse(payload.at)).toBeGreaterThan(0);
    await repo.cleanup();
  });
});

describe("story record", () => {
  test("records a verdict for a review gate; rejects command gates", async () => {
    const repo = await makeRepo();
    await writeStoryFile(repo.root, "st-0001-a.md", storyText({ id: "st-0001", title: "a", status: "in-progress", type: "ui" }));
    const r = await runStory(repo.root, ["record", "st-0001", "--gate", "visual", "--verdict", "pass", "--evidence", "shot.png", "--json"]);
    expect(r.code).toBe(0);
    expect(readVerdict(repo.root, "st-0001", "visual")).toMatchObject({ verdict: "pass" });
    const bad = await runStory(repo.root, ["record", "st-0001", "--gate", "test", "--verdict", "pass"]);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stderr).error).toMatch(/not a review gate/);
    await repo.cleanup();
  });
});
