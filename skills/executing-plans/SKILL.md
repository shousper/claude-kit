---
name: executing-plans
description: Coordinates batch execution of a written implementation plan by spawning implementer and reviewer teammates, executing tasks in batches with automated review gates, and pausing for human feedback between batches. Use when handed a plan file to execute, resuming plan work in a new session, or running a standalone plan outside the brainstorming flow. DO NOT TRIGGER for same-session execution after brainstorming — use kit:team-dev instead.
---

# Executing Plans

## Overview

Load plan, create a team with implementer and reviewer teammates, execute tasks in batches with automated review gates, report for human review between batches.

**Core principle:** Batch execution with automated review + human checkpoints.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

## When to Use

Use executing-plans when:
- Executing a plan in a NEW session (not continuing from brainstorming)
- Handed a plan file without prior conversation context
- Want batch + review workflow without the full brainstorming chain

For same-session execution after brainstorming/writing-plans, use kit:team-dev instead (the default workflow).

## The Process

### Step 1: Load and Review Plan
1. Read plan file
2. Review critically — identify questions or concerns
3. If concerns: Raise with your human partner before starting
4. If no concerns: Create TaskList and proceed

### Step 2: Create Team

**REQUIRED:** Use kit:team-orchestration to set up the team.

1. Create team with plan-derived name
2. Spawn teammates:
   - `implementer` (general-purpose) — executes tasks
   - `reviewer` (general-purpose) — reviews each batch
   - Additional implementers for batches with independent tasks
3. Verify team via config

### Step 3: Execute Batch

**Default: First 3 tasks**

For each task in the batch:
1. Assign to implementer via SendMessage (or TaskUpdate owner for parallel tasks)
2. Implementer follows each step exactly
3. Implementer runs verifications as specified
4. Implementer reports completion

**Within-batch parallelism:** If tasks in the batch are independent (different files), assign to separate implementers simultaneously.

### Step 4: Automated Review Gate

After batch completes:
1. Assign review to reviewer teammate
2. Reviewer checks implementation against plan
3. Reviewer reports findings to team lead

### Step 5: Report to Human

When batch + review complete:
- Show what was implemented
- Show verification output
- Include reviewer findings
- Say: "Ready for feedback."

### Step 6: Continue

Based on human feedback:
- Forward fixes to implementer if needed
- Execute next batch
- Repeat until complete

### Step 7: Complete Development

After all tasks complete and verified:
- Shutdown team (kit:team-orchestration shutdown protocol)
- **REQUIRED:** Use kit:finish-branch

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker mid-batch (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly
- Reviewer flags Critical issues

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** — stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Between batches: report with reviewer findings and wait
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent
- Do not commit during implementation — commits happen at kit:finish-branch when your human partner is ready

## Integration

**Required workflow skills:**
- **kit:team-orchestration** — REQUIRED: Set up team before starting
- **kit:git-worktrees** — REQUIRED if entering without prior worktree (skip if already in a worktree from brainstorming)
- **kit:writing-plans** — Creates the plan this skill executes. Note: kit:team-dev is the default workflow for same-session plan execution; this skill is the alternate entry point for cross-session or standalone plan execution
- **kit:finish-branch** — Complete development after all tasks
