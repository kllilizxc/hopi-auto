# Assistant Run Action Authority Inspection

Status: implemented
Date: 2026-06-03

## Goal

Make Bun assistant-run detail inspection show the same structured assistant action authority that already exists in durable run records, instead of only surfacing `action_result` rows and forcing readers to open raw `result.json` to understand the requested mutation shape.

## Gap

Assistant run records already persisted:

- `actions`
- `actionResults`
- runtime events
- bundle files

But Bun run detail inspection only rendered `actionResults`. That meant durable requested mutation authority like:

- reusable answer-source counts
- inferred-answer flags
- workflow reuse metadata
- linked decision refs
- grouped/shared planner-answer counts

was technically present in the run record but still hidden behind raw JSON.

## Design

Introduce one shared structured action presentation surface and reuse it in Bun run detail inspection:

- extract a shared assistant-action summarizer from runtime-only code
- let the run-detail UI render an `Actions` section before `Action Results`
- keep action body/detail formatting on the same shared inspection helper already used by thread/context inspection, so run detail does not invent a second read-side authority

This slice is read-only:

- no new mutation semantics
- no new durable store
- no transformation beyond exposing already-persisted structured action authority

## Verification

- targeted shared helper tests cover structured assistant action presentation
- assistant-run API regression confirms full structured `actions` remain visible on run detail readback
- typecheck, lint, and targeted backend tests pass before commit
