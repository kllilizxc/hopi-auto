# Direct Planning Answer Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let direct planning surfaces reuse the same interpreted planner-answer authority that already existed on decision-backed follow-through, instead of forcing planner answers to be fully expanded before calling direct planning APIs or assistant actions.

## Why This Slice Exists

The runtime already supported interpreted planner answers on decision-backed surfaces:

- `record_answer`
- `record_answers`
- `resolve_decision`
- `followThrough.kind = "planning" | "planning_batch" | "workflow_batch"`

That still left one asymmetric gap:

- direct `request_planning`
- direct `request_planning_batch`
- direct `request_planning_workflows`
- Bun API `POST /api/goals/:goalKey/planning-requests`
- Bun API `POST /api/goals/:goalKey/planning-requests/workflows`

could only accept fully materialized planner answers.

So the same raw user reply could be reused through decision-backed follow-through, but not through direct planning. That was the wrong authority boundary.

## Constraints

- keep `planning-requests.yml` as the only durable planner-answer store
- do not create a second planning-only interpretation engine
- reuse the existing shared answer-interpretation runtime
- preserve existing explicit direct planning payloads
- stay deterministic
- do not add fuzzy matching or semantic planner-summary inference

## Implemented Scope

### Direct Planning Requests

Direct planning requests now accept the same interpreted planner-answer inputs as decision-backed follow-through:

- `answers`
- `answerSources`
- `sourceResponse`
- `sourceResponseFormat`
- root `inferRemainingAnswers`

This applies to:

- assistant `request_planning`
- Bun API `POST /api/goals/:goalKey/planning-requests`

### Grouped Planning Requests

Grouped planning requests now accept the same interpreted planner-answer inputs at the batch root:

- `answers`
- `answerSources`
- `sourceResponse`
- `sourceResponseFormat`
- root `inferRemainingAnswers`

This applies to assistant `request_planning_batch`.

The Bun product path still does not expose a separate grouped-planning API route; that surface remains assistant-only.

### Direct Workflow Graphs

Direct workflow graphs now accept interpreted planner-answer authority at the workflow root:

- `answers`
- `answerSources`
- `sourceResponse`
- `sourceResponseFormat`
- root `inferRemainingAnswers`

Child workflow leaves now also accept interpreted planner-answer entries for their own explicit `answers`.

This applies to:

- assistant `request_planning_workflows`
- Bun API `POST /api/goals/:goalKey/planning-requests/workflows`

### Shared Runtime Path

This slice does not add a second planning interpreter.

Instead, direct planning inputs now materialize through the same shared follow-through interpretation runtime that already powers decision-backed planner follow-through, and only then flow into:

- `requestGoalPlanning(...)`
- `requestGoalPlanningBatch(...)`
- `requestGoalPlanningWorkflows(...)`

That keeps one authority path for:

- reusable `answerSources`
- `single_pending`
- ordered reply surfaces
- question-shaped reply surfaces
- topic-shaped reply surfaces
- root inferred remaining planner answers

## Non-Goals

- introducing a direct grouped-planning HTTP route
- inventing new direct-planning-only reply formats
- broadening `inferRemainingAnswers` beyond the formats already accepted by the shared interpreter
- changing durable workflow metadata layout
- fuzzy planner-answer inference from fully loose prose

## Acceptance Criteria

- direct planning request surfaces can materialize interpreted planner answers from shared reply input without routing through a decision action first
- assistant grouped planning can materialize interpreted planner answers from the same shared reply authority
- direct workflow graphs can materialize workflow-root shared planner answers from the same shared reply authority
- child workflow leaves can carry explicit interpreted planner answers on the direct workflow surface
- all of those surfaces still reuse the existing shared interpretation runtime instead of forking planner-only semantics
