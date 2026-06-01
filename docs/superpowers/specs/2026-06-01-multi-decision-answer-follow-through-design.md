# Multi-Decision Answer Follow-Through Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let one user answer resolve more than one durable decision topic and route those resolved topics through one shared visible planner follow-through without introducing any new durable workflow store.

## Why This Slice Exists

The current system already supports:

- one durable answer captured through `record_answer`
- explicit decision resolution through `resolve_decision`
- one answer fanning out into several planner workflows through `workflow_batch`

But one important gap remained:

- a user answer could still only map cleanly to one durable decision topic at a time
- if one answer resolved several durable decision topics, assistant had to split that into several separate answer actions
- shared planner follow-through for several resolved decisions had to be reconstructed manually after those separate actions

That left answer-driven planning too narrow when the durable truth was really a bundle of resolved decisions, not one decision topic with several workflows.

## Constraints

- keep `decisions.yml` as the durable answer truth
- keep `planning-requests.yml` as the only durable planner follow-through store
- do not add a hidden answer queue or second workflow truth
- preserve current single-decision answer and resolution behavior
- keep the planner follow-through model grounded in existing `planning` / `planning_batch` / `workflow_batch` shapes

## Implemented Scope

### `record_answers` and Batched API Answers

Goal assistant now supports `record_answers`, and the Bun API now supports `POST /api/goals/:goalKey/decisions/answers`.

Each batch entry can:

- reuse an existing durable decision topic through `decisionKey`
- create a missing durable decision topic when `decisionKey` is absent or new
- record one explicit answer for that topic

The batch resolves every entry first, then routes one shared planner follow-through using the resolved decision set.

### Shared Decision Lineage

When a batched answer opens or reuses planner follow-through, runtime injects every resolved decision key into the created or reused planning requests automatically.

That means one planning request can now carry:

- one decision ref from single-answer flows
- several decision refs from multi-decision answer bundles

without introducing a new answer lineage field outside `decisionRefs`.

### Deterministic Blocker Rewiring

If engineering work was blocked by one or more decisions in the batch, runtime removes all of those decision blockers and rewires engineering onto the sink tasks of the shared follow-through.

For grouped follow-through this still means:

- engineering waits on the current grouped sink tasks
- planning prerequisites remain visible through task blockers

### Reuse Rules Stay Narrow

If exactly one open planning task is linked across the resolved decision batch, explicit follow-through may reuse that planning surface.

If more than one linked planning task exists, runtime does not guess which one to reuse.

That keeps multi-decision answer bundles deterministic instead of silently mutating several visible planning surfaces at once.

## Non-Goals

- answers that do not map cleanly to any durable decision topic at all
- semantic inference from arbitrary freeform user messages
- introducing a new durable store for answer bundles
- changing the existing planner follow-through request stores or grouped task-key model

## Acceptance Criteria

- one answer batch can resolve several durable decision topics atomically
- shared planner follow-through automatically receives the full resolved decision lineage
- engineering blockers tied to those resolved decisions rewire onto the shared follow-through sinks
- explicit follow-through can reuse one linked planning surface when the resolved batch has exactly one reusable planning task
- assistant and Bun API share the same multi-decision answer model
