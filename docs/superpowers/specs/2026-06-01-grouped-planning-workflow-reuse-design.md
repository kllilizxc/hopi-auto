# Grouped Planning Workflow Reuse Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let one higher-order planning workflow graph reuse an already-open grouped planning surface as its first child, instead of forcing callers to replay every grouped request manually or leaving part of that group outside the workflow graph.

## Why This Slice Exists

The current system already supported:

- durable grouped planning through `groupKey` plus `groupTaskKey`
- direct multi-workflow planning through `request_planning_workflows`
- first-child single-task reuse through `reuseTaskRef`
- decision-backed workflow graphs that could reuse one linked planning task

But one important grouped-surface gap remained:

- an existing grouped planning surface could only join a workflow graph if the caller replayed some or all grouped requests
- any open grouped siblings that were not replayed stayed outside the workflow graph
- that created a half-attached authority surface where one visible planning group was split across workflow membership
- planning-linked decision answers therefore still degraded to single-task reuse even when the real reusable surface was the whole current group

That behavior was not durable enough for the long-term workflow-graph route.

## Constraints

- keep `planning-requests.yml` as the only durable planner follow-through truth
- keep visible Goal-board planning tasks as the only visible workflow surface
- do not add a separate workflow-membership store for groups
- preserve the existing rule that only one existing reusable surface is consumed by the first child in a workflow batch
- prefer explicit grouped-surface reuse over implicit partial adoption

## Implemented Scope

### Explicit Grouped Reuse On Direct Workflow Graphs

Direct `requestGoalPlanningWorkflows(...)`, assistant `request_planning_workflows`, and Bun API `POST /api/goals/:goalKey/planning-requests/workflows` now accept:

- `reuseGroupKey`: one open grouped planning surface to reuse on the first child

Runtime requires:

- the first child to be `planning_batch`
- that child’s `groupKey` to match `reuseGroupKey`

This keeps grouped reuse explicit and prevents accidental half-adoption.

### Group Adoption Reuses The Whole Open Group

When grouped reuse is selected, runtime now:

- finds every open planning request in that group
- attaches the whole open group to the target workflow graph
- applies workflow-root shared context to every reused grouped request
- applies grouped child context to every reused grouped request
- applies child-level workflow dependency keys only to the grouped root requests

This means omitted grouped siblings no longer remain outside the workflow graph.

### Group Adoption Can Also Extend The Group

The reused first `planning_batch` child may now:

- use an empty `requests` array when it only needs to adopt the existing group
- include only genuinely new or updated grouped requests when it also needs to extend that same group

Existing grouped requests no longer need to be replayed just to preserve membership.

### Planning-Linked Decision Workflow Graphs Reuse The Whole Group

When an answered decision is linked to one open planning task that already belongs to a grouped planning surface, and the explicit workflow graph starts with that same grouped child, the decision runtime now reuses the whole grouped surface automatically.

This upgrades planning-linked decision workflow graphs from single-task reuse to grouped-surface reuse without introducing a second grouped-workflow authority path.

## Non-Goals

- reusing more than one existing grouped planning surface per workflow batch
- inferring grouped reuse when the first child does not clearly match the current reusable group
- changing non-workflow grouped follow-through semantics
- adding hidden workflow wrapper records outside `planning-requests.yml`

## Acceptance Criteria

- direct workflow graphs can explicitly reuse one existing grouped planning surface as their first child
- grouped reuse adopts every open request in that group, not only the requests replayed on the current call
- the reused grouped child may use an empty `requests` array when no grouped extension is needed
- planning-linked decision workflow graphs can reuse the whole current grouped planning surface when the first child matches it
- no second durable workflow-membership store is introduced
