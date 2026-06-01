# Workflow Shared Context Persistence Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Make workflow-root shared context durable across later `workflowKey` extensions, so callers do not need to restate the same shared `decisionRefs` or captured `answers` every time one durable workflow graph grows.

## Why This Slice Exists

The current system already supported:

- direct workflow-root shared context through `request_planning_workflows`
- answer-driven workflow-root shared answers through decision-backed `workflow_batch`
- stable workflow graph identity through `workflowKey`

That still left one authority gap:

- root shared context only existed on the current call payload
- later `workflowKey` extensions had to restate the same shared context manually
- if callers omitted it, newly added children lost the earlier shared workflow context even though the graph identity stayed durable

## Constraints

- keep `planning-requests.yml` as the only durable planner-follow-through metadata file
- do not add a second workflow-root store
- preserve child-local `decisionRefs` and `answers` instead of flattening everything into one workflow-global blob

## Implemented Scope

### Durable Workflow-Root Context In `planning-requests.yml`

Planning requests now persist optional workflow-root shared context on each workflow-linked request:

- `workflowSharedDecisionRefs`
- `workflowSharedAnswers`

This keeps the durable truth inside the existing `planning-requests.yml` surface instead of inventing a new workflow document.

### Later Extensions Reuse Persisted Shared Context

When `requestGoalPlanningWorkflows(...)` receives an existing `workflowKey`, runtime now:

1. reconstructs the current persisted shared workflow context from open requests already carrying that key
2. merges any newly provided root shared context on the current call
3. applies the resulting shared baseline to every newly added child
4. synchronizes every existing open child request in that workflow so the persisted shared baseline stays exact

That means later extensions can omit repeated root context and still inherit it.

### Child-Local Context Still Stays Stable

Existing child-local metadata is preserved by subtracting the old shared baseline and then reapplying the new shared baseline.

So:

- grouped child-only answers stay child-only
- standalone child-only decision lineage stays child-only
- only the workflow-root shared baseline propagates to new children

### Cross-Surface Reuse Works The Same Way

This persistence now applies across:

- direct `request_planning_workflows`
- decision-backed and answer-backed `workflow_batch` follow-through that already reuses the same shared planning helper

So one answer-driven workflow graph can later be extended through direct planning without restating the earlier shared workflow context.

## Non-Goals

- introducing workflow-root `requestedUpdates`
- creating a dedicated workflow metadata store
- inferring missing shared context from old workflows that never persisted it before this slice

## Acceptance Criteria

- direct workflow graphs persist root shared context across later `workflowKey` extensions
- answer-driven workflow graphs persist root shared context across later direct planning extensions
- newly added children inherit the persisted root shared context even when the later extension omits it
- child-local extras remain child-local after the shared baseline is resynchronized
