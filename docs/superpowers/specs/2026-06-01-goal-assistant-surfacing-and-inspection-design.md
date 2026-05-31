# Goal Assistant Surfacing And Inspection Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Surface the already-implemented Goal assistant runtime through first-class inspection APIs and the Bun UI, so assistant stops being a hidden backend capability and becomes part of the product path.

## Why This Slice Exists

The prior slice already added:

- explicit `POST /api/goals/:goalKey/assistant/run`
- constrained assistant actions
- assistant run bundles under `.hopi/runtime/goals/<goalKey>/assistant/runs/**`

But without inspection and UI surfacing, that runtime still depended on manual API use and filesystem inspection.

## Implemented Scope

### Assistant Run Store

Add a read-side store over assistant run `result.json` files:

- list assistant runs newest-first
- read one assistant run in detail
- validate run records before surfacing them

### Assistant Inspection APIs

Add:

- `GET /api/goals/:goalKey/assistant/runs`
- `GET /api/goals/:goalKey/assistant/runs/:assistantRunId`

These expose assistant run summaries and run detail without overloading task run history.

### UI Surfacing

The Bun UI now includes a Goal assistant panel that can:

- submit an assistant prompt
- show current decision topics
- show recent assistant thread entries
- show recent assistant runs
- inspect one assistant run’s request, reply, action results, and runtime events

### SSE Refresh

Assistant execution now broadcasts `assistant_changed`, and also reuses `board_changed` when assistant actions mutate visible workflow state.

That lets the UI refresh when assistant changes Goal state.

## Non-Goals

- deep assistant chat UX
- preference editing UI
- arbitrary assistant actions beyond the current constrained set
- replacing scheduler progression with assistant-side imperative orchestration

## Acceptance Criteria

- assistant runs are inspectable without reading files manually
- UI can trigger assistant execution
- UI can inspect decision topics and assistant thread state
- UI can inspect assistant run action results and runtime events
- assistant surfacing stays on the Bun-first backend/UI path
