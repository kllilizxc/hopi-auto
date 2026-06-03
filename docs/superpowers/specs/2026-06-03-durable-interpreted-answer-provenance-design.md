# Durable Interpreted Answer Provenance Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Persist the concrete deterministic interpretation surface that produced the current durable answer, so interpreted decisions and planner answers remain auditable after the immediate mutation response is gone.

## Why This Slice Exists

The previous slice already surfaced one important runtime fact:

- Bun API mutation responses expose `resolvedSourceResponseFormat`
- assistant action results expose the same `resolvedSourceResponseFormat`

That closed the immediate-response gap for `sourceResponseFormat: "auto"` and other interpreted writes.

But one durable authority gap remained:

- resolved decisions in `decisions.yml` still looked the same whether the answer came from a direct literal write or from `question_blocks`, `matching_runs`, `pending_answer_sources`, or another deterministic interpretation surface
- materialized planner-answer rows in `planning-requests.yml` had the same blind spot
- later inspection of durable state therefore lost the concrete interpretation provenance once the original HTTP response or assistant run result was no longer in hand

The authority route should preserve that provenance on the durable rows that now hold the answer truth, instead of forcing later tooling or humans to reconstruct it from history.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a separate provenance log or parsed-reply store
- persist only concrete deterministic formats, never `"auto"`
- reuse shared runtime interpretation resolution instead of recomputing provenance in store, API, or assistant layers
- let later direct answer rewrites clear stale interpreted provenance instead of leaving misleading metadata behind

## Implemented Scope

### Canonical Concrete Format Type

Shared runtime now centralizes the set of concrete interpreted-answer surfaces in one domain type:

- `AnswerCaptureFormat`
- `ANSWER_CAPTURE_FORMATS`

This is the durable provenance vocabulary.

It intentionally excludes:

- `"auto"`

because `"auto"` is only a meta-selection request, not the concrete surface that actually produced the answer.

### Durable Decision Provenance

Resolved durable decisions now support:

- `captureFormat?: AnswerCaptureFormat`

Behavior:

- interpreted decision writes persist the concrete deterministic surface that produced the resolved answer
- direct non-interpreted rewrites clear any previous `captureFormat`
- unresolved decisions do not gain a synthetic capture format

This applies across:

- direct decision resolution
- `record_answer`
- `record_answers`
- assistant decision actions

### Durable Planner-Answer Provenance

Materialized planner-answer rows now support:

- `captureFormat?: AnswerCaptureFormat`

Behavior:

- interpreted planner-answer writes persist the concrete deterministic surface that produced that row
- later direct rewrites of the same durable planner-answer row clear any previous `captureFormat`
- explicit planner slots and inferred planner answers share the same provenance model

This applies across:

- direct planning requests
- planning batches and workflow graphs
- decision follow-through planner answers
- root shared workflow answers when they materialize onto request rows

### Shared Runtime Propagation

Shared answer-interpretation runtime now carries concrete provenance all the way to row materialization instead of dropping it after response shaping.

That means:

- decision materialization hands concrete `captureFormat` through to durable decision resolution
- planning-answer materialization hands concrete `captureFormat` through to durable planner-answer storage
- API and assistant surfaces still expose `resolvedSourceResponseFormat`, but now that immediate-response evidence matches durable row metadata instead of being the only place it exists

## Testing and Audit Semantics

Two testing layers now intentionally diverge:

- provenance-specific tests assert raw store state, including `captureFormat`
- broad behavior tests may strip answer-level `captureFormat` when they are only asserting durable answer content, workflow shape, or blocker behavior

That keeps the durable provenance surface explicit without turning every older planning readback test into metadata churn.

## Example

If one planning request materializes:

- `Pilot scope`
- from `sourceResponseFormat: "matching_runs"`

then:

- the immediate mutation response may expose `resolvedSourceResponseFormat: "matching_runs"`
- the durable planner-answer row now also persists `captureFormat: "matching_runs"`

If that same planner-answer row is later rewritten through a direct literal answer payload with no interpreted shared reply, runtime clears `captureFormat` on that row.

The same pattern applies to resolved durable decisions.

## Non-Goals

- persisting rejected `auto` probes
- persisting raw `sourceResponse` bodies as provenance
- adding capture provenance to unanswered planning slots or unresolved decisions
- changing how interpretation surfaces match or win

## Acceptance Criteria

- resolved decisions can durably persist the concrete interpreted-answer format as `captureFormat`
- planner-answer rows can durably persist the concrete interpreted-answer format as `captureFormat`
- later direct rewrites clear stale interpreted provenance
- shared runtime remains the single source of truth for the concrete format
- API and assistant immediate-response metadata stays aligned with the durable row-level provenance
