---
name: writing-docs
description: Use when creating or editing documentation of any kind, including Markdown, RST, or HTML pages, READMEs, design docs, ADRs, changelogs, docstrings, and comment blocks. Covers document purpose, headings, paragraphs, lists, procedures, notices, cross-references, code samples, placeholders, example data, and word choice for technical writing.
---

# Writing documentation

## Overview

This skill covers the structure of documentation: what a page is for, how it is organized, and how its parts are formatted. The voice and word choice rules already apply to everything you write; this skill adds the structural conventions of the Google developer documentation style guide, condensed and adapted for code repositories.

## When to use

Use it when you create or change a documentation file (Markdown, RST, AsciiDoc, HTML), a README, a design document or ADR, a changelog entry, a docstring, or a comment block that explains a module, type, or function.

Do not use it for commit messages, pull request descriptions, chat replies, or inline comments of a line or two. Those follow the writing style on their own. Do not use it for the code itself; formatting of docstrings and comments follows the language's conventions, and this skill governs only the prose inside them.

## Before you write

Name the reader and pick one purpose for the page: explain a concept, complete a task, look something up, or learn by doing. A page that mixes purposes is harder to use than two short pages. Be prescriptive: recommend one path and mention alternatives only when the reader needs them to decide.

## Core rules

Headings: sentence case; task headings are bare infinitives ("Create an instance"), concept headings are noun phrases ("Instance lifecycle"); no -ing openers, no numbering, no code, no links, no trailing punctuation; one H1 per page; never skip a level; never leave a heading without content.

Paragraphs: one idea each, one to four sentences, key point first. Break long paragraphs rather than lengthening sentences.

Lists: introduce a list with a complete sentence ending in a colon; use a numbered list only for a sequence; use a bulleted list for three or more parallel items; capitalize each item; end items that are sentences with a period; use term-and-description pairs with colons, never dashes; never make a list of one item.

Procedures: one action per step; state the goal or location before the action ("In the **Settings** page, select **Billing**"); prefix optional steps with "Optional:"; write a single-step procedure as one bullet; put results after the action, in the same step.

Notices: Note for useful extras, Caution for "proceed carefully", Warning for irreversible or damaging actions. Never use a notice for a prerequisite, a required step, or a cross-reference, and never stack two notices.

Cross-references: descriptive link text that makes sense out of context; introduce with "For more information, see X"; no "click here", no bare URLs as link text, no duplicate links to one destination on a page.

Code: introduce a sample with a sentence ending in a colon; keep input and output in separate blocks; mark omitted code with a language comment, not an ellipsis; format placeholders as `UPPERCASE_WITH_UNDERSCORES` and follow the block with "Replace the following:" and one line per placeholder.

Example data: example.com, example.org, and example.net for domains; 192.0.2.0/24, 198.51.100.0/24, and 203.0.113.0/24 for IPv4; 2001:db8:: for IPv6; 800-555-0100 through 800-555-0199 for phone numbers; fictional names; never real people, addresses, or credentials; meaningful placeholder names rather than foo and bar.

Comments and docstrings: describe what a member does in the third person ("Creates a", "Gets the", "Checks whether", "Returns"), never "This method will"; parameter descriptions start with "The" or "A" and end with a period; boolean returns read "True if X; false otherwise."; exceptions start with "If" or "Thrown when"; deprecation notes name the replacement and the version.

## Quick reference

| Element | Rule |
| --- | --- |
| Page title | Sentence case, unique, describes the purpose |
| Task heading | Bare infinitive: "Configure logging" |
| Concept heading | Noun phrase: "Logging configuration" |
| List intro | Complete sentence ending in a colon |
| Numbered list | Sequences only |
| Term and description | `Term: description`, not `Term - description` |
| Optional step | Starts with "Optional:" |
| Notice | One per section at most; never for prerequisites |
| Link text | The target's title or a descriptive phrase |
| Placeholder | `PROJECT_ID`, explained after the block |
| Command block | Input and output in separate blocks |
| Docstring verb | Third person: "Returns the number of retries." |

## Worked example

A task page section, as it should read:

```markdown
## Rotate the signing key

Rotate the key when it is older than 90 days or after a suspected leak. The service keeps the previous key valid for one hour after rotation.

1. Generate a new key: `svc keys create --name KEY_NAME`.
2. In the **Keys** page, select the new key and click **Activate**.
3. Optional: Revoke the previous key immediately with `svc keys revoke KEY_ID`.

Replace the following:

- `KEY_NAME`: a label for the key, such as `signing-2026-09`.
- `KEY_ID`: the ID shown in the **Keys** page.

For more information, see [Key lifecycle](key-lifecycle.md).
```

## Common mistakes

A heading for every paragraph; filler sections named Overview, Summary, or Conclusion that repeat the body; bold on the first words of every bullet; a Note that carries a prerequisite or a required step; `foo` and `bar` in examples; "e.g." and "i.e."; future tense for current behavior; "This document will describe"; a list introduced by a fragment; a single-item list; a link whose text is "here".

## Reference files

Open the file that matches the work; each is self-contained.

- `reference/structure.md`: page types, headings, paragraphs, lists, procedures, notices, tables, cross-references, dates and numbers.
- `reference/code.md`: code in text, code samples, command-line syntax, placeholders, output blocks.
- `reference/api-comments.md`: verbs and phrasing for classes, methods, parameters, returns, exceptions, and deprecations.
- `reference/words.md`: words to avoid with their replacements, and spelling of common technical terms.
- `reference/examples.md`: reserved example names, domains, addresses, and IP ranges.

## Before you finish

Check that the page has one purpose, headings are in sentence case and describe their content, every list has an introducing sentence, procedures have one action per step, notices are rare and correctly typed, links have descriptive text, placeholders are explained, and example data is fictional. If a `vale:` summary appears after you save the file, treat each finding as a suggestion and fix the ones that apply.
