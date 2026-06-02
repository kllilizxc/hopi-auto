# Planning Workflow Inspection Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Give durable higher-order planning workflow graphs an explicit read surface, so callers can inspect one current workflow graph by `workflowKey` without reverse-engineering it from scattered planning requests or only remembering an earlier mutation result.

## Why This Slice Exists

The current system already supported:

- direct and decision-backed workflow graphs through durable `workflowKey`
- stable child identities through `workflowTaskKey`, `groupKey`, and `blockedByWorkflowKeys`
- workflow-root shared context persistence on open planning requests
- generated `W-*` workflow identities and later workflow extension

That still left one authority gap:

- the runtime could reconstruct current workflow state internally, but Bun API and UI did not expose that workflow graph as a first-class readable object
- operators had to inspect raw planning requests and manually correlate `workflowKey`, child structure, and tail blockers
- workflow-root shared context existed durably, but there was no dedicated inspection surface for it

## Constraints

- keep `planning-requests.yml` as the only durable workflow metadata truth
- do not add a second workflow registry or cached projection file
- preserve current mutation result shapes for `requestGoalPlanningWorkflows(...)`
- expose current open workflow state only from the authoritative planning requests plus board tasks

## Implemented Scope

### Runtime Read Helpers

The planning runtime now exposes dedicated read helpers:

- `listGoalPlanningWorkflows(...)`
- `readGoalPlanningWorkflow(...)`

These helpers reconstruct the current open workflow graph from:

- open planning requests with the target `workflowKey`
- current non-done planning tasks on the board

### Rich Workflow Graph Read Model

The new workflow read surface exposes:

- `workflowKey`
- `workflowSharedDecisionRefs`
- `workflowSharedAnswers`
- child workflow structure
- current workflow-tail blocker refs

Each child in the read model carries enough detail to be self-describing:

- standalone `planning` children expose their full request object
- grouped `planning_batch` children expose the grouped request objects they currently own
- both child types expose `blockedByWorkflowKeys` plus current child-tail blockers

### Bun API Surfacing

The Bun API now exposes:

- `GET /api/goals/:goalKey/planning-requests/workflows`
- `GET /api/goals/:goalKey/planning-requests/workflows/:workflowKey`

That makes durable workflow graphs inspectable independently of any create or update call.

### Bun UI Surfacing

The Bun UI now includes a dedicated `Planning Workflows` section.

That section renders:

- the durable workflow key
- workflow-root shared decisions
- workflow-root shared answers
- grouped child membership
- current workflow-tail blockers
- child request titles grouped by workflow child

## Non-Goals

- changing mutation semantics for direct or decision-backed workflow graphs
- introducing workflow-graph editing from the UI
- adding historical closed workflow snapshots outside current open planning requests

## Acceptance Criteria

- runtime can list open workflow graphs for one goal without reading any second store
- runtime can read one workflow graph by `workflowKey`, including root shared context and child request detail
- Bun API exposes workflow graph list and detail endpoints
- Bun UI surfaces durable workflow graphs separately from raw planning requests
