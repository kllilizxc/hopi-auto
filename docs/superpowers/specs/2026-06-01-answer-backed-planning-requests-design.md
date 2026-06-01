# Answer-Backed Planning Requests Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let one user answer create durable planning work even when that answer does not map cleanly to a durable decision topic first.

## Why This Slice Exists

The current system already supports:

- durable decision capture through `record_answer`
- multi-decision answer capture through `record_answers`
- explicit planner follow-through through `planning`, `planning_batch`, and `workflow_batch`

But one important gap remained:

- some user answers should shape durable planning work without becoming durable decision topics
- `request_planning` and `request_planning_batch` could carry decision lineage and requested updates, but not the answer itself
- assistant therefore had to either invent a weak decision topic or bury the answer inside freeform planning descriptions

That left answer-driven planning incomplete whenever the durable truth was really "this answer should guide planning work" rather than "this answer resolves a named decision topic."

## Constraints

- keep `planning-requests.yml` as the durable planner follow-through store
- do not introduce a second answer queue or a new workflow truth file
- preserve `decisionRefs` for real durable decision topics only
- keep grouped planning, planning-task reuse, and scheduler evidence policy unchanged

## Implemented Scope

### Durable Captured Answers On Planning Requests

`planning-requests.yml` now supports:

- `answers`: an ordered deduplicated array of `{ summary, answer }`

These captured answers live directly on the planning requests they justify.

### Shared Assistant And API Surface

The Bun API `POST /api/goals/:goalKey/planning-requests` now accepts `answers`, and Goal assistant now accepts `answers` on:

- `request_planning`
- `request_planning_batch`

For grouped planning, one shared answer bundle is copied onto each request in that grouped follow-through so every visible planning stage carries the same durable answer context.

### Deterministic Reuse And Enrichment

When planning requests are reused or enriched, runtime now merges captured answers with stable order and exact deduplication, just like decision lineage and requested updates.

That means richer later planning requests can add new captured answers without losing earlier durable answer context.

### Planner Context Surfacing

Planner context now renders captured answers alongside:

- linked decisions
- requested durable updates
- related grouped planning requests

This keeps non-decision user answers visible to planner, reviewer, and merger flows without inventing synthetic decision topics.

## Non-Goals

- changing `decisions.yml`
- inferring decision topics automatically from freeform answers
- introducing a separate durable answer store
- replacing decision-backed workflows where a real durable decision topic still exists

## Acceptance Criteria

- a planning request can durably capture one or more explicit user answers without a decision topic
- grouped planning follow-through can carry one shared captured-answer bundle across every request
- reusing or enriching a planning request preserves prior captured answers and adds new ones deterministically
- planner context surfaces captured answers next to decision lineage and requested updates
- assistant and Bun API share the same answer-backed planning-request model
