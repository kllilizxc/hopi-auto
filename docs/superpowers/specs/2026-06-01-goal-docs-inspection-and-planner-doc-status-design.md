# Goal Docs Inspection And Planner Doc-Status Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Make durable `goal.md` and `design.md` first-class inspectable state on the active Bun product path, and make planner prompts react explicitly to whether those docs are still bootstrapped placeholders.

## Why This Slice Exists

Earlier slices already gave the planner durable Goal docs:

- deterministic bootstrap for `goal.md`
- deterministic bootstrap for `design.md`
- context bundle wiring so planner could read those files

What was still missing was operational visibility and policy:

- the API and Bun UI could not inspect the current Goal docs directly
- there was no deterministic signal for whether a doc was still just the bootstrap template
- planner prompts did not explicitly require durable design follow-through when `design.md` was still placeholder-grade

Without this slice, Goal docs existed, but they were still too invisible to support richer planner/runtime workflows safely.

## Constraints

- Goal docs remain file-native and editable documents, not database rows
- scheduler workflow truth remains `todo.yml`
- doc status should be derived deterministically from file contents, not stored as extra mutable state
- planner policy should be strengthened through prompt/context rules, not hidden orchestration logic

## Implemented Scope

### Deterministic Goal Doc Inspection

`GoalDocsStore` now supports read-side inspection of `goal.md` and `design.md`, including:

- absolute file path
- current file content
- derived status: `bootstrapped` or `curated`

Status is computed by comparing current file contents against the deterministic bootstrap templates for the current Goal.

### Goal Docs API Surface

The Bun API now exposes:

```text
GET /api/goals/:goalKey/docs
```

This returns the current Goal doc snapshot for the active Goal and keeps Goal doc inspection on the same product path as board, runs, decisions, and assistant state.

### Bun UI Surfacing

The active Bun UI now renders:

- `goal.md`
- `design.md`
- a clear status pill for each doc
- a compact summary for whether the Goal docs are still fully bootstrapped or partially/fully curated

This makes durable planning context visible without reintroducing a separate frontend stack.

### Planner Doc-Status Policy

Planner context bundles now include explicit Goal doc status, and planner prompts now enforce durable design follow-through:

- if `design.md` is still bootstrapped, planner should replace placeholder sections before returning success
- when decomposition materially changes, planner should update durable design rationale before concluding planning work

## Non-Goals

- turning Goal docs into workflow truth
- adding a WYSIWYG editor or collaborative editing layer
- automatic synthesis of `design.md` outside the existing planner execution path
- deeper planner follow-through beyond the current doc-status policy slice

## Acceptance Criteria

- `GoalDocsStore` can bootstrap and inspect current Goal docs with deterministic status
- `GET /api/goals/:goalKey/docs` returns Goal doc content plus `bootstrapped` versus `curated` status
- the active Bun UI surfaces Goal doc content and status
- planner prompts explicitly enforce durable `design.md` follow-through when the doc is still bootstrapped or decomposition materially changes
