import { describe, it, expect } from "bun:test";
import { countTics, extractJsDoc, scoreText, stripCode } from "../utils/style-grader";

const HAS_VALE = Bun.which("vale") !== null;

describe("stripCode", () => {
  it("removes fenced and inline code", () => {
    expect(stripCode("a `x!` b\n```\nGreat question!\n```\nc")).not.toContain("!");
  });
});

describe("countTics", () => {
  it("counts the named tics and ignores code", () => {
    const text = [
      "Great question! It's not just a bug — it's a design flaw.",
      "- **Fast**: simply run it",
      "- **Safe**: just works",
      "Let's dive in. In summary, I hope this helps!",
      "```\nnot code — really!\n```",
    ].join("\n");
    const tics = countTics(text);
    expect(tics.emDash).toBe(1);
    expect(tics.boldBullets).toBe(2);
    expect(tics.notXButY).toBe(1);
    expect(tics.preamble).toBe(1);
    expect(tics.exclamation).toBe(2);
    expect(tics.fillers).toBe(3);
    expect(tics.closers).toBe(2);
    expect(tics.letsHedge).toBe(1);
  });

  it("flags headings only in short answers", () => {
    expect(countTics("## Answer\n\nYes.").shortAnswerHeadings).toBe(1);
    const long = `## Answer\n\n${"word ".repeat(200)}`;
    expect(countTics(long).shortAnswerHeadings).toBe(0);
  });
});

describe("extractJsDoc", () => {
  it("returns the prose of documentation comments without markers", () => {
    const src = "/**\n * Creates an entry.\n * @param key The key.\n */\nexport function put() {}\n// not a doc comment\n";
    expect(extractJsDoc(src)).toBe("Creates an entry.\n@param key The key.");
  });
});

describe("scoreText", () => {
  it("reports findings per thousand words and whether vale ran", async () => {
    const score = await scoreText("Great question! We will simply leverage the API.");
    expect(score.words).toBe(8);
    expect(score.tics).toBeGreaterThanOrEqual(2);
    expect(score.valeAvailable).toBe(HAS_VALE);
    if (HAS_VALE) expect(score.vale).toBeGreaterThanOrEqual(3);
    expect(score.perThousand).toBeCloseTo(((score.vale + score.tics) / score.words) * 1000, 5);
  });

  it("scores an empty text as zero without dividing by zero", async () => {
    expect((await scoreText("")).perThousand).toBe(0);
  });
});
