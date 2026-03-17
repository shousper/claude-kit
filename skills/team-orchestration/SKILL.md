---
name: team-orchestration
description: Creates and coordinates teams of persistent AI teammates with shared task lists, messaging, and lifecycle management. Use when spawning teammates, creating a team, setting up reviewers or implementers, coordinating multi-agent work, or any skill references "kit:team-orchestration". Provides the scaffolding for TeamCreate, teammate spawning, task dependencies, SendMessage communication, and graceful shutdown.
---

# Team Orchestration

Shared foundation for team-aware skills. Defines how to create teams, spawn teammates, coordinate work, and shut down cleanly.

**Core principle:** Teams API replaces raw Task tool dispatch. Persistent teammates coordinate via shared task lists and messaging.

**Announce at start:** "I'm setting up a team using the team-orchestration skill."

## Team Setup

### 1. Create Team

TeamCreate with descriptive name derived from the work:

- Name teams after the work, not the skill. Short, kebab-case.
- Example: `"implement-auth-feature"`, `"fix-test-failures"`, `"brainstorm-caching"`

### 2. Spawn Teammates

Use the Task tool with `team_name` parameter to spawn teammates into the team.

**Agent type selection:**
- `general-purpose` — teammates that write code, run commands, edit files
- `Explore` — pure research/read-only work (scouts, analyzers)
- `Plan` — read-only, for architecture and planning work that uses ExitPlanMode

**Naming convention:** Role-based, lowercase with hyphens: `implementer`, `spec-reviewer`, `quality-reviewer`, `scout-1`, `scout-2`.

### 3. Verify Team

After spawning, read the team config to confirm all members registered:

```
Read: ~/.claude/teams/<team-name>/config.json
```

## Task Coordination

### Creating Tasks

Use `TaskCreate` with:
- Descriptive subject
- Full context in description (everything the teammate needs to start)
- `activeForm` for spinner text

### Dependencies

Use `TaskUpdate` with `addBlockedBy` for ordering:
- Review tasks blocked by implementation
- Next implementation blocked by previous reviews
- Integration tasks blocked by all component tasks

### Assignment

Use `TaskUpdate` with `owner` set to the teammate's name.

### Monitoring

Use `TaskList` to check progress. All teammates see the same task list.

## Communication

### Assigning Work to Persistent Teammates

- **First task:** Included in spawn prompt — teammate starts working immediately
- **Subsequent tasks:** Send via `SendMessage` with full task context

### Answering Questions

Teammates may ask questions via SendMessage. Answer promptly — they're blocked until you respond.

### Peer Communication

Teammates can DM each other directly. The team lead sees a summary in idle notifications.

### Plan Approval

When a teammate with `plan_mode_required` finishes planning:

1. Teammate calls `ExitPlanMode` — sends `plan_approval_request` to team lead
2. Team lead reviews the plan
3. Team lead responds with `plan_approval_response`:
   - **Approve:** teammate exits plan mode and begins implementation
   - **Reject with feedback:** teammate revises the plan and resubmits

### Broadcasting (Use Sparingly)

Only for critical blockers affecting the entire team. Each broadcast sends a separate message to every teammate.

## Teammate Lifecycle

Teammates are **persistent** — they stay alive across task assignments.

```
Spawn → Work → Idle → Wake (on message) → Work → Idle → ... → Shutdown
```

**Do not re-spawn teammates for each task.** Send new assignments via message.

## Parallelism Rules

| Safety | When | Examples |
|--------|------|----------|
| **Safe** | Read-only tasks | Reviews, research, analysis |
| **Conditional** | Non-overlapping writes | Different files/modules |
| **Never** | Same-file writes | Two teammates editing same file |

Team lead assesses parallelism safety per task pair. When uncertain, default to sequential.

## Shutdown Protocol

1. Verify all tasks complete (`TaskList` — no pending/in_progress)
2. Send `shutdown_request` to each teammate
3. Wait for `shutdown_response` from each
4. `TeamDelete` to clean up

## Integration

Referenced by domain skills:

```
**Required:** kit:team-orchestration — set up team before starting
```

Domain skills bring their own workflow logic and prompt templates. This skill provides the coordination scaffolding.

## Red Flags

**Never:**
- Re-spawn teammates instead of messaging existing ones
- Broadcast when a DM would suffice
- Assign overlapping file modifications to parallel teammates
- Skip shutdown protocol (leaks resources)
- Create team without descriptive name

**Always:**
- Verify team members via config file after spawning
- Use TaskList dependencies for ordering
- Respond promptly to teammate questions
- Shut down teammates gracefully before TeamDelete
