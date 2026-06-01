# Direct Planning Workflow Child-Dependency Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let direct higher-order planning workflows express durable child-to-child dependencies so one child can wait on another child’s current sink across both the initial workflow call and later workflow extensions.

## Why This Slice Exists

The current system already supported:

- direct higher-order planning workflows through `request_planning_workflows`
- stable top-level workflow identity through `workflowKey`
- stable standalone child identity through `workflowTaskKey`
- stable grouped child identity through `groupKey`

That still left one richer workflow gap:

- direct workflow children were still only independent siblings
- a later child could not durably wait on an earlier child without manually pinning raw task refs
- if an upstream child later extended and its sink changed, downstream children had no authority path to retarget onto the new sink

## Constraints

- keep `planning-requests.yml` as the only durable planning-follow-through metadata file
- do not introduce a second workflow graph store
- preserve existing grouped-task dependency semantics inside `planning_batch`
- keep engineering blocker propagation aligned with the current workflow tail instead of raw per-call task refs

## Implemented Scope

### Durable `blockedByWorkflowKeys`

Direct `request_planning_workflows` children can now carry:

- `blockedByWorkflowKeys`: stable child dependency refs inside one `workflowKey`

Reference rules:

- standalone `planning` children are referenced by `workflowTaskKey`
- grouped `planning_batch` children are referenced by `groupKey`

These dependency keys are persisted on the underlying planning requests that own the child’s external workflow dependency boundary.

### Dependency Resolution On Create And Extension

When a direct workflow child is created or updated with `blockedByWorkflowKeys`, runtime now:

1. resolves those keys against the current child identities already visible in the same `workflowKey`
2. rejects missing refs, self-dependencies, and child-dependency cycles
3. translates the dependency onto the referenced child’s current sink task refs

For grouped children, runtime applies those external workflow blockers to the grouped child’s root requests while leaving existing intra-group `blockedByTaskKeys` unchanged.

### Sink Retargeting Across Later Upstream Extension

Runtime now persists enough child dependency metadata to retarget downstream child blockers when an upstream child’s sink changes later.

If an upstream grouped child extends from one sink task to a later sink task, dependent children automatically rewire from the old sink to the new sink on the next `request_planning_workflows(...)` call for that `workflowKey`.

### Workflow-Tail Aggregation

Top-level `workflow_batch.blockerTaskRefs` for direct workflows now follow the child dependency graph:

- prerequisite children are excluded from the top-level sink set
- only child-graph tail workflows contribute aggregate `blockerTaskRefs`

That keeps engineering blockers aligned with the durable workflow tail rather than a flat union of every child sink.

## Non-Goals

- introducing workflow-child dependencies outside direct `request_planning_workflows`
- replacing grouped-task `blockedByTaskKeys`
- inferring child dependencies from titles, ordering alone, or planner text
- creating a second durable workflow dependency document

## Acceptance Criteria

- a direct workflow child can depend on an earlier child through stable `blockedByWorkflowKeys`
- grouped and standalone children can both participate in that child dependency graph
- missing refs, self-dependencies, and cycles are rejected
- downstream child blockers retarget when an upstream child’s current sink changes later
- aggregate workflow `blockerTaskRefs` reflect only the workflow-child tail sinks
