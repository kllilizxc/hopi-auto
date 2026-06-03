# Assistant Thread Action-Result Authority Design

## Goal

Promote assistant-thread history from a lossy chronological summary into a real durable inspection surface for assistant action results.

## Current Gap

Before this slice:

- assistant run records already persisted full structured `actionResults`
- assistant-thread history only persisted `actionType` plus `summary`
- Bun thread inspection and bundled assistant context therefore lost important authority such as:
  - `resolvedSourceResponseFormat`
  - `followThrough`
  - `createdDecisionKeys`
  - `blockerRemoved`
  - request/task/workflow identifiers already present on the underlying action result

That created a second weaker truth surface for the same assistant action history.

## Design

### 1. Persist structured action results on thread entries

`assistant-thread.json` action-result entries now support an optional structured `result` payload carrying the same `GoalAssistantActionResult` shape already persisted on assistant run records.

This keeps assistant-thread history additive:

- old summary-only entries still parse
- new entries preserve the full structured result

### 2. Write the structured result at action-application time

When `GoalAssistantRuntime` appends an `action_result` entry after applying one assistant action, it now records the full `result`, not only `summary`.

### 3. Reuse one shared presentation path

Assistant inspection now uses one shared formatter layer for:

- action-result detail lines
- thread entry presentation
- recent assistant-thread markdown inside bundled assistant context

This avoids separate UI/context summaries drifting from the structured result.

### 4. Surface thread authority in both product inspection paths

The Bun UI assistant-thread surface and the bundled assistant context now both show structured action-result details such as resolved interpretation format when present.

## Non-Goals

- No new assistant action kinds
- No answer-interpretation behavior changes
- No separate thread-only action-result schema
- No migration that rewrites old thread history files

## Verification

- assistant-thread store test for structured action-result persistence
- shared thread-presentation unit tests
- assistant thread API regression via `/api/goals/:goalKey/assistant/thread`
- backend typecheck and lint
