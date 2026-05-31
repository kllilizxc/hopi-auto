# Goal Assistant Decision Requests And Management Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Extend the active Goal assistant product path so decision handling is no longer limited to passive viewing plus answer recording. The system should support explicit decision requests, manual file-native decision management, and visible blocker follow-through on planning work.

## Why This Slice Exists

The prior assistant slices already added:

- Goal-scoped assistant execution
- assistant run inspection
- repo preference editing
- `request_planning`, `record_preference`, and `resolve_decision`

What was still missing was the next decision-management loop:

- assistant could resolve a decision, but not explicitly request one
- the product path could show decisions, but could not create them directly
- visible planning follow-through stopped at planning task reuse rather than opening a blocking decision topic when one missing answer still blocked progress

## Constraints

- `todo.yml` remains the only workflow truth
- `decisions.yml` remains the only durable decision-topic source of truth
- assistant still may not create engineering tasks or edit source files
- decision blockers must stay visible through the same board/doc control path
- the implementation must not introduce a second decision store or hidden queue

## Implemented Scope

### Shared Decision Request Control Path

Add one shared control helper that can:

- create a new Goal decision topic when needed
- reuse an existing one by stable `decisionKey`
- optionally attach a visible `blockedBy.kind=decision` ref to a task

This keeps assistant and manual API writes on one deterministic path.

### Assistant `request_decision` Action

Add a new assistant action:

- `request_decision`

This lets assistant explicitly request one missing high-leverage answer and link it to visible planning work when appropriate.

That is a better fit for authority boundaries than forcing assistant to guess or silently stop at a reused planning task.

### Manual Decision Creation API

Add:

- `POST /api/goals/:goalKey/decisions`

This route creates a durable decision topic and, when a `taskRef` is provided, links the decision blocker to that visible task.

### Manual Decision Management In The Bun UI

The Bun UI now supports:

- creating a durable decision topic
- optionally linking that topic to a visible task ref
- resolving an open decision topic directly from the assistant panel

This keeps decision management on the active product path instead of forcing manual file edits.

### Decision Change Refresh

Add `decisions_changed` SSE broadcasts so the UI reloads when decision topics are created or resolved through the API path.

## Non-Goals

- a rich decision taxonomy beyond the current `decisions.yml` shape
- reopened decision history or multi-version topic lineage
- generalized assistant graph authoring
- replacing planner with assistant-side decomposition

## Acceptance Criteria

- assistant can explicitly request a decision topic through a structured durable action
- manual Bun API/UI paths can create and resolve decision topics
- task-linked decisions become visible blockers on the board through the same local-doc truth path
- decision creation and resolution refresh the product UI without manual reloads
- no second decision truth path is introduced
