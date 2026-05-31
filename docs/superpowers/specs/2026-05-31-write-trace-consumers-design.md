# Write Trace Consumers Design

Status: approved for implementation by the current project direction on 2026-05-31.

## Goal

Turn durable `write-trace.jsonl` from a passive audit file into an actively consumed surface:

- include relevant write traces in role-process context bundles
- expose filtered write traces through the Bun API
- render selected-step write traces in the current Bun UI

This moves HOPI closer to the long-term design where durable traces help explain and steer autonomous work without becoming workflow truth.

## Scope

This slice covers:

- filtered `write-trace` reads
- context assembly that references recent write-trace entries
- API surfacing for Goal write traces
- UI surfacing for run/step-specific write traces

This slice intentionally excludes:

- vendor-specific prompt compilers
- file-content retrieval from changed paths
- full session transcript consumption
- a new database layer for traces

## Trace Query Model

The write-trace store should support filtered reads by:

- `taskRef`
- `runId`
- `stepId`
- `role`
- `limit`

Filtered reads stay Goal-scoped and return newest entries first.

## Context Assembly

`context.md` should include a `Relevant Write Traces` section when matching trace entries exist.

Selection rules:

- same Goal only
- prefer entries from the same `runId`
- also include earlier entries for the same `taskRef`
- exclude the current `stepId`
- newest first
- keep the section compact

Each context summary should include:

- timestamp
- role
- result summary
- changed paths

This makes reviewer and merger steps aware of prior generator writes, and helps retry attempts carry compact durable file-change context.

## API Surface

Add:

```text
GET /api/goals/:goalKey/write-traces
```

Optional query parameters:

- `taskRef`
- `runId`
- `stepId`
- `role`
- `limit`

Response shape:

```json
{
  "goalKey": "example",
  "entries": [...]
}
```

The API returns filtered durable docs traces. It does not mutate runtime state.

## UI Surface

The current Bun UI should show write traces for the selected run/step.

Minimal behavior:

- fetch filtered traces for the selected run
- map trace entries to the selected step
- render a compact `Write Trace` block beside existing execution evidence

Each rendered entry should show:

- role
- timestamp
- result summary
- changed paths

## Testing Strategy

Required checks:

- filtered write-trace reads return the correct subset in newest-first order
- role context bundles include relevant earlier write traces
- the API route returns filtered write traces
- selected-step UI code can render write-trace entries without breaking current runtime views

## Non-Goals

- no replay engine based on trace data
- no hidden mutation path from trace data back into workflow truth
- no compatibility layer for deleted schema fields
