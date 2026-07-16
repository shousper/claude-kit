import { describe, expect, test } from "bun:test";
import { generateId } from "../../plugins/stories/lib/board.mjs";
import { CliError } from "../../plugins/stories/lib/util.mjs";

describe("generateId", () => {
  test("produces st- + 4 hex chars", () => {
    expect(generateId([])).toMatch(/^st-[0-9a-f]{4}$/);
  });

  test("never returns an existing id (retries on collision)", () => {
    const seq = ["aaaa", "aaaa", "bbbb"]; // fake randomness: collides twice
    const rand = (len: number) => Buffer.from(seq.shift() ?? "ffff", "hex").subarray(0, len);
    expect(generateId(["st-aaaa"], rand)).toBe("st-bbbb");
  });

  test("widens to 6 then 8 hex chars when the 4-char space is saturated", () => {
    const rand = (len: number) => Buffer.alloc(len, 0xaa); // always aa…
    expect(generateId(["st-aaaa"], rand)).toBe("st-aaaaaa");
    expect(generateId(["st-aaaa", "st-aaaaaa"], rand)).toBe("st-aaaaaaaa");
  });

  test("throws CliError when every width is exhausted", () => {
    const rand = (len: number) => Buffer.alloc(len, 0xaa);
    expect(() => generateId(["st-aaaa", "st-aaaaaa", "st-aaaaaaaa"], rand)).toThrow(CliError);
  });
});
