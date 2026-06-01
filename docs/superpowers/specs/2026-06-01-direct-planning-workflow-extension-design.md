# Direct Planning Workflow Extension Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let direct higher-order planning workflows persist one durable top-level identity so later calls can extend the same workflow batch instead of creating disconnected one-off batches.

## Why This Slice Exists

The current system already supported:

- direct higher-order planning workflows through `request_planning_workflows`
- one-surface reuse for the first child in those workflow batches
- blocker propagation across every current sink when a reused planning blocker expands into a workflow batch

That still left one durable workflow gap:

- a direct workflow batch had no stable top-level identity after the first call
- later assistant or API work could open more planning children, but runtime could not recognize them as part of the same higher-order workflow
- engineering blocker propagation and inspection therefore stopped at one call boundary instead of one durable workflow boundary

## Constraints

- keep `planning-requests.yml` as the only durable planning-follow-through metadata file
- do not introduce a second workflow store
- do not require synthetic child wrapper tasks
- preserve current grouped extension semantics inside `planning_batch` children

## Implemented Scope

### Durable `workflowKey`

Planning requests now support an optional durable `workflowKey`.

For direct `request_planning_workflows`, assistant and API can set:

- `workflowKey`: one stable top-level workflow identity

Runtime writes that key onto every request touched by the batch.

### Workflow-State Reconstruction

When `requestGoalPlanningWorkflows(...)` is called with a `workflowKey`, runtime reconstructs the current open workflow state from all open requests carrying that key:

- grouped children are rebuilt from requests that share one `groupKey` and durable `groupTaskKey`
- standalone planning children are rebuilt from requests without grouped child identity

The result returned to assistant or API therefore reflects the whole current workflow state, not just the newest child requests from the latest extension call.

### Workflow-Wide Blocker Retargeting

If engineering is already blocked on any request inside a durable `workflowKey`, later extension calls retarget those engineering blockers onto the workflow key’s current sink set.

That keeps engineering aligned with the full durable workflow instead of whichever child happened to be opened first.

## Non-Goals

- adding durable child-level workflow keys beyond existing `requestKey`, `groupKey`, and `groupTaskKey`
- automatic inference of when separate planning requests should share one `workflowKey`
- introducing a new top-level workflow resolution state outside open planning requests

## Acceptance Criteria

- direct `request_planning_workflows` can persist a stable `workflowKey`
- a later call with the same `workflowKey` can extend the existing higher-order workflow
- returned workflow-batch state reflects the full current workflow, while `createdRequestKeys` and `createdTaskRefs` still reflect only the latest delta
- engineering blockers tied to that workflow keep tracking the workflow key’s current sink tasks
