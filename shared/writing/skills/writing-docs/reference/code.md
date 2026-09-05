# Code reference

## Code in running text

Use code font for anything the reader would type or see verbatim: attribute names, class names, command names, data types, environment variables, filenames, HTTP status codes, keywords, method names, parameter names, placeholders, and literal values such as `true` or `0`.
Use ordinary font for a domain name mentioned in passing, for the name of a product or service, and for a URL the reader follows in a browser rather than types as input.
Do not put quotation marks around a code-formatted term unless the quotation marks are themselves part of the literal value.
Treat a code element as a noun, not a verb: write "send a `POST` request," not "`POST` the data," and write "open the file before closing it," not "`open`ing the file."
Do not inflect a code element to make it plural or possessive; add an ordinary noun after it and inflect that noun instead, as in "the `ADDRESS` constant's value," not "`ADDRESS`'s value."
When referring to a method by name, drop the surrounding class or object name unless leaving it out would cause ambiguity.
Refer to a single HTTP status code as a "status code," not a "response code" or "error code," and put the number and name together in code font.
A boolean literal such as `true` or `false` stays in code font only when referring to the literal value itself; when describing the general outcome of a condition in prose, use plain words like "true" and "false" without code font.
When a command-line tool shares a name with the product it belongs to, use code font for the tool name and ordinary font for the product name, since they are two different things.

## Code samples

Follow the indentation convention of the language in the sample; when no convention applies, use two-space indentation and spaces rather than tabs.
Wrap sample lines at roughly 80 characters so they stay readable without horizontal scrolling.
Mark a preformatted block clearly, using a fenced or indented code block rather than inline styling.
Indicate omitted code with a comment written in the sample's own language, such as a `# lines omitted` comment, never with three dots or an ellipsis character standing alone in the code.
Precede a code sample with an introductory sentence; end it with a colon if the sample follows immediately, or a period if other material, such as a note, sits between the introduction and the sample.
Keep a single language and a single style guide for every sample within one document, so a reader is not forced to context-switch between conventions on the same page.
Introduce a sample even when the surrounding paragraph already names the operation, because the sentence before a sample is also where a reader expects a link to fuller reference material.

## Command-line syntax

Present a lengthy command or a full sample in a fenced code block, not as inline text.
When a command line must wrap past 80 characters, break before a safe character such as a hyphen or an underscore, add a line-continuation character appropriate to the shell at the end of every line but the last, and indent the continuation lines for alignment.
Use square brackets around an argument to show it is optional, curly braces with a pipe between choices to show the reader must pick exactly one, and three dots with no surrounding spaces to show an argument may repeat.
Avoid mixing that optional or repeated-argument notation into a command block meant to be copied and run unedited; trim the block to the arguments needed for the common case, and link to full reference material for the rest.
When a set of instructions mixes input and output, put them in separate blocks rather than one combined block, and introduce the output with a phrase such as "The output is similar to the following:".
When multiple lines of input appear in one block, prefix each input line with its prompt symbol so the reader can tell input from output at a glance.
Indicate omitted output the same way as omitted code: three dots alone on their own line, never the ellipsis character.
When discussing the parts of a command, decide whether the reader truly needs the formal name of each element or whether describing what the whole command does is enough; favor the latter unless the reader will need the term again.
Give a one-line command a prompt symbol only when consistency with surrounding multi-line commands calls for it; a standalone one-liner can omit the prompt.

## Placeholders

Format a placeholder in uppercase letters with underscores between words, such as `PROJECT_ID`, so it stands out from the literal text around it.
Never build a possessive form into a placeholder name, such as `YOUR_PROJECT_ID`; state the possession in the surrounding sentence instead.
Explain a placeholder the first time it appears; a repeated explanation is unnecessary unless the document is long or is not meant to be read start to finish.
For a single placeholder, state the replacement in one sentence: "Replace `PLACEHOLDER` with a description of what it represents."
For two or more placeholders in one block, follow the block with "Replace the following:" and then one list item per placeholder, in the order each one appears, each written as the placeholder name, a colon, and a lowercase description.
When a placeholder's description needs an example, introduce the example with "such as" or a dash rather than folding it awkwardly into the sentence.
Explain a placeholder that appears in example output the same way, but introduce the list with "This output includes the following values:" instead of "Replace the following:", since the reader is not meant to substitute anything.

## Worked example

Generate a signing key:

```
$ svc keys create --name KEY_NAME
```

Replace `KEY_NAME` with a label for the key, such as `signing-2026-09`.

The output is similar to the following:

```
Key created: KEY_ID
```

`KEY_ID` is the identifier assigned to the new key.
