# Direct Planning Workflow Batch Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let assistant or API atomically open more than one independent durable planning workflow directly on the planning surface, without forcing those workflows to route through a decision-answer action first.

## Why This Slice Exists

The current system already supported:

- one visible planning workflow through `request_planning`
- one grouped visible planning workflow through `request_planning_batch`
- multiple independent planner workflows only as decision-answer follow-through through `workflow_batch`

That left one planner/runtime gap:

- some user replies imply several independent planning workflows
- those workflows do not always belong under one durable decision answer
- assistant had to emit several separate planning actions, which lost atomicity and made the resulting planner move harder to inspect as one durable operation

## Constraints

- keep `planning-requests.yml` as the only durable truth for planning follow-through
- keep visible planning tasks on the existing Goal board
- do not add a new workflow queue, wrapper store, or planner session document
- reuse existing single-workflow and grouped-workflow planning helpers instead of introducing another planner materialization path

## Implemented Scope

### Shared Runtime Helper

Runtime now exposes `requestGoalPlanningWorkflows(...)`.

It accepts an ordered `workflows` array whose children are:

- `planning`: one direct visible planning request
- `planning_batch`: one grouped visible planning workflow

Each child reuses the existing `requestGoalPlanning(...)` or `requestGoalPlanningBatch(...)` path.

### Shared Assistant And API Surface

The same higher-order workflow shape is now available through:

- assistant `request_planning_workflows`
- Bun API `POST /api/goals/:goalKey/planning-requests/workflows`

This keeps direct multi-workflow planning on the same constrained planning surface as the existing single-workflow actions.

### Aggregated Result Model

The shared helper returns one `workflow_batch` result with:

- `workflows`
- `groupKeys`
- `requestKeys`
- `taskRefs`
- `blockerTaskRefs`
- `createdRequestKeys`
- `createdTaskRefs`

This lets callers preserve one atomic product-level response while still relying only on the underlying planning requests and visible tasks as durable truth.

### Existing Planning Semantics Stay Reused

Each child workflow still inherits the existing semantics of its lower-level helper, including:

- open-request reuse
- grouped dependency validation
- grouped sink blocker propagation
- decision lineage capture
- captured non-decision answers
- requested-update target validation

## Non-Goals

- changing `decisions.yml`
- introducing direct inference of user replies into multiple workflow children
- replacing decision-backed `workflow_batch` follow-through
- inventing a second durable planning workflow store

## Acceptance Criteria

- assistant and API can atomically open more than one independent durable planning workflow without going through a decision-answer action
- each child workflow still reuses the existing single-workflow or grouped-workflow runtime path
- grouped workflow sink blockers still determine `blockerTaskRefs`
- the durable truth remains only `planning-requests.yml` plus visible board tasks
