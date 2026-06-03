# Assistant Thread Action Authority Design

## Goal

Promote assistant-thread history from a summary-only action log into a durable inspection surface for the assistant's requested mutations as well as their results.

## Current Gap

After the earlier action-result slice:

- assistant-thread history already persisted structured `action_result`
- plain `action` entries still kept only `actionType + summary`
- Bun thread inspection and bundled assistant context still could not inspect the requested mutation payload itself

That left half the conversation durable and inspectable, but kept the actual requested write intent lossy.

## Design

### 1. Persist structured action payloads on thread entries

`assistant-thread.json` action entries now support an optional structured `action` payload carrying the same `GoalAssistantAction` shape already persisted on assistant run records.

This remains additive:

- old summary-only thread entries still parse
- new action entries preserve the full requested mutation payload

### 2. Write structured actions at action-queue time

When `GoalAssistantRuntime` appends an `action` entry before applying one assistant mutation, it now records the full `action`, not only the human summary.

### 3. Reuse one shared inspection helper

The shared assistant inspection helper now formats:

- structured action detail lines
- structured action-result detail lines
- thread entry presentation
- recent assistant-thread markdown inside bundled assistant context

This keeps thread UI and assistant context aligned on the same durable authority surface.

### 4. Surface requested mutation authority through normal inspection paths

The Bun assistant-thread surface and bundled assistant context now show key requested-action metadata such as:

- planning title
- requested durable updates
- action-side `sourceResponseFormat`
- other action-specific authority when present

without requiring raw run inspection.

## Non-Goals

- No new assistant action kinds
- No changes to action execution behavior
- No second thread-only action schema
- No migration that rewrites existing summary-only thread history

## Verification

- assistant-thread store test for structured action persistence
- shared thread-presentation unit tests for action detail rendering
- assistant thread API regression via `/api/goals/:goalKey/assistant/thread`
- backend typecheck and lint
