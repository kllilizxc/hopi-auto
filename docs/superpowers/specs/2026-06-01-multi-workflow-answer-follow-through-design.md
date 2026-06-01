# Multi-Workflow Answer Follow-Through Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let one durable decision answer fan out into more than one independent visible planner workflow without introducing any new durable workflow store beyond `decisions.yml` and `planning-requests.yml`.

## Why This Slice Exists

The current system already supports:

- explicit decision resolution with one `planning` follow-through
- explicit decision resolution with one grouped `planning_batch` follow-through
- answer-first durable decision capture through `record_answer`

But one important gap remained:

- one answer could still only open one planner workflow atomically
- assistant had to manually split one answer into several separate planning actions when that answer should open multiple independent planner workflows
- grouped planning could model several dependent tasks inside one workflow, but it could not represent several independent workflows under one answer cleanly

That left answer-driven planning too narrow whenever one answer needed to reshape Goal docs and task decomposition through separate durable planner workflows.

## Constraints

- keep `decisions.yml` as the durable answer truth
- keep `planning-requests.yml` as the only durable planner follow-through store
- do not introduce a hidden answer queue or second workflow truth
- preserve current `planning` and `planning_batch` semantics
- preserve current engineering-blocker rewiring and planning-surface reuse behavior

## Implemented Scope

### Higher-Order `workflow_batch`

`followThrough` on `resolve_decision`, `record_answer`, and the Bun API answer/resolve routes now accepts a third shape:

- `workflow_batch`: a non-empty ordered array of child workflows

Each child workflow must still be one of the existing leaf shapes:

- `planning`
- `planning_batch`

This keeps the durable model flat:

- one answer still resolves one durable decision topic
- each child workflow still creates or reuses only normal planning requests and visible planning tasks

### Deterministic Fan-Out

Runtime materializes child workflows in order and injects the resolved decision lineage into every created or reused planning request automatically.

If several child workflows are created, the result surfaces:

- all request keys
- all task refs
- all grouped workflow keys
- the union of current blocker sink task refs

That gives engineering one deterministic blocker set when the answer fans out into several independent planner workflows.

### Planning-Surface Reuse Stays Single

If the resolved decision already points at one reusable planning surface, runtime only reuses it for the first child workflow in `workflow_batch`.

Later child workflows create or reuse their own normal planning surfaces through the existing planning-request logic.

This keeps reuse deterministic and avoids silently mutating more than one preexisting planning task from one answer.

### Engineering Blockers Wait For Every Workflow

When the answered decision was blocking engineering work, runtime now rewires that engineering work onto the union of all current sink task refs across every child workflow.

Examples:

- one explicit `planning` child blocks engineering on that planning task
- one grouped child blocks engineering on the current grouped sink tasks
- one `workflow_batch` with several children blocks engineering on every child workflow sink

That preserves the rule that engineering should not resume until every explicit durable planner workflow justified by the answer is complete.

## Non-Goals

- answers that do not map cleanly to any single durable decision topic
- automatic semantic inference from arbitrary freeform user messages
- changing the default generic single-workflow bridge when no explicit follow-through is supplied
- creating hidden planner work outside visible planning tasks and `planning-requests.yml`

## Acceptance Criteria

- one answered decision can create more than one planner workflow atomically
- each child workflow still uses the existing `planning` or `planning_batch` durable paths
- engineering blockers rewire onto the union of all current workflow sinks
- planning-linked decision resolution can reuse the current planning task as the first child workflow
- assistant and Bun API share the same `workflow_batch` answer model
