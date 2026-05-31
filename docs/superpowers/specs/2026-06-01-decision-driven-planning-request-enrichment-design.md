# Decision-Driven Planning Request Enrichment Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Automatically enrich durable planning follow-through when a visible decision blocker is opened for a planning task, so assistant and API flows do not depend on redundant manual `decisionRefs` and `requestedUpdates` bookkeeping.

## Why This Slice Exists

Recent slices already made planning follow-through durable and enforceable:

- `planning-requests.yml` exists
- requests can carry `decisionRefs`
- requests can carry `requestedUpdates`
- scheduler validates requested-update coverage against durable write traces

But one brittle gap remained:

- assistant could reuse a visible planning task and then open one decision blocker for it
- the linked planning request would stay under-specified unless the assistant also remembered to repeat that same decision lineage in `request_planning`
- direct API decision creation had the same problem

That left one important assistant/planner handoff step too manual for the long-term deterministic core.

## Constraints

- `todo.yml` remains the only workflow truth
- visible decision blockers still live on tasks, not on planning requests
- enrichment should happen only when a decision is explicitly linked to a planning task
- no hidden planning request creation when none exists already

## Implemented Scope

### Shared Enrichment Rule

When `requestGoalDecision` creates or reuses an open decision linked to a planning task, runtime now checks for open planning requests on that same task and enriches them with:

- the linked `decisionKey`
- default requested update targets of `design.md` and `todo.yml` when the request does not already declare any explicit targets

This makes decision-driven planner follow-through durable without creating a second mutation path.

### Assistant And API Coverage

The shared rule applies equally when decision blockers are opened through:

- assistant `request_decision`
- direct `POST /api/goals/:goalKey/decisions`

That keeps both product paths aligned without asking the caller to repeat metadata that runtime can already infer safely.

### Preservation Of Explicit Planning Intent

If a planning request already has explicit `requestedUpdates`, enrichment does not widen them.

Runtime only fills the default `design.md` plus `todo.yml` targets when the request has none yet.

## Non-Goals

- creating new planning requests automatically from decision creation alone
- attaching one decision to unrelated planning tasks
- semantic inference beyond the explicit task link plus the default `design.md` / `todo.yml` planner follow-through rule
- changing engineering-task decision behavior

## Acceptance Criteria

- creating a visible decision blocker for a planning task enriches the linked open planning request with that decision key
- if the linked request has no explicit requested updates yet, runtime defaults it to `design.md` and `todo.yml`
- existing explicit requested updates are preserved without widening
- assistant and direct API decision flows both use the same enrichment rule
