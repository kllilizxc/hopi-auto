# Grouped Planning Blocker Propagation Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Keep engineering work blocked on the current open leaves of a grouped planning follow-through until that grouped planning work is actually complete.

## Why This Slice Exists

The current system already supports:

- visible planner follow-through when a resolved decision unblocks engineering
- grouped planning requests through stable `groupKey`
- later grouped extension through durable `groupTaskKey`
- explicit visible task blockers between grouped planning tasks

But one important coordination gap remained:

- decision resolution initially rewired engineering onto one visible planning task
- later grouped planning could upgrade or extend that follow-through into more planning siblings
- engineering stayed blocked on the original planning task instead of the group's current open leaves
- once that original task reached `done`, scheduler cleanup could remove the blocker and resume engineering too early

That breaks the long-term rule that planner follow-through must finish before engineering continues.

## Constraints

- `todo.yml` remains the only workflow truth
- grouped coordination must stay visible through current task blockers
- do not add a hidden planning-group state store
- do not fan engineering out to every task in a planning group
- do not add compatibility behavior for deleted prototype concepts

## Implemented Scope

### Current Open Sink Rule

If an engineering task is blocked by any planning task that belongs to a grouped planning follow-through, runtime now treats that engineering task as waiting on the group's current open sink tasks.

An open sink task is an open grouped planning task that is not a prerequisite of another open grouped planning task in the same group.

This means:

- a linear chain blocks engineering on the current tail
- a branching group blocks engineering on each current open branch leaf
- completed or superseded internal grouped tasks do not keep stale external blockers

### Runtime Synchronization

Runtime now re-synchronizes grouped planning blockers when:

- grouped planning requests are created, reused, upgraded, or extended
- scheduler cleanup encounters completed grouped planning tasks

Synchronization removes stale blockers to grouped planning siblings and replaces them with the current open sink blockers for that same group.

If the group has no remaining open tasks, synchronization removes the grouped planning blockers entirely.

### Deterministic Visible Semantics

The propagation rule is derived only from:

- visible `todo.yml` task blockers
- durable grouped planning metadata in `planning-requests.yml`

There is no hidden resume queue, no historical blocker memory, and no second group-coordination store.

## Non-Goals

- blocking engineering on every task in a planning group
- inventing a new blocker kind or hidden follow-through marker
- changing how one planning task resolves its own planning request
- inferring grouped coordination across unrelated planning requests

## Acceptance Criteria

- extending a grouped planning follow-through retargets blocked engineering work onto the current open grouped leaf tasks
- completing an earlier grouped planning task does not unblock engineering while later grouped leaves remain open
- branching grouped planning can block engineering on multiple current open leaves
- grouped blocker propagation remains fully derivable from visible board state plus durable grouped planning metadata
