import { resolve } from "path";
import { WRITING_VALE_DIR } from "./paths";

/**
 * Grades prose for the before/after writing-style eval: the vendored Vale style
 * (when `vale` is on PATH) plus a small checklist of habits Vale cannot see.
 * The metric is findings per 1,000 words, so outputs of different length compare.
 */

export interface TicCounts {
  emDash: number;
  boldBullets: number;
  notXButY: number;
  preamble: number;
  exclamation: number;
  shortAnswerHeadings: number;
  fillers: number;
  closers: number;
  letsHedge: number;
}

export interface StyleScore {
  words: number;
  vale: number;
  valeAvailable: boolean;
  tics: number;
  ticCounts: TicCounts;
  perThousand: number;
}

const VALE_INI = resolve(WRITING_VALE_DIR, ".vale.ini");
const SHORT_ANSWER_WORDS = 120;

export function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export function countTics(raw: string): TicCounts {
  const text = stripCode(raw);
  const lines = text.split("\n");
  const words = countWords(text);
  return {
    emDash: count(text, /—/g),
    boldBullets: lines.filter((l) => /^\s*[-*]\s+\*\*/.test(l)).length,
    notXButY: count(text, /\b(?:it'?s|this is|that'?s|isn'?t|not)\s+(?:just|only|merely|about)\s+[^.\n]{1,80}?(?:[—-]+|,)\s*(?:it'?s|but|it is)\b/gi),
    preamble: count(text, /^(?:Great|Good|Excellent) (?:question|point)|^(?:Sure|Certainly|Absolutely)\b|I'?d be happy to/gim),
    exclamation: count(text, /!(?!\[)/g),
    shortAnswerHeadings: words < SHORT_ANSWER_WORDS ? lines.filter((l) => /^#{1,6}\s/.test(l)).length : 0,
    fillers: count(text, /\b(?:simply|easily|just|quickly)\b/gi),
    closers: count(text, /\b(?:In summary|To summarize|In conclusion|I hope this helps)\b/gi),
    letsHedge: count(text, /\blet'?s\b/gi),
  };
}

/** Prose of `/** ... *\/` comments, one line per comment line, markers removed. */
export function extractJsDoc(source: string): string {
  const blocks = source.match(/\/\*\*[\s\S]*?\*\//g) ?? [];
  return blocks
    .map((block) =>
      block
        .replace(/^\/\*\*\s*/, "")
        .replace(/\s*\*\/$/, "")
        .split("\n")
        .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
        .filter((line) => line.length > 0)
        .join("\n"),
    )
    .join("\n");
}

async function valeFindings(text: string): Promise<number | null> {
  const bin = Bun.which("vale");
  if (!bin || text.trim().length === 0) return bin ? 0 : null;
  const proc = Bun.spawn([bin, `--config=${VALE_INI}`, "--no-global", "--no-exit", "--output=JSON", "--ext=.md"], {
    stdin: new TextEncoder().encode(text),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  try {
    const parsed = JSON.parse(stdout || "{}") as Record<string, unknown[]>;
    return Object.values(parsed).reduce((n, alerts) => n + alerts.length, 0);
  } catch {
    return 0;
  }
}

export async function scoreText(raw: string, options: { extract?: "jsdoc" } = {}): Promise<StyleScore> {
  const text = options.extract === "jsdoc" ? extractJsDoc(raw) : raw;
  const ticCounts = countTics(text);
  const tics = Object.values(ticCounts).reduce((a, b) => a + b, 0);
  const words = countWords(stripCode(text));
  const valeResult = await valeFindings(text);
  const vale = valeResult ?? 0;
  return {
    words,
    vale,
    valeAvailable: valeResult !== null,
    tics,
    ticCounts,
    perThousand: words === 0 ? 0 : ((vale + tics) / words) * 1000,
  };
}
