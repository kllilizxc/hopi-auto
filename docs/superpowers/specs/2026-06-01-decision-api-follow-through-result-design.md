# Decision API Follow-Through Result Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Make Bun decision answer/resolve APIs surface the same durable authority that the shared decision runtime already computes, including planner follow-through metadata and runtime-generated workflow identities.

## Why This Slice Exists

The current system already supported:

- full decision-runtime results from `resolveGoalDecision(...)`, `answerGoalDecision(...)`, and `answerGoalDecisions(...)`
- decision follow-through on `planning`, `planning_batch`, and `workflow_batch`
- generated durable `W-*` workflow keys when workflow callers omit `workflowKey`

But one API authority gap still remained:

- `POST /api/goals/:goalKey/decisions/answer` returned only the resolved decision body
- `POST /api/goals/:goalKey/decisions/answers` returned only `{ goalKey, decisions }`
- `POST /api/goals/:goalKey/decisions/:decisionKey/resolve` returned only the resolved decision body
- callers therefore lost `blockerRemoved`, creation metadata, full `followThrough`, and any generated `W-*` workflow key

That meant the Bun API hid durable planner authority that runtime had already made explicit.

## Constraints

- keep the shared runtime helpers as the single source of truth
- do not introduce a second API-only result shape for decision follow-through
- keep plain decision creation on `POST /api/goals/:goalKey/decisions` unchanged
- preserve existing status codes for created versus reused decisions

## Implemented Scope

### Full Runtime Result Surfacing

The Bun API now returns the full shared runtime result for:

- `POST /api/goals/:goalKey/decisions/answer`
- `POST /api/goals/:goalKey/decisions/answers`
- `POST /api/goals/:goalKey/decisions/:decisionKey/resolve`

That means callers now receive the same durable fields runtime computed, including:

- resolved `decision` or `decisions`
- `created` or `createdDecisionKeys`
- `blockerRemoved`
- `followThrough`

### Generated Workflow Keys Stay Visible

When decision-backed `workflow_batch` follow-through omits `workflowKey`, runtime may now generate `W-*` during the shared planning-workflow path and the Bun API will return that generated key directly inside `followThrough.workflowKey`.

So generated workflow identity is not only durable in `planning-requests.yml`; it is also visible to callers at the API boundary for immediate later extension.

### No Extra Compatibility Wrapper

The API now exposes runtime authority directly instead of re-wrapping it into older reduced response bodies.

This keeps:

- runtime result shape
- assistant action result shape
- Bun API result shape

aligned on the same durable contract.

## Non-Goals

- changing the plain decision-creation response on `POST /api/goals/:goalKey/decisions`
- inventing a new standalone workflow-response schema outside existing runtime result types
- adding workflow metadata anywhere outside the existing runtime result plus `planning-requests.yml`

## Acceptance Criteria

- `resolve` API responses include `blockerRemoved` and any planner `followThrough`
- `answer` API responses include `created`, `blockerRemoved`, and full `followThrough`
- `answers` API responses include `createdDecisionKeys`, `blockerRemoved`, and full `followThrough`
- decision-backed workflow follow-through responses surface generated `W-*` keys when runtime creates them
- Bun API decision answer/resolve routes and shared runtime stay on one result contract
