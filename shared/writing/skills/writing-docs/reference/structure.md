# Document structure reference

## Page types

Pick a single purpose for a page before writing it: a concept page explains an idea, a task page walks through steps to a goal, a reference page documents facts for lookup, and a tutorial teaches a skill through a full worked example.
Prescriptive documentation recommends one way to do something instead of a menu of theoretically equivalent choices; when a task has several viable approaches, pick the simplest one that works for a general reader and mention the exception path only for readers who need it.
Word choice signals whether an action is required or optional: use "must" for the former and "can" for the latter, and avoid "should" in prescriptive text because it reads as ambiguous about whether the action is mandatory.
A page that mixes purposes is harder to scan and harder to translate than two focused pages; split it.

## Headings and titles

Use sentence case for every heading and title: capitalize the first word and any proper nouns, and lowercase the rest.
Phrase a task heading as a bare infinitive, the plain form of a verb, such as "Create an instance"; phrase a concept heading as a noun phrase, such as "Instance lifecycle."
Never open a heading with an -ing verb form; "Transferring data" should read "Transfer data" for a task, or become a noun phrase for a concept.
It is fine to mix task-based and concept-based heading styles across sections of one page, as long as each heading matches its own content.
Mark a heading "Optional:" when the section it introduces applies only to some readers or configurations, not to everyone following the page.
Use exactly one top-level heading per page, and never repeat the page title verbatim as a section heading.
Keep heading punctuation minimal; a heading that seems to need a colon, a parenthetical, or a question mark is usually a sign to rewrite it as a plain phrase.
Avoid abbreviations in a heading unless the abbreviation is more recognizable than the full term, and define it on first use in the body text.
Never put a code-formatted term or a link inside a heading; if a heading must reference a code item, pair it with a plain descriptive noun instead.
Never use numbers to indicate heading sequence; rely on heading level and document order instead.
Never skip a heading level: a third-level heading sits under a second-level heading, not directly under the page title.
Never leave a heading with no content beneath it before the next heading of the same or higher level.
When a section is followed only by lower-level subsections, introduce them with a phrase such as "the following sections" rather than "this section," since "this section" is ambiguous about scope.

## Paragraphs

Give each paragraph exactly one idea, in as few sentences as the idea needs, and put the most important sentence first.
Do not stretch sentences to reduce the paragraph count; short sentences in a longer paragraph read better than long sentences in a short one.
A paragraph that runs past five or six sentences is usually carrying more than one idea; split it unless it is genuinely one continuous thought.
A single-sentence paragraph is fine when the idea is small enough to stand alone.
Left-align paragraph text and avoid manual line breaks inside a sentence; forced breaks look wrong once a page is resized or read on another device.

## Lists

Choose a numbered list only when the order of items matters, such as a sequence of steps; choose a bulleted list for three or more items that share no inherent order; use a description list when each item pairs a short term with an explanation.
Introduce a list with a full sentence that ends in a colon, not a sentence fragment the list items complete grammatically.
Never present a single item as a list; if one item needs visual separation from the surrounding paragraph, use a different treatment.
Keep every item in a list parallel in grammatical form: all noun phrases, or all imperative verbs, never a mix.
Capitalize the first word of every list item unless case itself carries meaning in that particular list.
End a list item with a period when it is a full sentence or contains a verb; skip the period for a single word, a code-only item, or a title used as the item.
In a description list, capitalize the term, skip the period after the term, and end the description with a period when the description is itself a sentence.
Use a colon between a term and its description, never a dash.
When writing a comma-separated list inside a sentence, use a serial comma before the final item, and never trail the list with "etc." or "and so on"; phrase the introduction so it is clear the list is only a sample.

## Procedures

Introduce a numbered procedure with a sentence that gives context the heading does not already cover; end that sentence with a colon if the steps follow immediately, or a period if other material comes between.
Write a single-step procedure as one bulleted sentence, not a numbered list of one.
Give each step exactly one action; when a step genuinely has sub-actions, label them with lowercase letters, and label sub-sub-actions with lowercase Roman numerals.
State where an action happens, such as a named field or a named menu, before stating the action itself.
Combine a short sequence of selections into one step only when they form a single natural gesture, such as choosing consecutive menu entries.
Mark an optional step by starting it with "Optional:" followed by the action, not by wrapping the word "optional" in parentheses.
When a step produces a visible result, state the action first and the result second, in the same step, rather than describing the result inside the following step.
When a step needs justification rather than a visible result, state the action first and the reason second.
Order the parts of a complex step consistently: the action, then any command, then an explanation of its placeholders, then further detail, then the output, then the outcome.

## Notices

Reserve a note for a useful aside that is not required for the reader to succeed; if the reader skips it, they can still finish the task.
Use a caution notice to tell the reader to proceed carefully, and a warning notice for an action that could be irreversible or damaging, such as permanent data loss.
Never use a notice to state a prerequisite, a required step, or a cross-reference; those belong in the ordinary flow of the text.
Never place two notices back to back; if the content seems to need it, restructure the surrounding text instead.
Write sparingly: a page with a notice in every section loses the visual distinctiveness that makes notices useful in the first place.

## Tables

Use a table when each item carries three or more related pieces of data, such as a set of parameters with a name, a type, and a description.
Use a list instead of a table when each item is a single unit, and a description list instead of a table when each item is only a term and a definition.
Introduce a table with a complete sentence describing its purpose, since a table has no inherent reading order for assistive technology.
Give a table a caption only when the page contains more than one table; otherwise place the table directly beside the text that refers to it.
Write concise, sentence-case column headings with no trailing punctuation, and mark header cells as headers rather than styling them to merely look like headers.
Never merge table cells, never use a table purely for visual page layout, and never split one long one-dimensional list across table columns just to save space.

## Cross-references

Be selective about which links a page includes; every link is a decision and a chance for the reader to lose their place.
Prefer a short in-page explanation over a link when the missing context is a definition, a brief concept, or a couple of steps.
Write link text as either the exact title of the destination or a short descriptive phrase; never write vague link text such as "click here" or "this document."
Never use a bare URL as link text; use the destination's title or a description instead.
Avoid duplicate links to the same destination within one page unless the page is long enough, or has separate entry points, that a second link genuinely helps.
Introduce a dedicated cross-reference sentence with a consistent phrase such as "For more information, see X," and add "about Y" when the link text alone does not explain why the reader would follow it.
Let the reader's own settings decide whether a link opens in the current tab or a new one; only force a new tab in rare cases, and say so when you do.

## Dates, times, and numbers

Spell out the day of the week and the month in full, and give the full four-digit year, rather than a numeric-only date, because the order of day, month, and year in numeric dates varies by region.
When a numeric-only date is unavoidable, use a four-digit year, a two-digit month, and a two-digit day, separated by hyphens, so the order is unambiguous.
Spell out the numbers zero through nine in running text; use numerals for 10 and greater, and always use numerals for version numbers, technical quantities, prices, and measurements regardless of size.
Use a hyphen with no surrounding spaces for a range of plain numbers, and repeat the unit on both sides of a range that carries a unit.
Put a nonbreaking space between a number and its unit, except for currency, percentages, and angles, which take no space.

## Timeless writing

Write about the current state of a feature, not about how it changed from an earlier version or how it might change later; avoid words like "now," "new," "currently," and "soon" in reference and concept material.
If a comparison to an earlier version is genuinely necessary, anchor it to a specific date or version number rather than a relative word like "recently."
Timeless writing reduces the maintenance burden on a page and avoids assuming the reader has seen an earlier version of the feature.
