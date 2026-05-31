# Decision Resolution Follow-Through And Reconcile Controls Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Close the next planner-request follow-through gap by making resolved decisions unblock visible work immediately and by exposing an explicit Bun UI control for one deterministic scheduler step.

## Why This Slice Exists

The prior slices already added:

- assistant decision requests
- manual decision creation and resolution
- visible decision blocker linking on planning work

But one important hole remained:

- resolving a decision only changed `decisions.yml`
- the linked task still kept its board blocker until a later reconcile cleanup pass
- the active Bun UI still had no direct control for running one explicit scheduler step

That meant the product path still had avoidable dead time after a decision answer.

## Constraints

- `todo.yml` remains the only workflow truth
- the single-step scheduler contract stays explicit
- no hidden background queue is introduced
- decision control continues to use the local-doc board writer path

## Implemented Scope

### Shared Decision Resolution Control Path

Add a shared helper that resolves a decision and removes all visible `blockedBy.kind=decision` refs that point at that `decisionKey`.

This preserves a deterministic file-native path while avoiding a wasted cleanup-only reconcile step for the common product flow.

### API Follow-Through

`POST /api/goals/:goalKey/decisions/:decisionKey/resolve` now:

- resolves the durable decision topic
- removes linked visible board blockers immediately
- broadcasts both decision and board changes when needed

Assistant `resolve_decision` now uses the same control path.

### Explicit Reconcile Control In The Bun UI

The active Bun UI now exposes:

- `Reconcile Once`

This calls the existing single-step reconcile route directly and shows a concise result summary in the board panel.

That keeps scheduler progression explicit while making the product path self-contained.

## Non-Goals

- hidden auto-reconcile after every user action
- multi-step scheduler draining in one click
- generalized workflow automation policy changes

## Acceptance Criteria

- resolving a decision immediately clears linked visible blockers
- assistant and manual decision resolution use the same control path
- one explicit reconcile after decision resolution can advance newly-eligible planning work
- the active Bun UI exposes an explicit one-step reconcile control
- the single-step scheduler contract remains intact
