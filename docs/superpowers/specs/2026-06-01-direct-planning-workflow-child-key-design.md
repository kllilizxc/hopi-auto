# Direct Planning Workflow Child-Key Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let standalone children inside one direct higher-order planning workflow persist a stable child identity so later calls can update the same child in place without relying on request ids or title collisions.

## Why This Slice Exists

The current system already supported:

- direct higher-order planning workflows through `request_planning_workflows`
- one durable top-level `workflowKey` for extending the same direct workflow batch
- durable grouped-child identity through `groupKey` plus `groupTaskKey`

That still left one child-level workflow gap:

- standalone `planning` children inside a durable `workflowKey` had no stable semantic identity
- later assistant or API calls could only target those children by low-level `requestKey` or by accidentally reusing the same title
- generic title-based reuse could also attach a new child onto the wrong existing planning surface

## Constraints

- keep `planning-requests.yml` as the only durable planning-follow-through metadata file
- do not introduce a second child-workflow store
- do not require wrapper tasks or synthetic child workflow records
- preserve existing grouped-child extension semantics through `groupKey` and `groupTaskKey`

## Implemented Scope

### Durable `workflowTaskKey`

Standalone `planning` children in direct `request_planning_workflows` can now carry:

- `workflowTaskKey`: one stable child identity inside a durable `workflowKey`

Runtime persists that key onto the underlying planning request.

`workflowTaskKey` requires a `workflowKey`, because the child identity only makes sense inside one durable top-level workflow.

### Child Reuse Before Generic Title Reuse

When `requestGoalPlanning(...)` receives both `workflowKey` and `workflowTaskKey`, runtime now:

1. looks for an open planning request with the same `workflowKey` and `workflowTaskKey`
2. updates that request and its visible planning task in place if found
3. skips generic title-based request reuse and generic title-based task reuse when no matching child key exists

That makes explicit child identity authoritative instead of letting title heuristics win.

### Workflow Reconstruction And Surfacing

Workflow-state reconstruction now surfaces `workflowTaskKey` on standalone direct-workflow children.

Assistant, API, planner context, and Bun UI now all expose that child key so later extensions remain inspectable instead of becoming hidden runtime-only behavior.

## Non-Goals

- adding a second child-key model for grouped children beyond existing `groupKey` and `groupTaskKey`
- automatic inference of `workflowTaskKey` from a title or planner content
- introducing child resolution state outside normal planning-request open/resolved semantics

## Acceptance Criteria

- direct `request_planning_workflows` can persist a stable `workflowTaskKey` for standalone children
- a later call with the same `workflowKey` and `workflowTaskKey` reuses the existing child request and task even if the title changes
- generic title-based reuse no longer steals child identity when `workflowTaskKey` is present
- reconstructed workflow state and inspection surfaces expose `workflowTaskKey`
