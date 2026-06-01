# Decision Workflow Shared Answer Context Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let one decision-backed or answer-backed `workflow_batch` carry shared non-decision captured answers across the whole workflow graph, instead of forcing the same durable answer context to be repeated on every child.

## Why This Slice Exists

The current system already supported:

- decision-backed and answer-backed `workflow_batch` follow-through through `resolve_decision`, `record_answer`, and `record_answers`
- shared durable workflow-graph authority through `workflowKey`, `workflowTaskKey`, and `blockedByWorkflowKeys`
- automatic resolved `decisionRefs` injection onto every child
- child-level captured `answers`

That still left one cross-surface authority gap:

- direct `request_planning_workflows` already supported workflow-root shared `answers`
- decision-backed `workflow_batch` still required callers to repeat the same non-decision captured answer on every child
- that made answer-driven workflow graphs noisier and weaker than the direct workflow graph surface they already reused

## Constraints

- keep `decisions.yml` as the only durable truth for decision answers
- keep `planning-requests.yml` as the only durable planner-follow-through metadata file
- preserve automatic decision-lineage injection instead of asking callers to restate `decisionRefs`
- do not introduce a separate answer-workflow context store

## Implemented Scope

### Workflow-Root Shared Answers

Decision-backed and answer-backed `workflow_batch` now accept optional root:

- `answers`

through:

- runtime `resolveGoalDecision(...)`
- runtime `answerGoalDecision(...)`
- runtime `answerGoalDecisions(...)`
- Bun API `resolve`, `answer`, and `answers` endpoints
- assistant `resolve_decision`, `record_answer`, and `record_answers` actions

Runtime passes those shared answers into the already-shared `requestGoalPlanningWorkflows(...)` helper.

### Child Answers Still Stay First-Class

Child workflows can still carry their own `answers`.

Runtime merges:

1. automatic resolved `decisionRefs`
2. workflow-root shared `answers`
3. child-level extra `answers`

without duplication and in stable order.

That means:

- one answer-driven workflow graph can carry one shared durable non-decision answer baseline
- individual children can still add extra answer context where they truly diverge

## Non-Goals

- adding workflow-root `requestedUpdates` to decision follow-through
- changing the default single-workflow decision bridge when no explicit follow-through is supplied
- requiring every decision-backed `workflow_batch` to carry a `workflowKey`

## Acceptance Criteria

- decision-backed `workflow_batch` can carry one shared root `answers` array
- answer-backed `workflow_batch` can carry one shared root `answers` array
- child workflows still can add extra `answers` without losing the shared baseline
- assistant, Bun API, and runtime all expose the same workflow-root shared-answer surface
