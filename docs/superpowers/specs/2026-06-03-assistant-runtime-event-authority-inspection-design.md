# Assistant Runtime-Event Authority Inspection

Status: implemented
Date: 2026-06-03

## Goal

Expose the richer durable metadata already present on assistant runtime events, instead of flattening transcript/worktree/artifact/message events down to a single summary line in Bun assistant-run detail inspection.

## Gap

Assistant run records already persisted structured runtime events with fields like:

- `toolName`
- `toolInvocationKey`
- `vendorEventType`
- worktree `branch` / `baseBranch`
- artifact `label` / `ref`
- message `level`

But Bun assistant-run detail inspection rendered runtime events with only one summary string. The durable event authority existed in the payload, yet readers still had to open raw run JSON to inspect concrete event metadata.

## Design

Introduce one shared assistant runtime-event presentation helper and route Bun assistant-run detail through it:

- transcript events surface tool name, invocation key, and vendor event type
- worktree events surface branch and base-branch metadata
- artifact events surface label/ref detail
- message events surface level when present

This slice is inspection-only:

- no mutation semantics change
- no new event schema
- no new durable store
- only fuller surfacing of already-persisted runtime-event authority

## Verification

- shared runtime-event presentation tests cover transcript and worktree event details
- targeted backend typecheck/lint and shared inspection tests pass before commit
