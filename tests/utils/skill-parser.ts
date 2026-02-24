import { readFile } from "fs/promises";
import { basename, dirname } from "path";
import { parse as parseYaml } from "yaml";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root, Heading, Code, Text } from "mdast";
import type { Node, Parent } from "unist";

export interface ParsedSkill {
  frontmatter: { name: string; description: string; [key: string]: unknown };
  headings: Array<{ depth: number; text: string }>;
  crossRefs: string[];
  codeBlocks: Array<{ lang: string | null; value: string }>;
  dirName: string;
  raw: string;
}

export async function parseSkill(filePath: string): Promise<ParsedSkill> {
  const raw = await readFile(filePath, "utf-8");
  const { frontmatter, body } = extractFrontmatter(raw);
  const tree = unified().use(remarkParse).parse(body);

  return {
    frontmatter,
    headings: extractHeadings(tree),
    crossRefs: extractCrossRefs(body),
    codeBlocks: extractCodeBlocks(tree),
    dirName: basename(dirname(filePath)),
    raw,
  };
}

export function extractFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  return { frontmatter: parseYaml(match[1]), body: match[2] };
}

function extractHeadings(tree: Root): Array<{ depth: number; text: string }> {
  const headings: Array<{ depth: number; text: string }> = [];
  walkTree<Heading>(tree, "heading", (node) => {
    const text = node.children
      .filter((c): c is Text => c.type === "text")
      .map((c) => c.value)
      .join("");
    headings.push({ depth: node.depth, text });
  });
  return headings;
}

function extractCodeBlocks(tree: Root): Array<{ lang: string | null; value: string }> {
  const blocks: Array<{ lang: string | null; value: string }> = [];
  walkTree<Code>(tree, "code", (node) => {
    blocks.push({ lang: node.lang ?? null, value: node.value });
  });
  return blocks;
}

function extractCrossRefs(body: string): string[] {
  const stripped = body.replace(/```[\s\S]*?```/g, "");
  const refs = new Set<string>();
  for (const match of stripped.matchAll(/kit:([a-z0-9-]+)/g)) {
    if (match[1] !== "name") refs.add(match[1]);
  }
  return [...refs];
}

/** Simple recursive tree walker for mdast nodes. */
function walkTree<T extends Node>(tree: Node, type: string, fn: (node: T) => void) {
  if (tree.type === type) fn(tree as T);
  if ("children" in tree) {
    for (const child of (tree as Parent).children) walkTree(child, type, fn);
  }
}
