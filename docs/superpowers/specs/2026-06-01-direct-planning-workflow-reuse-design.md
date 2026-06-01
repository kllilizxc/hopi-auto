# Direct Planning Workflow Reuse Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let direct higher-order planning workflows reuse one existing visible planning surface as their first child workflow, instead of forcing runtime to create a wrapper planning task.

## Why This Slice Exists

The current system already supported:

- direct multi-workflow planning through `request_planning_workflows`
- grouped planning reuse through `request_planning_batch` plus `reuseTaskRefByTaskKey`
- decision-linked multi-workflow follow-through that could reuse one current planning surface for the first child workflow

That left one direct planning gap:

- an existing visible planning surface could not be expanded into a direct `workflow_batch`
- runtime always created a new first child workflow, even when one open planning task was the right surface to preserve
- that produced avoidable wrapper work and broke parity with the existing decision-linked reuse model

## Constraints

- keep `planning-requests.yml` as the durable truth for planning follow-through
- keep visible planning tasks on the Goal board as the only visible workflow surface
- do not add workflow wrapper records or another reuse overlay
- preserve the existing rule that only one reusable planning surface may be consumed per higher-order workflow batch

## Implemented Scope

### Shared `reuseTaskRef` On Direct Workflow Batches

`requestGoalPlanningWorkflows(...)`, assistant `request_planning_workflows`, and Bun API `POST /api/goals/:goalKey/planning-requests/workflows` now accept:

- `reuseTaskRef`: one open planning task ref

Runtime consumes that reusable surface only once, on the first child workflow.

### First-Child Reuse Works For Both Leaf Shapes

If the first child is:

- `planning`: runtime routes `reuseTaskRef` through the existing single-request reuse path
- `planning_batch`: runtime maps `reuseTaskRef` onto that grouped workflow’s first `taskKey`

This keeps the reuse rule aligned with the existing decision-linked `workflow_batch` model.

### Aggregated Workflow Result Stays Stable

The returned `workflow_batch` result still reports:

- all `requestKeys`
- all `taskRefs`
- all `blockerTaskRefs`
- created-only `createdRequestKeys`
- created-only `createdTaskRefs`

When the first child reuses an existing planning surface, that reused request/task appears in the aggregate lists but not in the created-only lists.

## Non-Goals

- reusing more than one existing planning surface per workflow batch
- inferring which planning task should be reused automatically
- introducing reusable top-level workflow keys
- changing decision-backed `workflow_batch` semantics

## Acceptance Criteria

- direct `request_planning_workflows` can reuse one existing open planning surface as the first child workflow
- first-child reuse works whether that child is `planning` or `planning_batch`
- reused surfaces are excluded from `createdRequestKeys` and `createdTaskRefs`
- assistant and Bun API share the same direct workflow reuse model
