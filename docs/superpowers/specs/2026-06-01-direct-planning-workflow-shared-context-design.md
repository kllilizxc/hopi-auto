# Direct Planning Workflow Shared Context Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let one direct `request_planning_workflows` action carry shared durable planning context across the whole workflow graph, instead of forcing every child workflow to repeat the same decision lineage and captured non-decision answers.

## Why This Slice Exists

The current system already supported:

- direct higher-order planning workflows through `request_planning_workflows`
- stable top-level workflow identity through `workflowKey`
- stable standalone child identity through `workflowTaskKey`
- stable child-to-child dependencies through `blockedByWorkflowKeys`
- child-level `decisionRefs` and captured `answers`

That still left one authority gap:

- when the same decision lineage or captured answer applied across the whole workflow graph, callers had to duplicate that metadata onto every child
- that duplication made assistant actions noisier and made it easier for one child inside the same durable workflow graph to drift from the others accidentally

## Constraints

- keep `planning-requests.yml` as the only durable planning-follow-through store
- do not introduce a separate workflow-context document
- preserve child-level overrides and extensions instead of replacing them with one workflow-global payload only

## Implemented Scope

### Workflow-Root Shared Context

Direct `requestGoalPlanningWorkflows(...)`, assistant `request_planning_workflows`, and Bun API `POST /api/goals/:goalKey/planning-requests/workflows` now accept optional workflow-root:

- `decisionRefs`
- `answers`

That shared context is merged into every child workflow before runtime delegates to `requestGoalPlanning(...)` or `requestGoalPlanningBatch(...)`.

### Child Context Still Stays First-Class

Child workflows can still provide their own:

- `decisionRefs`
- `answers`

Runtime merges the workflow-root context first, then appends any child-specific additions in stable order without duplication.

That means:

- one workflow graph can carry one shared durable planning baseline
- individual children can still add extra lineage or answer context when they truly diverge

### Existing Durable Semantics Stay Reused

This slice does not introduce new workflow truth.

The merged context still lands only on the underlying planning requests, so existing semantics stay intact:

- planning request reuse
- grouped planning extension
- workflow-key extension
- workflow-child dependency rewiring
- requested-update validation

## Non-Goals

- introducing workflow-root `requestedUpdates`
- changing decision-backed workflow-batch follow-through semantics in this slice
- inferring shared workflow context from unstructured user replies without explicit action payloads

## Acceptance Criteria

- direct `request_planning_workflows` can carry shared `decisionRefs` across the whole workflow graph
- direct `request_planning_workflows` can carry shared captured `answers` across the whole workflow graph
- child workflows still can add extra `decisionRefs` or `answers` without losing the shared baseline
- assistant, Bun API, and runtime helper all expose the same workflow-root shared-context shape
