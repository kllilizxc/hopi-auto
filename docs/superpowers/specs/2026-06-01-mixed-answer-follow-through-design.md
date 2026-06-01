# Mixed Answer Follow-Through Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let one durable decision-answer action atomically resolve real decision topics while also capturing other non-decision user answers directly on durable planning follow-through.

## Why This Slice Exists

The current system already supports:

- durable decision answers through `record_answer`, `record_answers`, and `resolve_decision`
- non-decision captured answers on direct `request_planning` and `request_planning_batch`
- shared planner follow-through through `planning`, `planning_batch`, and `workflow_batch`

But one important gap remained:

- a single user reply could contain both real decision answers and other durable planning answers
- assistant had to split that into a decision-answer action plus a second planning action
- that split lost atomicity and made the answer bundle harder to review as one durable follow-through move

That left mixed answer workflows incomplete even after decision-backed answers and answer-backed planning requests both existed independently.

## Constraints

- keep `decisions.yml` as the durable truth for real decision topics
- keep `planning-requests.yml` as the durable truth for planner follow-through and captured non-decision answers
- do not add a new mixed-answer store or wrapper workflow truth
- preserve existing `record_answer`, `record_answers`, `resolve_decision`, `planning`, `planning_batch`, and `workflow_batch` semantics

## Implemented Scope

### Captured Answers On Follow-Through Leafs

Decision-answer follow-through leaf shapes now support:

- `answers`: an ordered deduplicated array of `{ summary, answer }`

This is available on:

- `planning`
- `planning_batch`
- `workflow_batch` children through those same leaf shapes

### Shared Assistant And API Surface

The same `answers` payload is now accepted on follow-through carried by:

- assistant `record_answer`
- assistant `record_answers`
- assistant `resolve_decision`
- Bun API decision answer/resolve routes that already accept explicit follow-through

This keeps mixed answer workflows on the existing durable answer surfaces instead of creating a new action family.

### Atomic Durable Merge

When a decision-answer action materializes follow-through, runtime now writes:

- resolved decision topics into `decisionRefs`
- non-decision captured answers into `answers`

on the same planning requests in one atomic runtime move.

For grouped follow-through, the shared captured-answer bundle is copied onto each request in that grouped workflow.

### Workflow Fan-Out Still Works

Because `workflow_batch` is still just an ordered list of leaf workflows, each child can now also carry its own captured non-decision answers without changing the durable workflow model.

## Non-Goals

- changing `decisions.yml`
- inventing synthetic decision topics for non-decision answers
- introducing a new mixed-answer queue or answer bundle store
- automatic semantic inference of which reply fragments should become decision topics

## Acceptance Criteria

- one decision-answer action can resolve one or more durable decision topics and also carry non-decision captured answers on the same planner follow-through
- created or reused planning requests preserve both `decisionRefs` and captured `answers`
- grouped mixed follow-through copies the shared captured-answer bundle across every request in the group
- assistant and Bun API share the same mixed-answer follow-through model
- no new durable workflow truth is introduced
