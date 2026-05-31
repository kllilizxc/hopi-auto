# Durable Planning Requests And Planner Follow-Through Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Close the next planner/runtime gap by making planner follow-through a first-class file-native input surface instead of relying on visible planning tasks alone.

## Why This Slice Exists

Earlier slices already allowed assistant to:

- create visible planning tasks
- reuse existing planning tasks through `request_planning`
- unblock work through decisions and explicit reconcile controls

What was still missing was durable planner intent:

- a planning task in `todo.yml` showed that planning work existed, but not the durable follow-through request behind it
- planner context had no explicit file-native request surface analogous to `decisions.yml` or `.hopi/preference.md`
- planning completion did not close the loop on outstanding planning requests

That made planning follow-through too implicit for the long-term deterministic core.

## Constraints

- workflow truth remains `todo.yml`
- planner follow-through requests must stay file-native, inspectable, and deterministic
- no compatibility layer for deleted prototype concepts
- planner should consume follow-through requests through explicit context, not hidden runtime state

## Implemented Scope

### Durable Planning Request Store

New Goal-scoped file:

```text
.hopi/docs/goals/<goalKey>/planning-requests.yml
```

This stores durable planning requests with:

- `requestKey`
- `title`
- `description`
- `acceptanceCriteria`
- linked visible `taskRef`
- `open` or `resolved` status
- timestamps plus optional resolution summary

### Shared Planning Request Control Path

New shared helper coordinates the board and planning-request store:

- assistant and API can request planning follow-through through one deterministic path
- visible planning tasks are reused or created deterministically
- open planning requests are reused instead of duplicated when the same visible follow-through is already open

### Planner Context Integration

Planner bundles now include:

- `planning-requests.yml` path
- current `planning-requests.yml` content
- relevant open planning requests linked to the current planning task

Planner prompt policy now explicitly states that open planning requests linked to the current task must be addressed before success.

### Deterministic Follow-Through Resolution

When a planning task reaches `done`, linked open planning requests are auto-resolved with a deterministic resolution summary.

This closes the loop without expanding planner file-write boundaries beyond the current authority model.

### Bun API And UI Surfacing

The active Bun product path now supports:

- `GET /api/goals/:goalKey/planning-requests`
- `POST /api/goals/:goalKey/planning-requests`
- Goal assistant runs that create durable planning requests through `request_planning`
- Bun UI surfacing and creation of planning follow-through requests

## Non-Goals

- planner directly editing `planning-requests.yml`
- generalized workflow queues or background orchestration services
- semantic deduplication beyond deterministic open-request reuse
- full manual lifecycle management for every stale planning request scenario

## Acceptance Criteria

- durable planning requests are stored in `planning-requests.yml`
- assistant `request_planning` creates or reuses both visible planning work and a durable planning request
- planner context includes planning requests and explicit follow-through policy
- planning task completion auto-resolves linked open planning requests
- Bun API and Bun UI surface planning-request creation and inspection on the active product path
