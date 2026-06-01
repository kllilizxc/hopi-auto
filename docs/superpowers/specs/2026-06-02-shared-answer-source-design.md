# Shared Answer Source Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured raw user reply be captured once and reused across multiple durable decision topics plus non-decision planner answers, instead of forcing assistant or API callers to repeat the same answer payload on every interpreted entry.

## Why This Slice Exists

The prior answer-driven workflow slices already allowed:

- one answer to resolve one or more durable decision topics
- one answer to create grouped or multi-workflow planner follow-through
- mixed decision plus non-decision captured answers on the same follow-through

But one authority gap still remained:

- when a single raw user reply shaped more than one decision topic and one or more planner answers, callers had to repeat that same answer text on every `record_answer`, `record_answers`, or `followThrough.answers` entry
- this made less-structured replies noisy to encode and easy to drift apart across duplicated payloads
- it also forced assistant to spend action budget restating the same answer text instead of only naming the durable topics it had already inferred

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second raw-response store or separate answer overlay
- preserve the current explicit per-item `answer` path for callers that want topic-specific extracted text
- keep invalid interpretation payloads deterministic and reject them clearly

## Implemented Scope

### Shared `sourceResponse` On Answer-Driven Surfaces

Answer-driven Bun API and assistant actions now support optional root `sourceResponse` on:

- `resolve_decision`
- `record_answer`
- `record_answers`

When a decision answer entry omits its own `answer`, runtime now reuses the shared `sourceResponse`.

### Shared `sourceResponse` Across Follow-Through Answers

The same root `sourceResponse` also applies to answer-driven follow-through payloads.

Inside:

- `planning`
- `planning_batch`
- `workflow_batch`

any follow-through answer entry may now omit its own `answer` and inherit the same shared raw reply.

This lets one interpreted action say:

- which durable decision topics the raw reply resolves
- which non-decision planner-answer summaries should stay on follow-through

without repeating the same raw text in every slot.

### Deterministic Materialization

Runtime now materializes omitted per-item answers before touching the existing decision or planning helpers.

If neither:

- the item-specific `answer`
- nor the root `sourceResponse`

is present, the request fails deterministically as an invalid interpretation payload instead of becoming a system error or silently storing partial truth.

## Non-Goals

- automatic NLP extraction of topic-specific answer snippets from one raw reply
- inferring decision topics without the assistant naming them
- storing a second durable raw-response registry beside existing decision and planning truth
- replacing explicit per-item `answer` when callers intentionally want concise extracted text

## Acceptance Criteria

- answer-driven Bun API routes can reuse one root `sourceResponse` across more than one decision answer and more than one follow-through answer
- assistant `record_answer`, `record_answers`, and `resolve_decision` actions can do the same
- omitted per-item answers materialize deterministically from the shared raw response
- missing both per-item `answer` and root `sourceResponse` fails as invalid interpretation input rather than a system error
