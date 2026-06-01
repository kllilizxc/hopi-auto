# Direct Planning Workflow Blocker Propagation Design

Status: approved and implemented
Date: 2026-06-01

## Goal

When direct higher-order planning workflows reuse one existing planning surface that is already blocking engineering, ensure engineering waits on every current workflow sink instead of only the first reused child.

## Why This Slice Exists

The current system already supported:

- direct higher-order planning workflows through `request_planning_workflows`
- one-surface reuse for the first child in those workflow batches
- grouped planning blocker propagation within one `groupKey`
- decision-backed `workflow_batch` follow-through that fans engineering blockers out to every workflow sink

That left one planner/runtime gap on the pure planning surface:

- if a reused planning surface already blocked engineering, only the first child workflow continued to block engineering
- sibling workflows opened by the same direct workflow batch were invisible to that engineering blocker
- this broke parity with decision-backed `workflow_batch` semantics and allowed engineering to resume before the whole expanded planning workflow was complete

## Constraints

- keep `planning-requests.yml` as the durable truth for planning follow-through
- do not introduce a new workflow blocker store
- preserve grouped planning blocker propagation as the lower-level primitive
- only retarget engineering blockers when a workflow batch is explicitly reusing one current planning surface

## Implemented Scope

### Workflow-Batch-Level Blocker Rewire

After `requestGoalPlanningWorkflows(...)` materializes all child workflows, runtime now computes:

- the first child workflow’s current sink blockers
- the full workflow batch’s current sink blockers

If the workflow batch reused an existing planning surface, engineering tasks that are currently blocked on the first child workflow’s sink blockers are retargeted to the full workflow batch sink set.

### Grouped First Child Still Composes Correctly

If the first child is `planning_batch`, grouped blocker propagation still runs first and determines the grouped child’s current sink blockers.

The workflow-batch propagation step then expands that grouped sink set to include sibling workflow sinks from the same direct batch.

This means later grouped extensions still compose correctly:

- grouped sync can keep moving the grouped portion to its current open leaves
- sibling workflow blockers from the same direct batch remain attached

## Non-Goals

- inferring blocker fan-out when no planning surface was explicitly reused
- adding durable top-level workflow IDs
- changing non-engineering task blockers
- changing decision-backed `workflow_batch` semantics

## Acceptance Criteria

- when direct `request_planning_workflows` reuses one current planning surface, engineering blockers previously tied to that surface expand to every current workflow sink
- grouped first-child workflows still compose with existing grouped blocker propagation
- no new durable blocker state or workflow store is introduced
