import { describe, expect, test } from "bun:test";
import path from "node:path";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { buildPrBody, createPr, integratePrMode } from "../../plugins/stories/lib/github.mjs";
import { computeReady } from "../../plugins/stories/lib/board.mjs";
import { run } from "../../plugins/stories/lib/util.mjs";
import { loadStoryById, makeFakeExec, makePrRepo, ok, fail, writeStory } from "./gh-helpers.ts";
import { DEFAULT_CONFIG, makeRepo, runStory } from "./helpers";

const story = {
  id: "st-aaaa",
  title: "Add gates",
  body: [
    "## Description",
    "Stuff.",
    "",
    "## Acceptance Criteria",
    "- [ ] gate multiplies mobs",
    "- [ ] covered by e2e",
    "",
    "## Implementation Notes",
    "- a note",
  ].join("\n"),
};

describe("buildPrBody", () => {
  test("includes story id, AC checkboxes, and evidence summary (B's evidence shape)", () => {
    const body = buildPrBody(story, {
      story: "st-aaaa",
      at: "2026-07-08T12:00:00Z",
      gates: [
        { name: "test", kind: "command", run: "bun test", exitCode: 0, pass: true },
        { name: "visual", kind: "review", verdict: "pass", evidence: "shot.png" },
      ],
    });
    expect(body).toContain("st-aaaa");
    expect(body).toContain("- [ ] gate multiplies mobs");
    expect(body).toContain("- [ ] covered by e2e");
    expect(body).not.toContain("a note");
    expect(body).toContain("test: pass");
    expect(body).toContain("visual: pass");
    expect(body).toContain("2026-07-08T12:00:00Z");
  });

  test("degrades gracefully with no AC section and no evidence", () => {
    const body = buildPrBody({ id: "st-bbbb", title: "x", body: "## Description\nhi" }, null);
    expect(body).toContain("_none recorded_");
    expect(body).toContain("_no gate evidence recorded_");
  });
});

const storyLines = (id: string, extra: string[] = []) => [
  `id: ${id}`,
  "title: Add gates",
  "type: feature",
  "status: in-progress",
  "priority: P2",
  "created: 2026-07-08",
  "updated: 2026-07-08",
  ...extra,
];

describe("createPr", () => {
  test("pushes branch, creates PR with story id in branch and title, enables auto-merge", async () => {
    const root = await makePrRepo();
    await writeStory(root, storyLines("st-aaaa"), "## Acceptance Criteria\n- [ ] works");
    const { exec, calls, lines } = makeFakeExec([
      ["gh pr create", ok("https://github.com/o/r/pull/12\n")],
    ]);
    const res = await createPr(root, await loadStoryById(root, "st-aaaa"), { exec });
    expect(res.number).toBe(12);
    expect(res.autoMerge).toBe(true);

    expect(lines()[0]).toBe("git push -u origin story/st-aaaa");
    expect(calls[0].opts.cwd).toBe(path.join(root, ".worktrees", "st-aaaa"));

    const create = calls.find((c) => c.cmd === "gh" && c.args[1] === "create")!;
    expect(create.args[create.args.indexOf("--head") + 1]).toBe("story/st-aaaa");
    expect(create.args[create.args.indexOf("--base") + 1]).toBe("main");
    expect(create.args[create.args.indexOf("--title") + 1]).toContain("st-aaaa");
    expect(create.args[create.args.indexOf("--body") + 1]).toContain("- [ ] works");

    expect(lines().some((l) => l.startsWith("gh pr merge 12 --auto"))).toBe(true);
  });

  test("tolerates auto-merge being unavailable", async () => {
    const root = await makePrRepo();
    await writeStory(root, storyLines("st-bbbb"));
    const { exec } = makeFakeExec([
      ["gh pr create", ok("https://github.com/o/r/pull/13\n")],
      ["gh pr merge", fail(1, "auto-merge is not allowed on this repository")],
    ]);
    const res = await createPr(root, await loadStoryById(root, "st-bbbb"), { exec });
    expect(res.number).toBe(13);
    expect(res.autoMerge).toBe(false);
  });

  test("throws when the PR number cannot be parsed", async () => {
    const root = await makePrRepo();
    await writeStory(root, storyLines("st-cccc"));
    const { exec } = makeFakeExec([["gh pr create", ok("garbage")]]);
    await expect(
      createPr(root, await loadStoryById(root, "st-cccc"), { exec }),
    ).rejects.toThrow(/could not parse PR number/);
  });
});

describe("integratePrMode", () => {
  test("first integration creates the PR, reconciles touches, clears the claim, records pr map + in-review", async () => {
    const root = await makePrRepo();
    await writeStory(root, storyLines("st-dddd", [
      "touches: [declared/**]",
      "claim: {session: w1, lease: 2026-07-08T13:00:00Z}",
    ]), "## Acceptance Criteria\n- [ ] x");
    const { exec } = makeFakeExec([
      ["gh pr create", ok("https://github.com/o/r/pull/21\n")],
    ]);
    const now = () => new Date("2026-07-08T14:00:00Z");
    const res = await integratePrMode(root, await loadStoryById(root, "st-dddd"), {
      exec,
      now,
      diff: ["impl.ts"], // cmdDone passes the diff it already computed
    });
    expect(res).toEqual({ number: 21, created: true });

    const after = await loadStoryById(root, "st-dddd");
    expect(after.status).toBe("in-review");
    expect(after.touches).toEqual(["impl.ts"]); // reconciled from the real diff, not the declared glob
    expect(after.claim).toBeUndefined(); // ratified: in-review never holds a claim
    expect(Number(after.pr.number)).toBe(21);
    expect(String(after.pr.lastSync)).toBe("2026-07-08T14:00:00.000Z");
    expect(Number(after.pr.syncAttempts)).toBe(0);
    expect(after.body).toContain("opened PR #21");

    // Decision-9 payoff: once the sweep flags feedback, the story is claimable
    // — with a surviving stale claim, computeReady would hide it forever.
    expect(computeReady([{ ...after, feedback: true }], {}).map((s: { id: string }) => s.id)).toEqual(["st-dddd"]);
  });

  test("re-integration of a feedback item pushes to the existing PR, clears flag + claim", async () => {
    const root = await makePrRepo();
    await writeStory(root, storyLines("st-eeee", [
      "feedback: true",
      "claim: {session: w2, lease: 2026-07-08T13:30:00Z}",
      "pr: {number: 33, lastSync: 2026-07-08T12:00:00Z, syncAttempts: 1}",
    ]));
    const { exec, lines } = makeFakeExec();
    const res = await integratePrMode(root, await loadStoryById(root, "st-eeee"), {
      exec,
      diff: ["fix.ts"],
    });
    expect(res).toEqual({ number: 33, created: false });
    expect(lines()).toContain("git push origin story/st-eeee");
    expect(lines().some((l) => l.startsWith("gh pr create"))).toBe(false);

    const after = await loadStoryById(root, "st-eeee");
    expect(after.status).toBe("in-review");
    expect(after.feedback === true || after.feedback === "true").toBe(false);
    expect(after.claim).toBeUndefined();
    expect(after.touches).toEqual(["fix.ts"]);
    expect(Number(after.pr.number)).toBe(33);
    expect(Number(after.pr.syncAttempts)).toBe(1); // untouched by re-integration
  });
});

describe("story done → integratePrMode dispatch (pr mode, end to end)", () => {
  test("done in a merge:pr repo opens a PR and lands in-review with reconciled touches, no claim", async () => {
    const repo = await makeRepo({ ...DEFAULT_CONFIG, merge: "pr" });
    const created = await runStory(repo.root, ["create", "--title", "pr story", "--touches", "declared/**", "--json"]);
    const { id } = created.json() as { id: string };
    expect((await runStory(repo.root, ["claim", id, "--session", "w1"])).code).toBe(0);
    const wt = join(repo.root, ".worktrees", id);
    writeFileSync(join(wt, "impl.ts"), "code\n");
    spawnSync("git", ["add", "impl.ts"], { cwd: wt });
    spawnSync("git", ["commit", "-m", "implement"], { cwd: wt });

    // Passthrough exec: fake the network-touching commands, run real git otherwise.
    const execLines: string[] = [];
    const exec = (cmd: string, args: string[] = [], opts: Record<string, unknown> = {}) => {
      const line = [cmd, ...args].join(" ");
      execLines.push(line);
      if (line.startsWith("git push")) return { code: 0, stdout: "", stderr: "" };
      if (line.startsWith("gh pr create")) return { code: 0, stdout: "https://github.com/o/r/pull/40\n", stderr: "" };
      if (cmd === "gh") return { code: 0, stdout: "", stderr: "" };
      return run(cmd, args, opts);
    };
    const r = await runStory(repo.root, ["done", id, "--json"], { exec });
    expect(r.code).toBe(0);
    expect(execLines.some((l) => l.startsWith("gh pr create"))).toBe(true);

    const s = await loadStoryById(repo.root, id);
    expect(s.status).toBe("in-review");
    expect(s.touches).toEqual(["impl.ts"]);
    expect(s.claim).toBeUndefined();
    expect(Number(s.pr.number)).toBe(40);
    await repo.cleanup();
  });
});
