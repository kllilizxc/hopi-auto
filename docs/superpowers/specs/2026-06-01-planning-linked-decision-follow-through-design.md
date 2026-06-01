# Planning-Linked Decision Follow-Through Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let an answered decision that is linked to current planning work reuse that existing planning surface for explicit durable follow-through, instead of forcing runtime to leave the planning task unchanged or create a second wrapper task.

## Why This Slice Exists

The current system already supports:

- planning-task decision blockers
- explicit single or grouped decision-resolution follow-through for engineering-linked decisions
- grouped planning follow-through and generalized Goal-local requested update paths

But one important gap remained:

- when a decision was linked to a planning task, resolving it still only removed the decision blocker by default
- explicit `followThrough` on `resolve_decision` did not reuse that existing planning surface
- richer answer-driven planner work therefore still depended on either an engineering blocker or a second separate planning action

That left planning-stage answers too weak for cases where the current planning task should immediately become the durable follow-through surface for updated Goal docs or decomposition work.

## Constraints

- keep `todo.yml` as the only workflow truth
- keep `planning-requests.yml` as the only durable planner follow-through store
- preserve current planning-task default behavior when no explicit `followThrough` is supplied
- avoid creating a duplicate wrapper planning task when one current planning surface already exists
- keep this slice scoped to decisions linked to one current planning task surface; broader answer inference remains out of scope

## Implemented Scope

### Reuse The Current Planning Surface

When `resolveGoalDecision` receives explicit `followThrough` and the resolved decision is linked to an open planning task, runtime now binds that follow-through to the current planning surface instead of creating a new wrapper task.

For single-task explicit follow-through:

- the current planning task keeps its task ref
- task title, description, and acceptance criteria are updated to the richer follow-through shape
- a planning request is created or reused on that same task ref

### Grouped Follow-Through From A Planning Surface

For grouped explicit follow-through on a planning-linked decision:

- the first batch stage reuses the current linked planning task
- later grouped stages create or reuse additional planning tasks as needed
- grouped task blockers remain explicit through the existing `blockedBy.kind=task` model

This lets one answered planning decision expand into a richer staged planner workflow without leaving a stale wrapper task behind.

### Engineering Rewire Still Works

If engineering work is also blocked by the same resolved decision, engineering blockers still rewire onto the current grouped sink tasks or single follow-through task produced by the shared decision-resolution path.

This keeps the planner-in-the-loop rule intact across mixed planning and engineering consumers of the same decision answer.

## Non-Goals

- changing default planning-task decision resolution when no explicit `followThrough` is supplied
- automatic inference from arbitrary non-decision user messages
- generalized reuse of multiple existing planning tasks from one decision answer
- hidden follow-through state outside visible tasks plus `planning-requests.yml`

## Acceptance Criteria

- resolving a planning-linked decision with explicit single-task follow-through reuses the current planning task surface and durable request
- resolving a planning-linked decision with explicit grouped follow-through reuses the current planning task as the first grouped stage
- no duplicate wrapper planning task is created just to carry the richer follow-through
- engineering work blocked by the same decision still rewires to the current follow-through sink tasks when applicable
- planning-task decision resolution without explicit follow-through remains unchanged
