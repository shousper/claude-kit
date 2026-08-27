# Claude Search Optimization (CSO)

**Critical for discovery:** Future Claude needs to FIND your skill

## 1. Rich Description Field

**Purpose:** Claude reads description to decide which skills to load for a given task. Make it answer: "Should I read this skill right now?"

**Format:** Two-part structure — lead with capabilities (WHAT), follow with triggers (WHEN):

```yaml
description: [Capability statement]. Use when [triggering conditions]
```

**Industry consensus** (Anthropic, OpenAI, Google, academic research): Descriptions MUST include both what the skill does and when to use it. Omitting capabilities causes undertriggering — Claude won't select skills it can't match to a task.

**CRITICAL: Capabilities yes, workflow no.**

Descriptions should state what the skill **produces or achieves** (capabilities), never **how it works step-by-step** (workflow). Workflow details in descriptions cause Claude to follow the description as a shortcut instead of reading the full skill body.

```yaml
# ❌ BAD: Workflow — Claude follows this instead of reading the skill
description: Dispatches subagent per task with code review between tasks. Use when executing plans

# ❌ BAD: Workflow steps leaked into description
description: Writes test first, watches it fail, writes minimal code, then refactors. Use for TDD

# ❌ BAD: No capabilities — Claude can't match this to tasks
description: Use when executing implementation plans with independent tasks

# ❌ BAD: Too abstract, no capabilities or triggers
description: For async testing

# ✅ GOOD: Capability + trigger, no workflow
description: Executes implementation plans by coordinating persistent teammates with batch-boundary reviews. Use when you have a plan with independent tasks to implement in the current session

# ✅ GOOD: Capability + trigger
description: Enforces test-driven development with RED-GREEN-REFACTOR discipline. Use when implementing any feature or bugfix, before writing implementation code

# ✅ GOOD: Capability + trigger for a technique skill
description: Diagnoses flaky tests by identifying race conditions and timing dependencies. Use when tests pass/fail inconsistently or have timing-sensitive assertions
```

**Be pushy.** Anthropic's own guidance: Claude tends to *undertrigger* skills. Err on the side of broader triggers. Include cases where the user doesn't name the domain directly.

**Content rules:**
- Lead with concrete action verbs: "Creates", "Diagnoses", "Enforces", "Generates", "Coordinates"
- Include trigger term **synonyms** and natural phrasing (e.g., "PR", "pull request", "merge request")
- Describe the *problem* (race conditions) not *language-specific symptoms* (setTimeout)
- Write in third person (injected into system prompt)
- Add **negative triggers** when disambiguation is needed: "DO NOT TRIGGER when: [conflicting scenarios]"
- Keep under 500 characters if possible (max 1024)

**Distinctiveness check:** Before finalizing, verify your description doesn't overlap with other installed skills. Vague descriptions with generic terms cause selection confusion.

```yaml
# ❌ BAD: Overlaps with every development skill
description: Helps with code quality. Use when writing code

# ✅ GOOD: Clear niche with distinctive terms
description: Creates draft pull requests using repo PR templates with automated branch detection. Use when implementation is complete and ready to open a PR — defaults to draft PRs, supports "ready for review" override
```

## 2. Keyword Coverage

Use words Claude would search for:
- Error messages: "Hook timed out", "ENOTEMPTY", "race condition"
- Symptoms: "flaky", "hanging", "zombie", "pollution"
- Synonyms: "timeout/hang/freeze", "cleanup/teardown/afterEach"
- Tools: Actual commands, library names, file types

## 3. Descriptive Naming

**Use active voice, verb-first:**
- ✅ `creating-skills` not `skill-creation`
- ✅ `condition-based-waiting` not `async-test-helpers`

## 4. Token Efficiency (Critical)

**Problem:** getting-started and frequently-referenced skills load into EVERY conversation. Every token counts.

**Target word counts:**
- getting-started workflows: <150 words each
- Frequently-loaded skills: <200 words total
- Other skills: <500 words (still be concise)

**Techniques:**

**Move details to tool help:**
```bash
# ❌ BAD: Document all flags in SKILL.md
search-conversations supports --text, --both, --after DATE, --before DATE, --limit N

# ✅ GOOD: Reference --help
search-conversations supports multiple modes and filters. Run --help for details.
```

**Use cross-references:**
```markdown
# ❌ BAD: Repeat workflow details
When searching, dispatch subagent with template...
[20 lines of repeated instructions]

# ✅ GOOD: Reference other skill
Always use subagents (50-100x context savings). REQUIRED: Use [other-skill-name] for workflow.
```

**Compress examples:**
```markdown
# ❌ BAD: Verbose example (42 words)
your human partner: "How did we handle authentication errors in React Router before?"
You: I'll search past conversations for React Router authentication patterns.
[Dispatch subagent with search query: "React Router authentication error handling 401"]

# ✅ GOOD: Minimal example (20 words)
Partner: "How did we handle auth errors in React Router?"
You: Searching...
[Dispatch subagent → synthesis]
```

**Eliminate redundancy:**
- Don't repeat what's in cross-referenced skills
- Don't explain what's obvious from command
- Don't include multiple examples of same pattern

**Verification:**
```bash
wc -w skills/path/SKILL.md
# getting-started workflows: aim for <150 each
# Other frequently-loaded: aim for <200 total
```

**Name by what you DO or core insight:**
- ✅ `condition-based-waiting` > `async-test-helpers`
- ✅ `using-skills` not `skill-usage`
- ✅ `flatten-with-flags` > `data-structure-refactoring`
- ✅ `root-cause-tracing` > `debugging-techniques`

**Gerunds (-ing) work well for processes:**
- `creating-skills`, `testing-skills`, `debugging-with-logs`
- Active, describes the action you're taking

## 4. Cross-Referencing Other Skills

**When writing documentation that references other skills:**

Use skill name only, with explicit requirement markers:
- ✅ Good: `**REQUIRED SUB-SKILL:** Use kit:tdd`
- ✅ Good: `**REQUIRED BACKGROUND:** You MUST understand kit:debugging`
- ❌ Bad: `See skills/testing/test-driven-development` (unclear if required)
- ❌ Bad: `@skills/testing/test-driven-development/SKILL.md` (force-loads, burns context)

**Why no @ links:** `@` syntax force-loads files immediately, consuming 200k+ context before you need them.
