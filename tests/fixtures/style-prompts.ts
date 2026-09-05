/** Fixed prompts for the before/after writing-style eval. Ids are stable so runs compare. */
export interface StylePrompt {
  id: string;
  prompt: string;
  /** Grade this workspace file instead of the reply text. */
  outputFile?: string;
  /** Pull prose out of documentation comments before grading. */
  extract?: "jsdoc";
}

export const stylePrompts: StylePrompt[] = [
  {
    id: "reply-flaky-test",
    prompt: "tests/store.test.ts fails about one run in five. Explain why it is flaky and what to change. Do not edit any files.",
  },
  {
    id: "pr-description",
    prompt: "Write the pull request description for the change in changes.patch and save it as PR.md.",
    outputFile: "PR.md",
  },
  {
    id: "readme-getting-started",
    prompt: "Add a \"Getting started\" section to README.md that explains how to install the package and run the first query. Keep the rest of the file unchanged.",
    outputFile: "README.md",
  },
  {
    id: "docstrings",
    prompt: "Add documentation comments to the three exported functions in src/store.ts.",
    outputFile: "src/store.ts",
    extract: "jsdoc",
  },
];
