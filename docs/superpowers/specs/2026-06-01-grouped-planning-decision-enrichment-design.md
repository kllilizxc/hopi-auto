# Grouped Planning Decision Enrichment Design

Status: approved and implemented
Date: 2026-06-01

## Goal

When a visible decision blocker is opened for one planning task inside a grouped planning follow-through, enrich the other open requests in that same planning group with the same decision lineage.

## Why This Slice Exists

The current system already supports:

- optional planning-request `groupKey`
- grouped planning follow-through across more than one visible planning task
- decision enrichment for the current planning task when `request_decision` targets it
- grouped planner context that can show sibling open requests

But one real gap remained:

- if a new decision was discovered after grouped planning work already existed
- and assistant or API opened that decision on one planning task
- only that one request gained the decision lineage
- sibling requests in the same grouped follow-through still looked unrelated

That left grouped coordination too dependent on assistant remembering to manually duplicate `decisionRefs`.

## Constraints

- blockers remain explicit on visible tasks, not hidden group state
- this slice should enrich metadata, not automatically fan out visible decision blockers to every task
- no new durable workflow store
- default requested-update behavior remains conservative

## Implemented Scope

### Group-Aware Planning Request Enrichment

When `requestGoalDecision` links an open decision to a planning task, runtime now:

1. enriches open planning requests on that task
2. checks whether those requests belong to an open planning group
3. enriches the other open requests in that same group with the same decision key

This keeps grouped planning follow-through durably coordinated without changing which task is visibly blocked.

### Default Requested Updates

If a grouped sibling request has no explicit `requestedUpdates`, group-aware enrichment applies the same conservative default as the existing single-task path:

- `design.md`
- `todo.yml`

Explicit requested updates are still preserved unchanged.

### Planner Context Visibility

Grouped sibling requests already appear in planner context. After this slice, that grouped view now carries the same decision lineage as the request that was directly blocked, so planner sees one coordinated durable story.

## Non-Goals

- adding decision blockers to every task in the group
- resolving grouped decisions automatically across all sibling tasks
- inferring that unrelated planning requests should share a decision
- adding a second decision grouping file

## Acceptance Criteria

- requesting a decision on one grouped planning task enriches the current request and its grouped siblings with the same decision key
- explicit requested updates on grouped siblings remain unchanged
- grouped siblings with no requested updates receive the existing conservative default
- planner context can show the grouped sibling decision lineage after enrichment
