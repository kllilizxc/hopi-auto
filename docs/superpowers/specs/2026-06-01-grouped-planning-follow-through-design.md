# Grouped Planning Follow-Through Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Add a deterministic control path for planning follow-through that spans more than one visible planning task.

## Why This Slice Exists

The current system already supports:

- file-native `planning-requests.yml`
- one durable planning request mapped to one visible planning task
- explicit `requestedUpdates`
- decision lineage
- planner/reviewer/merger evidence policy
- assistant `request_planning` for one visible planning task at a time

But one important gap remained:

- richer follow-through can legitimately require multiple visible planning tasks
- the assistant could emit multiple separate `request_planning` actions, but those requests were ungrouped
- planner context could not see sibling planning work as one coordinated follow-through
- there was no constrained assistant action for creating or reusing a multi-task planning split deterministically

That made multi-task planning workflows too implicit for the current Bun-first deterministic core.

## Constraints

- `todo.yml` remains the only workflow truth
- grouped follow-through must reuse existing planning requests when possible
- no hidden queue or secondary planning state store
- planner tasks remain normal visible tasks; grouping is metadata, not a new task kind
- this slice should not require compatibility work for old prototype flows

## Implemented Scope

### Optional `groupKey` On Planning Requests

Planning requests now support an optional stable `groupKey`.

Requests sharing a `groupKey` are treated as one coordinated planning follow-through that spans multiple visible planning tasks.

This metadata is available through the active product path:

- durable `planning-requests.yml`
- Bun API planning-request creation
- Bun UI planning-request creation and inspection
- assistant actions

### Shared Assistant Batch Action

The Goal assistant now supports `request_planning_batch`.

This action creates or reuses multiple visible planning requests/tasks in one constrained durable step. Each batch:

- carries one stable `groupKey`
- can share decision lineage across the whole batch
- can assign explicit `requestedUpdates` per entry
- can declare intra-batch task dependencies through stable local task keys

This keeps multi-task planning work deterministic without forcing the assistant to guess runtime task refs ahead of time.

### Planner Context Group Visibility

When a planning task belongs to a grouped follow-through, planner context now surfaces:

- the current request’s `groupKey`
- the other open requests in the same group
- their visible task refs and requested updates

This gives planner the durable coordination picture needed for deeper multi-task follow-through.

## Reuse And Conflict Rules

- If an existing open planning request is reused and it has no `groupKey`, an incoming `groupKey` may fill it in.
- If an existing open planning request already has the same `groupKey`, reuse proceeds normally.
- If an existing open planning request already has a different `groupKey`, runtime rejects the conflicting reuse instead of silently reinterpreting visible work.

## Non-Goals

- adding a new workflow truth file for planning groups
- changing scheduler semantics so one planning task completion resolves an entire multi-task group
- automatic engineering blocker fan-out to every planning task in a group
- introducing batch creation for engineering tasks

## Acceptance Criteria

- planning requests can optionally persist a stable `groupKey`
- assistant can request a grouped multi-task planning split in one constrained action
- intra-batch local dependencies are resolved into visible task blockers deterministically
- planner context can inspect sibling open requests from the same group
- conflicting grouped reuse is rejected instead of silently mutating visible work
