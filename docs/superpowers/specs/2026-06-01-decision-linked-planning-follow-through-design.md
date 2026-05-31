# Decision-Linked Planning Follow-Through Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Make durable planning follow-through requests carry the exact decision lineage and requested update targets that explain why planner work must reshape `design.md` and `todo.yml`.

## Why This Slice Exists

Earlier slices already made planning follow-through durable:

- `planning-requests.yml` exists
- assistant and API can open planning requests
- planner context consumes open requests linked to the current planning task
- planning review and merge policy checks for durable follow-through evidence

But one important planner/runtime gap remained:

- a planning request could say what work was needed, but not which decisions triggered it
- planner had no durable per-request signal for whether the follow-through must update `design.md`, `todo.yml`, or both
- repeated assistant or operator requests with the same title could reuse visible work while silently dropping newer decision lineage

That left the most important planner reshape intent too implicit for the long-term deterministic core.

## Constraints

- `todo.yml` remains the only workflow truth
- `planning-requests.yml` remains a file-native request surface, not a second task graph
- no compatibility layer for deleted prototype concepts
- planner follow-through metadata must be inspectable through the active Bun API/UI path
- repeated requests should enrich one deterministic open request instead of creating hidden parallel truth

## Implemented Scope

### Richer Planning Request Metadata

`planning-requests.yml` now supports two additional optional fields per request:

- `decisionRefs`: stable decision keys that materially triggered this planning follow-through
- `requestedUpdates`: explicit durable targets that planner is expected to reshape

For this slice, `requestedUpdates` is intentionally narrow:

- `design.md`
- `todo.yml`

That keeps the schema grounded in the current authority files instead of introducing a broader abstract workflow taxonomy.

### Deterministic Request Enrichment

When a new `request_planning` call or API request reuses an existing open planning request with the same visible work, the system now deterministically merges:

- additional `decisionRefs`
- additional `requestedUpdates`

This preserves the single open request while keeping newer planner follow-through intent durable.

### Assistant And API Coverage

`request_planning` now accepts optional:

- `decisionRefs`
- `requestedUpdates`

The direct planning-request API and Bun UI expose the same fields so assistant-driven and operator-driven follow-through use one shared control path.

### Planner Context And Policy

Planner context now renders relevant planning request lineage in a richer form:

- linked decision refs
- requested durable update targets

Planner policy is strengthened accordingly:

- if a relevant planning request targets `design.md`, planner must update durable design rationale before success
- if a relevant planning request targets `todo.yml`, planner must reshape the visible task graph before success

Planning reviewer and merger inspection now see the same request metadata, which makes follow-through evidence more explicit.

## Non-Goals

- automatic semantic classification of arbitrary user messages into follow-through targets
- a new workflow queue or background planner service
- planner directly mutating `planning-requests.yml`
- metadata beyond decision lineage and explicit durable file targets

## Acceptance Criteria

- durable planning requests can store decision lineage and requested update targets
- repeated same-request follow-through reuses one open request while deterministically preserving newer lineage metadata
- assistant `request_planning` and direct API/UI creation can set that metadata
- planner context and prompt policy surface the richer metadata in terms of `design.md` and `todo.yml`
- planning reviewer and merger inspection can see the same richer follow-through intent
