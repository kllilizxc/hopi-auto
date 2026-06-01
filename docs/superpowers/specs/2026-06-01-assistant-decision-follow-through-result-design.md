# Assistant Decision Follow-Through Result Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Make Goal assistant decision action results surface the same durable follow-through authority that the shared decision runtime already computes, instead of flattening that authority into lossy helper arrays.

## Why This Slice Exists

The current system already supported:

- full shared runtime results for `resolveGoalDecision(...)`, `answerGoalDecision(...)`, and `answerGoalDecisions(...)`
- Bun decision answer/resolve APIs that now return those full runtime results directly
- generated durable `W-*` workflow keys on decision-backed `workflow_batch`

But the Goal assistant product surface still had one weaker path:

- `resolve_decision`, `record_answer`, and `record_answers` action results flattened follow-through into `followThroughGroupKeys`, `followThroughRequestKeys`, and `followThroughTaskRefs`
- those flattened arrays dropped `blockerRemoved`, `created`, `createdDecisionKeys`, workflow child structure, and generated `workflowKey`
- assistant-run responses, persisted run detail, and the Bun UI therefore exposed weaker authority than both the shared runtime and the Bun decision APIs

That created an unnecessary second truth for the same durable decision-follow-through behavior.

## Constraints

- keep the shared decision runtime as the only authority for decision follow-through results
- do not keep parallel flattened assistant-only follow-through summary fields
- preserve assistant summary strings while upgrading the structured result payload
- keep request-planning action results unchanged unless they already reflect the planning runtime directly

## Implemented Scope

### Full Decision Runtime Result Surfacing On Assistant Actions

Goal assistant action results now align directly with the shared decision runtime for:

- `resolve_decision`
- `record_answer`
- `record_answers`

The structured action results now include:

- `blockerRemoved`
- `created` on `record_answer`
- `createdDecisionKeys` on `record_answers`
- full `followThrough`

### Full Follow-Through Shape, Not Summary Arrays

Assistant decision action results now persist the real follow-through structure:

- `planning`
- `planning_batch`
- `workflow_batch`

That means assistant-run inspection can now see:

- `groupKey` and `groupKeys`
- `requestKeys`
- `taskRefs`
- `blockerTaskRefs`
- `workflowKey`
- `workflowTaskKey`
- nested workflow child results on `workflow_batch`

So generated `W-*` workflow identities and workflow-tail blocker semantics remain visible through the assistant surface instead of only through lower-level APIs.

### Bun UI And Server Broadcasts Follow The Same Structure

The Bun product path now consumes the same structured assistant action result:

- `/api/goals/:goalKey/assistant/run` returns it directly
- persisted assistant run detail keeps the same structure
- the Bun UI run-detail view reads and renders the new follow-through metadata
- server-side planning-request broadcasts now detect decision follow-through via `actionResult.followThrough.requestKeys`

## Non-Goals

- changing `request_planning`, `request_planning_batch`, or `request_planning_workflows` result shapes
- inventing a separate assistant-only workflow registry
- changing assistant action input shapes
- replacing human-readable action-result summaries

## Acceptance Criteria

- assistant `resolve_decision` action results include `blockerRemoved` and structured `followThrough`
- assistant `record_answer` action results include `created`, `blockerRemoved`, and structured `followThrough`
- assistant `record_answers` action results include `createdDecisionKeys`, `blockerRemoved`, and structured `followThrough`
- decision-backed assistant workflow results surface generated `W-*` keys when runtime creates them
- persisted assistant run detail and Bun UI inspection consume the same structured assistant action result without assistant-only flattened follow-through arrays
