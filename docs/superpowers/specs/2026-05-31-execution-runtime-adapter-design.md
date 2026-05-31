# Execution Runtime Adapter Design

Status: approved for implementation by the current project direction on 2026-05-31.

## Goal

Evolve the current runner boundary from a single final outcome callback into a real execution-runtime adapter contract that can stream structured runtime events, attach worktree and artifact evidence to a step, and remain simple enough to keep the deterministic scheduler in control.

## Scope

This slice covers:

- a typed event-streaming adapter contract for planner / generator / reviewer / merger runtimes
- richer step execution evidence in runtime history
- scheduler integration that records adapter events while preserving deterministic workflow control
- a scripted mock adapter that exercises the new contract in tests

This slice does not cover:

- real LLM process integration
- real git worktree creation or merge execution
- assistant chat plumbing
- pagination for long transcripts

## Design Principles

- The scheduler remains the control plane. Adapters report evidence; they do not mutate workflow truth.
- Runtime history stays overlay state. `todo.yml` and `events.jsonl` remain the durable workflow source.
- The adapter contract must be useful for a future real process runner without forcing the scheduler to understand transport details.
- Worktree and artifact evidence should be stored structurally, not only flattened into free-form text.

## Adapter Contract

The current `AgentRunner.run(input) -> AgentOutcome` shape is too thin for the next phases because it cannot surface:

- progress messages
- worktree preparation details
- artifact references
- intermediate runtime failures that are still part of the same step

The new contract should add:

- execution identifiers from the scheduler (`runId`, `stepId`)
- an event sink callback
- a scripted mock implementation for tests

## Runtime Events

Typed adapter events for this slice:

- `message`
  - human-readable runtime text with level `info` or `error`
- `worktree_prepared`
  - worktree path and optional branch metadata
- `artifact`
  - artifact reference plus a short label

The scheduler writes these into runtime history as they arrive.

## Run History Changes

Each step should keep:

- ordered messages
- optional worktree metadata
- artifact references emitted during that step

This keeps the UI and future diagnostics useful without storing a full raw transcript format yet.

## Scheduler Integration

Execution order remains:

1. choose dispatchable task
2. persist `in_progress`
3. start run-history step
4. call adapter with event sink
5. persist final workflow status
6. close the step and run as before

Adapter events may enrich step evidence but must not alter the workflow transition table.

## Mock Adapter

The mock adapter should become a scripted runtime adapter, not just a final-outcome stub.

Each scripted entry may contain:

- zero or more runtime events
- one final outcome

This lets tests cover realistic streaming behavior before real agents are introduced.

## UI Impact

The current UI may continue to show messages only, but it should also surface step evidence when present:

- worktree path
- artifact references

This keeps the UI aligned with the long-term runtime workbench direction instead of freezing it at plain-text messages only.

## Non-Goals

- no raw stdout/stderr replay protocol
- no long-lived session transport
- no DB introduction
- no compatibility layer for the old session API
