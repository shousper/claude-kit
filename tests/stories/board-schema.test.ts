import { describe, expect, test } from "bun:test";
import {
  LEGAL_TRANSITIONS,
  PRIORITIES,
  STATUSES,
  applyDefaults,
  assertTransition,
} from "../../plugins/stories/lib/board.mjs";
import { CliError } from "../../plugins/stories/lib/util.mjs";

describe("schema constants", () => {
  test("statuses and priorities are pinned", () => {
    expect(STATUSES).toEqual(["backlog", "todo", "in-progress", "in-review", "done", "blocked"]);
    expect(PRIORITIES).toEqual(["P0", "P1", "P2", "P3"]);
  });
});

describe("legal transitions", () => {
  const legal: Array<[string, string]> = [
    ["backlog", "todo"],
    ["todo", "in-progress"],   // claim
    ["todo", "backlog"],       // demote
    ["todo", "blocked"],       // park before work
    ["in-progress", "in-review"], // gates green (local/pr)
    ["in-progress", "done"],   // gates green + merged (self)
    ["in-progress", "blocked"],// park
    ["in-progress", "todo"],   // release / stale-lease reclaim
    ["in-review", "done"],     // merged
    ["in-review", "in-progress"], // feedback or integration conflict
    ["in-review", "blocked"],  // PR closed unmerged → park
    ["blocked", "todo"],       // unpark
  ];
  for (const [from, to] of legal) {
    test(`${from} → ${to} is legal`, () => {
      expect(() => assertTransition(from, to)).not.toThrow();
      expect(LEGAL_TRANSITIONS[from]).toContain(to);
    });
  }

  const illegal: Array<[string, string]> = [
    ["backlog", "in-progress"], // must be promoted to todo first
    ["todo", "done"],           // no skipping the evidence gate
    ["todo", "in-review"],
    ["done", "todo"],           // done is terminal (no silent reopen)
    ["done", "in-progress"],
    ["blocked", "in-progress"], // unpark to todo, then claim
    ["blocked", "done"],
  ];
  for (const [from, to] of illegal) {
    test(`${from} → ${to} is illegal`, () => {
      expect(() => assertTransition(from, to)).toThrow(CliError);
      expect(() => assertTransition(from, to)).toThrow(/illegal transition/);
    });
  }

  test("unknown target status is rejected", () => {
    expect(() => assertTransition("todo", "doing")).toThrow(/unknown status/);
  });
});

describe("applyDefaults", () => {
  test("fills the documented defaults", () => {
    const s = applyDefaults({ id: "st-0001", title: "t", body: "" });
    expect(s.type).toBe("feature");
    expect(s.status).toBe("todo");
    expect(s.priority).toBe("P2");
    expect(s.depends_on).toEqual([]);
    expect(s.touches).toEqual([]);
    expect(s.exclusive).toBe(false);
    expect(s.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.updated).toBe(s.created);
    expect(s.gates).toBeUndefined(); // omitted → type defaults resolved at gate time
  });

  test("does not clobber provided values", () => {
    const s = applyDefaults({ id: "st-1", title: "t", status: "backlog", priority: "P0", body: "" });
    expect(s.status).toBe("backlog");
    expect(s.priority).toBe("P0");
  });

  test("rejects unknown status and priority", () => {
    expect(() => applyDefaults({ id: "st-1", title: "t", status: "doing", body: "" })).toThrow(/unknown status/);
    expect(() => applyDefaults({ id: "st-1", title: "t", priority: "P9", body: "" })).toThrow(/priority/);
  });
});
