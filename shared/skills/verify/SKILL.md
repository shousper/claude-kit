---
name: verify
description: Enforces fresh verification evidence before any completion or success claims. Use when about to say "done", "fixed", "tests pass", "build succeeds", or any synonym; before committing, creating PRs, or moving to the next task; before expressing satisfaction or positive statements about work state; and after agent delegation to independently verify results. Prevents unverified claims by requiring command execution, output inspection, and exit code confirmation.
---

# Verification Before Completion

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

## Hard Gate: No Claims Without Fresh Evidence

If you haven't run the verification command in this message, you cannot claim it passes. Stale results from previous runs don't count — code may have changed since then, and re-running is cheap compared to shipping a false claim.

## The Verification Steps

Before claiming any status or expressing satisfaction:

1. **Identify:** What command proves this claim?
2. **Run:** Execute the full command (fresh, complete)
3. **Read:** Full output, check exit code, count failures
4. **Verify:** Does output confirm the claim?
   - If no: state actual status with evidence
   - If yes: state claim with evidence
5. **Then claim:** Only after steps 1-4

Skipping steps means the claim is unsupported. Unsupported claims erode trust — your human partner can't distinguish "I checked and it passes" from "I assume it passes" unless you show evidence.

## What Counts as Evidence

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Agent completed | VCS diff shows changes | Agent reports "success" |
| Requirements met | Line-by-line checklist | Tests passing |

## Recognizing Unverified Claims

Watch for these patterns in your own output — they indicate you're about to make a claim without evidence:

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!")
- About to commit/push/PR without running checks
- Trusting agent success reports without independent verification
- Relying on partial verification (linter passed, so build must be fine)
- Any wording implying success without having run the command

When you notice one of these, pause and run the verification command before continuing.

## Why Partial Verification Fails

| Shortcut | Why it doesn't work |
|----------|---------------------|
| "Should work now" | Confidence isn't evidence. Run the command. |
| "Linter passed" | Linter checks style, not compilation or correctness. They verify different things. |
| "Agent said success" | Agents can report success while producing incomplete or broken output. Check the diff. |
| "Partial check is enough" | Each verification tool checks different properties. Passing one doesn't imply others pass. |

## Key Patterns

**Tests:**
```
OK:  [Run test command] [See: 34/34 pass] "All tests pass"
BAD: "Should pass now" / "Looks correct"
```

**Regression tests (TDD Red-Green):**
```
OK:  Write -> Run (pass) -> Revert fix -> Run (fails) -> Restore -> Run (pass)
BAD: "I've written a regression test" (without red-green verification)
```

**Build:**
```
OK:  [Run build] [See: exit 0] "Build passes"
BAD: "Linter passed" (linter doesn't check compilation)
```

**Requirements:**
```
OK:  Re-read plan -> Create checklist -> Verify each -> Report gaps or completion
BAD: "Tests pass, phase complete"
```

**Agent delegation:**
```
OK:  Agent reports success -> Check VCS diff -> Verify changes -> Report actual state
BAD: Trust agent report at face value
```

## Why This Matters

From 24 failure memories:
- your human partner said "I don't believe you" - trust broken
- Undefined functions shipped - would crash
- Missing requirements shipped - incomplete features
- Time wasted on false completion, then redirect, then rework
- Violates: "Honesty is a core value. If you lie, you'll be replaced."

Verification takes seconds. Rebuilding trust takes much longer.

## When To Apply

Before:
- Any variation of success/completion claims
- Any expression of satisfaction about work state
- Committing, PR creation, task completion
- Moving to next task
- Reporting on delegated agent work

The rule applies to exact phrases, paraphrases, synonyms, and implications of success — any communication suggesting completion or correctness.

## The Bottom Line

Run the command. Read the output. Then claim the result.
