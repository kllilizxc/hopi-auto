# Assistant Planning Result Creation Authority

## Problem

Assistant planning actions already resolve structured creation metadata inside shared planning runtime results:

- `request_planning` knows whether the planning request was newly created and whether it also created a new planning task
- `request_planning_batch` knows exactly which request keys and task refs were created during this call
- `request_planning_workflows` knows the same top-level created request keys and created task refs across the workflow graph

But assistant-facing `action_result` payloads were still collapsing that state into summary text plus stable ids. That made assistant run detail, assistant thread inspection, and bundled assistant context lose the durable “what was created by this mutation” authority.

## Decision

Extend assistant planning `action_result` surfaces with the creation metadata that runtime already knows:

- `request_planning`
  - `created: boolean`
  - `taskCreated: boolean`
- `request_planning_batch`
  - `createdRequestKeys: string[]`
  - `createdTaskRefs: string[]`
- `request_planning_workflows`
  - `createdRequestKeys: string[]`
  - `createdTaskRefs: string[]`

These fields must be:

1. returned by `GoalAssistantRuntime.applyAssistantAction(...)`
2. accepted by `assistantActionResultSchema`
3. preserved through assistant run and assistant thread persistence
4. surfaced by shared assistant action-result presentation helpers

## Scope Boundaries

This slice only upgrades top-level assistant planning result creation authority.

It does not:

- change shared planning runtime semantics
- change direct planning API semantics
- add new creation metadata for decision results beyond what already exists
- surface child-level workflow creation metadata inside each workflow leaf result

## Expected Inspection Behavior

Inspection surfaces should be able to answer:

- did this assistant `request_planning` create a new request?
- did it also create a new planning task?
- which request keys and task refs were newly created by this grouped planning mutation?

without inferring those answers from free-text summaries.

## Verification

Lock the slice with:

- formatter-level assertions for `request_planning`, `request_planning_batch`, and `request_planning_workflows`
- assistant-run integration assertions for top-level response payloads
- assistant thread / assistant run readback assertions proving the new metadata survives durable persistence
- recent assistant-thread context assertions proving the new metadata reaches inspection surfaces
