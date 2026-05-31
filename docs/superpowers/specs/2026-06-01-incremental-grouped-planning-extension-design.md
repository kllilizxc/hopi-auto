# Incremental Grouped Planning Extension Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let grouped planning follow-through be extended deterministically after the first batch already exists.

## Why This Slice Exists

The current system already supports:

- grouped planning requests through stable `groupKey`
- intra-batch dependency wiring through per-entry `taskKey`
- grouped sibling visibility in planner context
- grouped decision-lineage enrichment

But one important coordination gap remained:

- `taskKey` only existed inside one `request_planning_batch` call
- after a planning group already existed, later assistant/runtime work could not refer to one existing sibling by a durable stable key
- extending a group with one more visible planning task meant resubmitting earlier entries just to recover dependency mapping

That kept grouped planning too session-local for a file-native deterministic system.

## Constraints

- keep `planning-requests.yml` as the only durable planning-follow-through metadata file
- do not introduce a second planning-group store
- do not infer hidden blockers or hidden group sequencing
- grouped extension must stay explicit through visible task blockers
- no prototype compatibility work

## Implemented Scope

### Durable `groupTaskKey`

Grouped planning requests now persist an optional durable `groupTaskKey`.

This key is:

- written when a grouped batch entry is created or reused
- stable inside one `groupKey`
- the durable identity later grouped extension can depend on

### Existing-Group Dependency Resolution

`requestGoalPlanningBatch` now resolves `blockedByTaskKeys` against:

1. entries created or reused in the current batch
2. existing open grouped requests in the same `groupKey` that already carry the matching `groupTaskKey`

This lets a later grouped batch add one new visible planning task that depends on earlier grouped work without replaying the whole batch.

### Conflict Rules

Runtime rejects grouped extension when:

- a grouped request is reused under one `groupKey` but a different `groupTaskKey`
- one `groupKey` would end up with two different open requests claiming the same `groupTaskKey`

This preserves deterministic dependency mapping instead of silently reinterpreting visible work.

### Context And Product Visibility

Planner and assistant surfaces now expose `groupTaskKey` for grouped requests so later extension remains inspectable instead of being hidden runtime-only behavior.

## Non-Goals

- auto-generating new grouped tasks from resolved blockers
- resolving or closing an entire planning group as one unit
- cross-group dependency wiring
- new workflow truth outside `planning-requests.yml`

## Acceptance Criteria

- grouped planning requests can persist a stable `groupTaskKey`
- a later grouped batch can add a new task that depends on an earlier grouped sibling without resubmitting that sibling
- conflicting reuse of one grouped task under a different `groupTaskKey` is rejected
- planner/assistant inspection can show the durable grouped task key
