# Run History And Bun UI Design

Status: approved for implementation by the current project direction on 2026-05-31.

## Goal

Add a minimal runtime history model that lets the product show execution runs, switch between role steps inside a run, and inspect message history for the selected step. Then replace the legacy Vite prototype with a Bun-first UI that reads this model from the Bun backend.

## Scope

This slice intentionally covers only:

- runtime run/step/message history for Phase 1 scheduler activity
- Bun API routes needed to read that history
- a Bun-first read-only UI that shows board state plus run/step history

This slice intentionally excludes:

- real LLM adapters
- real worktree provisioning and merge automation
- DB/runtime services outside `.hopi/runtime/**`
- compatibility layers for the deleted prototype schema or UI

## Runtime History Model

Runtime history remains overlay data. It must not become workflow truth.

Storage location:

```text
.hopi/runtime/goals/<goalKey>/run-history.json
```

The file stores Goal-scoped overlay state:

- ordered runs
- ordered steps inside each run
- ordered messages inside each step

## Core Definitions

### Run

A run represents one task execution attempt that starts when a task leaves `planned` and ends when that attempt reaches one of these boundaries:

- `done`
- a blocker is written
- the task returns to `planned` after rejection, failure, timeout, or merge conflict
- a scheduler system error aborts the attempt

This gives the UI a stable unit to switch between attempts without conflating separate retries.

### Step

A step represents one deterministic scheduler dispatch for a specific role:

- `planner`
- `generator`
- `reviewer`
- `merger`

Each step stores:

- `stepId`
- `role`
- `statusBefore`
- `statusAfter`
- timestamps
- final outcome
- message list

### Message

Messages are ordered runtime records attached to a step. In this phase they are system-authored messages only, such as:

- dispatch started
- runner finished successfully
- reviewer rejected with reason
- merge conflict recorded
- scheduler system error restored the prior task status

The model must allow richer future messages without changing the API shape.

## Storage Boundary

The implementation should use a dedicated store abstraction so the runtime history backing can evolve later without changing scheduler or API code.

For this slice, one Goal-scoped JSON file is acceptable because:

- the runtime history is still small
- it keeps Phase 2 simple
- the abstraction allows a later split to file-per-run storage if scale requires it

## Scheduler Integration

`reconcileOnce` remains the only writer for scheduler-created runtime history.

Rules:

- dispatch from `planned` starts a new run and its first step
- dispatch from `in_review` or `merging` appends a step to the latest active run for that task
- task status reset after non-success outcomes closes the run with a retryable terminal state
- `done` closes the run as completed
- blocker creation closes the run as blocked
- scheduler system errors close the current step/run as system errors but do not write task blockers

## API Surface

Add Bun routes:

- `GET /api/goals/:goalKey/runs`
- `GET /api/goals/:goalKey/runs/:runId`

The list route returns lightweight run summaries suitable for sidebars and selectors.

The detail route returns the full run with ordered steps and messages.

## UI Shape

The replacement UI is Goal-scoped and read-only for workflow state.

It shows:

- canonical board lanes from `todo.yml`
- a run list for the current Goal
- a step list for the selected run
- a message history panel for the selected step

It must not depend on the deleted prototype session API.

## Non-Goals

- no session streaming route
- no assistant chat implementation
- no direct workflow state mutation from the UI
- no compatibility adapters for `candidate`, `blocked`, `dependencyTaskList`, or `body`

