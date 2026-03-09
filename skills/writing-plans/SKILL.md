---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Context:** This should be run in a dedicated worktree (created by brainstorming skill).

**Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md`

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step

**No commit steps.** The user controls when commits happen.

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use kit:team-dev to implement this plan task-by-task.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

**Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

**Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS
````

## Remember
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- Reference relevant skills with `kit:<skill-name>` syntax
- DRY, YAGNI, TDD
- **No commit steps** — commits are your human partner's decision

## Common Mistakes

- **Vague steps.** "Add validation" is not a step. Show the exact code and the exact test.
- **Giant tasks.** If a task has more than 8 steps, split it into multiple tasks.
- **Missing test commands.** Every test step needs the exact run command and expected outcome.
- **Forgetting file paths.** Every file reference must be an exact path from the repo root. No "the config file" or "the test file."
- **Skipping the header.** The plan header with Goal/Architecture/Tech Stack is required — it orients the implementer before they read task details.

## Execution Handoff

After saving the plan, offer the user a choice:

**"Plan complete and saved to `docs/plans/<filename>.md`.**

**Option 1 — Continue here:** I'll invoke kit:team-dev now to start implementation.

**Option 2 — Fresh context:** Use `/clear` or start a new session, then paste this prompt:

> Read the implementation plan at `docs/plans/<filename>.md` and execute it using the kit:team-dev skill.

**Which do you prefer?"**

Wait for the user's choice before proceeding.
