# Grouped Answer-Source Reference Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Let one explicit decision answer or planner answer consume one already-merged reusable answer-source group directly.

## Why This Slice Exists

The reusable-source substrate already had:

- `sourceGroupKey` on `answerSources[*]`, which lets more than one reusable source fragment merge into one materialized grouped answer
- known-consumer and leftover inference paths that could consume those grouped reusable answers implicitly

That still left one explicit-authority gap:

- an explicit decision answer or explicit planner answer could still only point at one single-fragment `answerSourceKey`
- if the caller wanted that explicit consumer to reuse the whole grouped answer directly, runtime forced a worse choice:
  - repeat the merged text inline
  - or pretend one single source entry stood for the entire grouped answer

The long-term fix is not another parser shape. It is one stronger explicit reusable-source reference surface.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add another parsed-response store
- do not change what `answerSourceKey` means
- do not let grouped-reference metadata choose a decision/planning consumer by itself
- fail closed when grouped references are unknown or contradictory

## Implemented Scope

### New Explicit Consumer Field

Explicit decision-answer and planner-answer items may now carry:

- `answerSourceGroupKey`

This field means:

- resolve the already-materialized grouped reusable answer for that group key
- use that merged answer text as the explicit answer content for this one consumer

This field now works on:

- direct decision answers
- `record_answers` decision entries
- `resolve_decision`
- follow-through planner answers
- direct planning answers
- workflow-root shared planner answers
- workflow child planner answers

### Separation From `answerSourceKey`

`answerSourceKey` remains the single-fragment reusable-source reference.

`answerSourceGroupKey` is the grouped reusable-source reference.

Runtime now keeps those surfaces separate on purpose:

- `answerSourceKey` does not implicitly widen into a grouped lookup
- `answerSourceGroupKey` does not implicitly match one single source entry

### Fail-Closed Rules

Runtime now rejects:

- unknown `answerSourceGroupKey`
- any explicit answer item that provides both `answerSourceKey` and `answerSourceGroupKey`

That keeps reusable-source reuse deterministic and prevents the same explicit consumer from accidentally naming both the fragment-level and grouped-level authority at once.

### Group Materialization Dependency

`answerSourceGroupKey` only works after reusable `answerSources[*]` have already established the grouped answer through existing `sourceGroupKey` authority.

This slice does **not** change grouped source construction rules:

- `sourceGroupKey` still controls which reusable fragments merge together
- grouped metadata consistency still follows the prior explicit `sourceGroupKey` rules
- consumer selection still comes from the current explicit answer item, not from the group key alone

## Non-Goals

This slice does not:

- add a new raw `sourceResponseFormat`
- let `answerSourceGroupKey` create brand-new groups without `sourceGroupKey`
- let `answerSourceGroupKey` choose a known consumer by implicit matching
- relax fail-closed behavior for grouped reusable-source metadata conflicts

## Verification

- Runtime tests cover direct explicit decision and planner answers that consume grouped reusable answer sources.
- API tests cover grouped reusable-source references through decision surfaces.
- Assistant-run tests cover grouped reusable-source references shared across decision and planner answers.
- Full repo verification passes with `bun run check`.
