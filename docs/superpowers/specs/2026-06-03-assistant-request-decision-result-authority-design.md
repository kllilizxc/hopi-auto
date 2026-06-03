# Assistant `request_decision` Result Authority

## Problem

Assistant `request_decision` already resolves a structured runtime result from `requestGoalDecision(...)`:

- whether the decision topic was newly created
- whether a blocker was added to the linked task
- what the resulting decision status is

But the assistant-facing `action_result` only persisted:

- `kind`
- `decisionKey`
- `summary`

That made assistant run detail, assistant thread inspection, and bundled assistant context depend on lossy summary text instead of durable result authority.

## Decision

Extend the durable assistant `request_decision` result surface with:

- `created: boolean`
- `blockerAdded: boolean`
- `decisionStatus: "open" | "resolved"`

These fields must be:

1. returned by `GoalAssistantRuntime.applyAssistantAction(...)`
2. accepted by `assistantActionResultSchema`
3. preserved through assistant run persistence and assistant thread persistence
4. surfaced by the shared assistant action-result formatter

## Scope Boundaries

This slice only upgrades assistant `request_decision` result authority.

It does not:

- change direct decision-request API response shapes
- add new runtime behavior to decision creation or blocker linking
- generalize created/reused metadata across unrelated assistant actions

## Expected Inspection Behavior

When an assistant requests a visible decision topic, inspection surfaces should be able to read:

- the durable decision key
- whether the topic was newly created
- whether a task blocker was added
- whether the resulting decision is `open` or `resolved`

without parsing the free-text summary.

## Verification

Lock the slice with:

- a formatter-level assertion that `formatAssistantActionResultDetails(...)` emits the new fields
- an assistant-run integration assertion that `/api/goals/:goalKey/assistant/run` returns the new fields
- a durable thread readback assertion that `assistant-thread.json` preserves the new fields on the `action_result` entry
