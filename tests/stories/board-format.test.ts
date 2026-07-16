import { describe, expect, test } from "bun:test";
import { parseStory, serializeStory } from "../../plugins/stories/lib/board.mjs";

// Canonical fixture — field order matches the serializer's FIELD_ORDER.
export const CANONICAL = `---
id: st-4f2a
title: Add multiplier gates
type: feature
epic: st-9c01
status: todo
priority: P2
depends_on: [st-1b3e]
discovered_from: st-1b3e
touches: [src/gates/**, src/config.ts]
exclusive: false
gates: [test, e2e]
claim: {session: abc-123, lease: 2026-07-08T14:03:00Z}
pr: {number: 12, lastSync: 2026-07-08T14:03:00Z}
created: 2026-07-08
updated: 2026-07-08
---

## Description

Words.

## Acceptance Criteria

- [ ] gate multiplies runners
- [x] config parsed

## Implementation Notes
`;

describe("parseStory", () => {
  test("parses scalars, arrays, one-level maps, and body", () => {
    const s = parseStory(CANONICAL, "fixture");
    expect(s.id).toBe("st-4f2a");
    expect(s.title).toBe("Add multiplier gates");
    expect(s.status).toBe("todo");
    expect(s.depends_on).toEqual(["st-1b3e"]);
    expect(s.touches).toEqual(["src/gates/**", "src/config.ts"]);
    expect(s.exclusive).toBe(false); // boolean, not string
    expect(s.gates).toEqual(["test", "e2e"]);
    expect(s.claim).toEqual({ session: "abc-123", lease: "2026-07-08T14:03:00Z" });
    expect(s.pr).toEqual({ number: 12, lastSync: "2026-07-08T14:03:00Z" }); // number typed
    expect(s.created).toBe("2026-07-08"); // date-like stays a string
    expect(s.body.startsWith("\n## Description")).toBe(true);
    expect(s.body).toContain("- [ ] gate multiplies runners"); // checkboxes verbatim
  });

  test("quoted strings, empty arrays, comments, empty values", () => {
    const s = parseStory(
      '---\nid: st-0001\ntitle: "fix: handle [edge] cases"\n# a human comment\ndepends_on: []\nepic:\n---\nbody',
      "fixture",
    );
    expect(s.title).toBe("fix: handle [edge] cases");
    expect(s.depends_on).toEqual([]);
    expect(s.epic).toBe("");
    expect(s.body).toBe("body");
  });

  test("quoted array items may contain commas", () => {
    const s = parseStory('---\nid: st-0001\ntouches: ["a,b.ts", c.ts]\n---\n', "fixture");
    expect(s.touches).toEqual(["a,b.ts", "c.ts"]);
  });

  test("rejects missing or unterminated frontmatter", () => {
    expect(() => parseStory("no frontmatter", "f")).toThrow(/frontmatter/);
    expect(() => parseStory("---\nid: st-1\n", "f")).toThrow(/frontmatter/);
    expect(() => parseStory("---\n???\n---\n", "f")).toThrow(/unparseable/);
  });

  test("unknown keys are preserved", () => {
    const s = parseStory("---\nid: st-0001\ncustom_field: hello\n---\n", "fixture");
    expect(s.custom_field).toBe("hello");
  });
});

describe("serializeStory", () => {
  test("byte-identical round trip for a canonical file (checkbox body verbatim)", () => {
    expect(serializeStory(parseStory(CANONICAL, "fixture"))).toBe(CANONICAL);
  });

  test("parse(serialize(story)) is lossless", () => {
    const story = {
      id: "st-00ff",
      title: "fix: handle [edge] cases, carefully",
      type: "bug",
      status: "in-progress",
      priority: "P1",
      depends_on: [],
      touches: ["src/**", "a,b.ts"],
      exclusive: true,
      claim: { session: "s-1", lease: "2026-07-08T14:03:00.000Z" },
      created: "2026-07-08",
      updated: "2026-07-08",
      body: "\n## Acceptance Criteria\n\n- [ ] unchecked\n- [x] checked\n",
    };
    expect(parseStory(serializeStory(story), "rt")).toEqual(story);
  });

  test("pins the exact serialized shape: quoting, flow arrays, flow maps, field order", () => {
    const text = serializeStory({
      updated: "2026-07-08",           // deliberately out of order —
      id: "st-0001",                    // serializer must impose FIELD_ORDER
      title: "plain title",
      status: "todo",
      priority: "P2",
      depends_on: ["st-0002", "st-0003"],
      touches: [],
      exclusive: false,
      claim: { session: "abc", lease: "2026-07-08T14:03:00Z" },
      created: "2026-07-08",
      body: "b\n",
    });
    expect(text).toBe(
      "---\n" +
        "id: st-0001\n" +
        "title: plain title\n" +
        "status: todo\n" +
        "priority: P2\n" +
        "depends_on: [st-0002, st-0003]\n" +
        "touches: []\n" +
        "exclusive: false\n" +
        "claim: {session: abc, lease: 2026-07-08T14:03:00Z}\n" +
        "created: 2026-07-08\n" +
        "updated: 2026-07-08\n" +
        "---\n" +
        "b\n",
    );
  });

  test("quotes strings that would parse wrong bare", () => {
    const quoted = serializeStory({ id: "st-0001", title: "fix: it", body: "" });
    expect(quoted).toContain('title: "fix: it"');
    expect(serializeStory({ id: "st-0001", title: "true", body: "" })).toContain('title: "true"');
    expect(serializeStory({ id: "st-0001", title: "1234", body: "" })).toContain('title: "1234"');
  });

  test("omits null/undefined fields, keeps unknown keys after known ones", () => {
    const text = serializeStory({ id: "st-0001", epic: undefined, custom: "x", body: "" });
    expect(text).toBe("---\nid: st-0001\ncustom: x\n---\n");
  });
});
