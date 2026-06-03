# Durable Answer Authority Metadata Inspection Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Surface persisted answer-matching authority metadata during inspection, so durable decisions and planner answers no longer appear as prompt-plus-text only once the system has already stored stronger matching anchors.

## Why This Slice Exists

The provenance slices already made interpreted answers durable and inspectable:

- concrete interpreted surfaces persist as `captureFormat`
- planner context and Bun inspection surfaces now show that persisted provenance

But another authority gap still remained:

- durable decisions can already persist `summaryKey` and `matchHints`
- durable planner answers can already persist `summaryKey`, `answerKey`, and `matchHints`
- those fields already participate in later matching authority
- yet planner context and Bun inspection mostly flattened answers down to visible prompt plus answer text

That meant humans could inspect:

- what answer text exists
- sometimes what prompt it came from
- sometimes which interpretation surface produced it

but still not inspect the full durable matching authority that later answer interpretation actually relies on.

The authority route should expose those stable keys and hints on the same read surfaces that already expose the durable answers themselves.

## Constraints

- reuse existing durable fields; do not invent a new authority alias layer
- do not recompute keys or hints from answer text in inspection layers
- keep UI and planner-context rendering aligned around the same stored metadata
- keep raw API payloads unchanged except for existing readback tests that lock the contract in

## Implemented Scope

### Planner Context

Planner context now surfaces durable answer authority metadata in human-readable parsed sections:

- parsed decisions now show:
  - `summaryKey`
  - `matchHints`
  - `captureFormat`
- captured planner answers and workflow-shared answers now show:
  - `summaryKey`
  - `answerKey`
  - `matchHints`
  - `captureFormat`

This applies to:

- relevant open planning requests for the current planning task
- related planning-group sibling requests

### Bun Decision Inspection

Bun decision cards now surface:

- `Summary key`
- `Match hints`
- `Answer capture format`

when those durable fields are present.

### Bun Planning Request And Workflow Inspection

Bun planning request summaries and workflow summaries now keep one compact view of durable planner-answer authority:

- `summaryKey`
- `answerKey`
- `matchHints`
- `captureFormat`

for:

- request-level captured answers
- workflow-root shared answers

The goal is not a new UI panel; it is to make the already-persisted authority visible wherever the durable answer summary is already shown.

### API Readback Coverage

This slice also locks the readback contract in with server tests on:

- decision inspection after interpreted durable decision capture
- planning-request inspection after interpreted durable planner-answer capture
- workflow graph inspection after interpreted workflow-shared answer capture

So later refactors cannot quietly drop those stored authority fields from list/detail responses while still leaving the raw files correct.

## Example

If one durable planner answer row stores:

- `summary: "Pilot scope"`
- `summaryKey: "pilot-scope"`
- `answerKey: "pilot-scope"`
- `matchHints: ["launch cohort"]`
- `captureFormat: "question_blocks"`

then after this slice:

- planner context shows all four authority anchors next to the materialized answer
- planning-request inspection shows the same metadata in the captured-answer summary
- workflow inspection shows the same metadata when that answer is shared at workflow root

Likewise, a durable decision with:

- `summaryKey: "auth-strategy"`
- `matchHints: ["login path"]`

now exposes those fields directly in decision inspection and parsed planner context.

## Non-Goals

- changing how `summaryKey`, `answerKey`, or `matchHints` are generated
- inventing humanized aliases beyond the stored values
- widening parser behavior
- adding a dedicated metadata-only endpoint

## Acceptance Criteria

- planner context exposes durable decision `summaryKey` and `matchHints`
- planner context exposes durable planner-answer `summaryKey`, `answerKey`, `matchHints`, and `captureFormat`
- Bun decision inspection exposes stored decision matching authority
- Bun planning request and workflow inspection exposes stored planner-answer matching authority
- server readback tests prove those authority fields remain visible through list/detail inspection
