# Decision Resolution Planner Follow-Through Design

Status: approved and implemented
Date: 2026-06-01

## Goal

When an answered decision unblocks engineering work, route that work through visible planner follow-through before engineering continues.

## Why This Slice Exists

The current system already supports:

- visible decision blockers
- durable decision answers
- durable planning requests with requested `design.md` / `todo.yml` updates
- scheduler enforcement that planning follow-through must leave durable evidence

But one major gap remained:

- resolving a decision for an engineering task could simply remove the blocker
- the next reconcile could send engineering straight back into generator work
- planner would have no guaranteed chance to update `design.md` and reshape `todo.yml` first

That contradicts the intended long-term flow where material answers should update design and task decomposition before engineering resumes.

## Constraints

- `todo.yml` remains the only workflow truth
- planner remains the only graph-shaping runtime
- no hidden engineering resume path after material answers
- use the existing planning-request and visible task surfaces instead of adding a new queue or hidden state store

## Implemented Scope

### Shared Follow-Through Rule On Decision Resolution

When `resolveGoalDecision` resolves a decision that is explicitly linked to engineering work, runtime now:

1. creates or reuses one visible planning follow-through request
2. ensures that request carries the resolved decision key plus `design.md` and `todo.yml` requested updates
3. rewires affected engineering tasks from the resolved `decision` blocker to a `task` blocker on the visible planning task

This keeps the planner-in-the-loop requirement visible and deterministic.

### Default Follow-Through Shape

The created or reused planning follow-through is intentionally narrow:

- title is derived from the decision topic
- requested updates default to `design.md` and `todo.yml`
- decision lineage includes the resolved decision key

The system does not guess at engineering implementation work. It only creates the visible planning bridge that planner must satisfy first.

### Limited Scope

This automatic follow-through applies only when the resolved decision is explicitly linked to engineering work.

Planning-task decisions continue to behave as before because the planning task itself is already the follow-through surface.

## Non-Goals

- automatic engineering task creation from answered decisions
- semantic inference about which unrelated tasks should also be re-planned when they were not explicitly linked
- changing the meaning of planning-task decision resolution
- a hidden planner queue or automatic planner execution on decision resolution

## Acceptance Criteria

- resolving a decision linked to engineering work creates or reuses visible planning follow-through
- affected engineering work stays blocked on that planning task instead of resuming immediately
- the follow-through request carries the resolved decision key plus `design.md` and `todo.yml` requested updates
- planning-task decision resolution remains unchanged
