import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  latestEvidence,
  recordVerdict,
  writeEvidence,
} from "../../plugins/stories/lib/gates.mjs";
import {
  appendNote,
  appendQuestion,
  mutateBoard,
  runGatesWithEvidence,
} from "../../plugins/stories/lib/github.mjs";
import { lockPath } from "../../plugins/stories/lib/locks.mjs";
import { loadConfig } from "../../plugins/stories/lib/cli.mjs";
import { loadStoryById, makePrRepo, writeStory } from "./gh-helpers.ts";

const lines = (id: string) => [
  `id: ${id}`,
  "title: A story",
  "type: feature",
  "status: todo",
  "priority: P2",
  "created: 2026-07-08",
  "updated: 2020-01-01",
];

describe("gates.latestEvidence", () => {
  test("null with no evidence; ignores verdict files; picks the newest", async () => {
    const root = await makePrRepo();
    expect(latestEvidence(root, "st-0000")).toBeNull();
    writeEvidence(root, "st-e0e0", { gates: [{ name: "test", pass: false }] });
    await new Promise((r) => setTimeout(r, 5)); // distinct ms → distinct filename
    writeEvidence(root, "st-e0e0", { gates: [{ name: "test", pass: true }] });
    recordVerdict(root, "st-e0e0", { gate: "visual", verdict: "pass", evidence: "x.png" });
    const ev = latestEvidence(root, "st-e0e0")!;
    expect(ev.story).toBe("st-e0e0");
    expect(ev.gates).toEqual([{ name: "test", pass: true }]);
    expect(Date.parse(ev.at)).toBeGreaterThan(0);
  });
});

describe("mutateBoard", () => {
  test("holds the board lock during the mutation, persists it, bumps updated", async () => {
    const root = await makePrRepo();
    await writeStory(root, lines("st-10cc"));
    let lockedDuring = false;
    await mutateBoard(root, loadConfig(root), "st-10cc", (s: { priority: string }) => {
      lockedDuring = existsSync(lockPath(root, "board"));
      s.priority = "P0";
    });
    expect(lockedDuring).toBe(true);
    const after = await loadStoryById(root, "st-10cc");
    expect(after.priority).toBe("P0");
    expect(after.updated).not.toBe("2020-01-01");
    expect(existsSync(lockPath(root, "board"))).toBe(false); // released
  });
});

describe("appendNote / appendQuestion", () => {
  test("timestamped entries land under the right headings", async () => {
    const root = await makePrRepo();
    await writeStory(root, lines("st-403e"));
    const config = loadConfig(root);
    await appendNote(root, config, "st-403e", "learned a thing");
    await appendQuestion(root, config, "st-403e", "REST or GraphQL?");
    const s = await loadStoryById(root, "st-403e");
    expect(s.body).toMatch(/## Implementation Notes\n\n- \d{4}-\d{2}-\d{2}T[\d:.]+Z: learned a thing/);
    expect(s.body).toMatch(/## Questions\n\n- .*REST or GraphQL\?/s);
  });
});

describe("runGatesWithEvidence", () => {
  const story = { id: "st-9a7e", title: "t", type: "feature" };

  test("resolves gates from config, reduces to {pass, results}, writes evidence", async () => {
    const root = await makePrRepo(); // gates: {test: command "true"}, defaults.feature: ["test"]
    const good = await runGatesWithEvidence(root, story, {
      cwd: "/w",
      exec: () => ({ code: 0, stdout: "", stderr: "" }),
    });
    expect(good).toEqual({ pass: true, results: [{ gate: "test", pass: true }] });
    expect(latestEvidence(root, "st-9a7e")!.gates[0]).toMatchObject({ name: "test", pass: true });
  });

  test("a failing gate flips pass and is recorded in the evidence", async () => {
    const root = await makePrRepo();
    const bad = await runGatesWithEvidence(root, story, {
      cwd: "/w",
      exec: () => ({ code: 1, stdout: "", stderr: "" }),
    });
    expect(bad).toEqual({ pass: false, results: [{ gate: "test", pass: false }] });
    expect(latestEvidence(root, "st-9a7e")!.gates[0]).toMatchObject({ name: "test", pass: false });
  });
});
