# Assistant Run Resolved Format Inspection Design

## Goal

Surface the concrete deterministic answer-interpretation format used by runtime through normal assistant-run detail inspection, instead of leaving that provenance visible only in immediate mutation responses or raw bundle files.

## Current Gap

- Shared runtime already computes `resolvedSourceResponseFormat`.
- Decision/direct-planning API mutation responses already return it.
- Assistant action results already persist it in assistant run records.
- Bun assistant-run detail inspection still hides it from the normal product surface.

That means the durable run record already knows which deterministic interpretation surface won, but a user inspecting the run in the Bun UI cannot see it without opening raw `result.json`.

## Design

### Pure assistant action-result formatter

Extract the assistant action-result detail-line construction into one small pure formatter. That keeps the logic testable without importing the full browser entrypoint.

### Resolved format detail line

When an assistant action result includes `resolvedSourceResponseFormat`, render one explicit detail line:

- `Resolved source-response format: <format>`

This sits alongside the existing created/blocker/follow-through detail lines.

### Reuse in assistant-run detail UI

The Bun assistant-run detail card keeps its current structure, but now renders detail lines through the shared formatter so the resolved interpretation format becomes visible in the standard inspection path.

### Durable inspection coverage

Lock the inspection path with coverage that checks:

- the immediate `/assistant/run` response still carries the resolved format
- durable `GET /api/goals/:goalKey/assistant/runs/:assistantRunId` detail readback also carries it
- the UI formatter renders it

## Non-Goals

- No new interpretation formats
- No answer-interpretation behavior changes
- No bundle layout changes
- No new durable metadata beyond the already-persisted `resolvedSourceResponseFormat`

## Verification

- Assistant action-result formatter unit test
- Assistant-run detail server readback test
- Backend typecheck and lint
