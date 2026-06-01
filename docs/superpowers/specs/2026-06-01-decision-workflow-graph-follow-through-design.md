# Decision Workflow-Graph Follow-Through Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let decision-backed and answer-backed `workflow_batch` follow-through reuse the same durable workflow graph authority as direct `request_planning_workflows`, instead of maintaining a second weaker multi-workflow path.

## Why This Slice Exists

The current system already supported:

- decision-backed `workflow_batch` follow-through for `resolve_decision`, `record_answer`, and `record_answers`
- direct planning workflow graphs with stable `workflowKey`
- stable standalone child identity through `workflowTaskKey`
- stable child-to-child dependencies through `blockedByWorkflowKeys`

That still left one cross-surface authority gap:

- decision-backed `workflow_batch` still materialized children through its own ad-hoc loop
- those answer-driven workflows could not persist `workflowKey`, `workflowTaskKey`, or `blockedByWorkflowKeys`
- later direct planning extensions therefore lost the original answer-driven workflow graph and behaved like disconnected new work

## Constraints

- keep `decisions.yml` as the durable answer truth
- keep `planning-requests.yml` as the only durable planner-follow-through metadata file
- do not introduce a second answer-workflow store
- preserve existing decision-lineage injection, planning-surface reuse, and engineering-blocker rewiring

## Implemented Scope

### Shared Higher-Order Runtime Path

Decision-backed `workflow_batch` now reuses the shared `requestGoalPlanningWorkflows(...)` runtime helper instead of looping over `planning` and `planning_batch` children itself.

That means answer-driven workflows now inherit the same authority surface as direct planning workflows:

- `workflowKey`
- `workflowTaskKey`
- `blockedByWorkflowKeys`
- current-tail blocker aggregation
- later extension through the same durable workflow graph

### Decision Lineage Still Injects Automatically

Callers still do not provide `decisionRefs` on decision follow-through children.

Runtime injects the resolved decision lineage onto every created or reused planning request before passing the workflow graph into the shared planning helper.

### Reuse And Extension Stay Composable

If a decision already points at one reusable planning surface, that surface still only feeds the first workflow child.

Once the answer-driven workflow graph is created, later direct `request_planning_workflows(...)` calls can extend the same `workflowKey` and keep downstream child dependencies rewired to the current upstream sink.

## Non-Goals

- changing the default single-workflow decision bridge when no explicit follow-through is supplied
- requiring every decision-backed `workflow_batch` to set a `workflowKey`
- introducing a second set of answer-only child dependency rules
- inferring workflow graphs from unstructured answers without explicit action payloads

## Acceptance Criteria

- decision-backed `workflow_batch` can persist a stable `workflowKey`
- answer-driven standalone children can persist `workflowTaskKey`
- answer-driven child dependencies can persist `blockedByWorkflowKeys`
- later direct workflow extensions can continue the same answer-driven durable workflow graph
- engineering blockers still follow the workflow graph’s current tail sinks
