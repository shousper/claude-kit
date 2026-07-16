import { describe, expect, test } from "bun:test";
import {
  ID_PATTERN,
  assertValidId,
  readBodySection,
} from "../../plugins/stories/lib/board.mjs";
import { CliError } from "../../plugins/stories/lib/util.mjs";

const BODY = [
  "## Description", "", "A sample.", "",
  "## Acceptance Criteria", "", "- [ ] bun test passes", "- [ ] CLI prints the id", "",
  "## Questions", "", "Should gates run twice?", "",
].join("\n");

describe("readBodySection", () => {
  test("returns the section body, stopping at the next H2", () => {
    expect(readBodySection(BODY, "Acceptance Criteria")).toBe(
      "- [ ] bun test passes\n- [ ] CLI prints the id",
    );
  });

  test("matches the heading case-insensitively (the latent-bug fix)", () => {
    // A '## acceptance criteria' heading must be found regardless of case —
    // the case-SENSITIVE PR-body reader used to silently skip it.
    expect(readBodySection(BODY, "acceptance criteria")).toContain("bun test passes");
    expect(readBodySection(BODY, "ACCEPTANCE CRITERIA")).toContain("CLI prints the id");
  });

  test("finds a section whose stored heading is lower-cased", () => {
    const lower = "## acceptance criteria\n\n- [ ] done when green\n";
    expect(readBodySection(lower, "Acceptance Criteria")).toBe("- [ ] done when green");
  });

  test("returns '' for a missing section or empty/undefined body", () => {
    expect(readBodySection(BODY, "Implementation Plan")).toBe("");
    expect(readBodySection("", "Questions")).toBe("");
    expect(readBodySection(undefined, "Questions")).toBe("");
    expect(readBodySection(null, "Questions")).toBe("");
  });
});

describe("assertValidId / ID_PATTERN", () => {
  test("accepts st- + 4 to 8 hex chars (inclusive) and returns the id", () => {
    expect(assertValidId("st-aaaa")).toBe("st-aaaa"); // 4
    expect(assertValidId("st-aaaaa")).toBe("st-aaaaa"); // 5
    expect(assertValidId("st-aabbcc")).toBe("st-aabbcc"); // 6
    expect(assertValidId("st-deadbeef")).toBe("st-deadbeef"); // 8
  });

  test("rejects malformed ids with a CliError", () => {
    // too short (3), too long (9), uppercase hex, non-hex, missing prefix, empty
    for (const bad of ["st-", "st-xyz", "st-aaa", "st-AAAA", "aaaa", "st-aaaaaaaaa", ""]) {
      expect(() => assertValidId(bad)).toThrow(CliError);
    }
  });

  test("rejects non-string ids", () => {
    // @ts-expect-error runtime guard covers non-strings
    expect(() => assertValidId(undefined)).toThrow(CliError);
    // @ts-expect-error runtime guard covers non-strings
    expect(() => assertValidId(1234)).toThrow(CliError);
  });

  test("ID_PATTERN agrees with assertValidId", () => {
    expect(ID_PATTERN.test("st-aaaa")).toBe(true);
    expect(ID_PATTERN.test("st-AAAA")).toBe(false);
    expect(ID_PATTERN.test("st-aaa")).toBe(false);
  });
});
