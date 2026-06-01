# Standalone Decision Follow-Through Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let an explicit answered decision create visible planner follow-through even when that decision was not already blocking engineering work and did not already have one reusable planning surface.

## Why This Slice Exists

The current system already supports:

- engineering-linked decision resolution with default or explicit planner follow-through
- planning-linked decision resolution with explicit reuse of the current planning surface
- assistant `resolve_decision` that can create a missing durable decision topic before resolving it

But one important gap remained:

- explicit `followThrough` on `resolve_decision` still depended on either affected engineering blockers or one reusable planning surface
- a durable answer with no current visible consumer could not directly create durable planning work through the shared decision-resolution path
- assistant therefore still had to split one answer into separate decision and planning actions in cases where the answer itself should immediately open visible planner work

That left answer-driven planner workflows too weak when the system had a durable answer before it had any visible blocker or planning surface to hang that answer on.

## Constraints

- keep `decisions.yml` as the durable answer store
- keep `planning-requests.yml` as the only durable planner follow-through store
- do not introduce a hidden answer queue or second workflow truth
- preserve current default behavior when `resolve_decision` has no explicit `followThrough`
- preserve current engineering-linked and planning-linked reuse behavior

## Implemented Scope

### Explicit Standalone Follow-Through

When `resolveGoalDecision` receives explicit `followThrough`, runtime now allows that follow-through to create visible planning work even when:

- no engineering task is currently blocked by that decision
- no reusable planning task is currently linked to that decision

Single-task explicit follow-through creates or reuses one visible planning request through the existing planning-request path.

Grouped explicit follow-through creates one grouped visible planner workflow through the existing grouped planning-request path.

### Existing Reuse Rules Still Win

If the resolved decision already has one reusable planning surface, runtime still reuses it.

If the resolved decision is also blocking engineering work, engineering blockers still rewire to the current follow-through sink tasks exactly as before.

This keeps the new standalone path additive instead of replacing the newer linked-task behaviors.

### Assistant One-Step Durable Answer

Goal assistant can now:

1. create a durable decision topic when needed
2. resolve it immediately with the user's explicit answer
3. create visible planner follow-through in that same `resolve_decision` action

That gives one atomic product-path move for answers that should immediately reshape Goal docs or decomposition even before there was a visible blocker.

## Non-Goals

- automatic follow-through when `resolve_decision` has no explicit `followThrough`
- semantic inference from arbitrary user messages without a durable decision answer
- replacing `request_planning` or `request_planning_batch` as standalone actions
- hidden planner work outside visible tasks plus `planning-requests.yml`

## Acceptance Criteria

- resolving an existing unlinked decision with explicit follow-through creates visible planning work
- assistant can create and resolve a previously missing decision topic and open visible planning follow-through in one action
- existing planning-surface reuse and engineering-blocker rewiring behavior remain unchanged
- resolving an unlinked decision without explicit follow-through still does not invent planner work
