# Goal Assistant And Planner Runtime Integration Design

Status: approved for implementation
Date: 2026-06-01

## Goal

Add the first Goal assistant substrate and planner-runtime integration layer on top of the current Bun-first deterministic backend, without reintroducing hidden write paths, legacy prototype state, or a second source of workflow truth.

## Why This Phase Exists

The current system can already:

- store file-native workflow truth in `todo.yml`
- run planner / generator / reviewer / merger steps through real process transports
- persist run history, write traces, and normalized vendor transcripts

What it cannot yet do is expose a durable Goal-level assistant that can:

- explain current state and blockers
- route new work through visible planning tasks
- record explicit user decisions and durable preferences
- feed those decisions and preferences back into Planner in a deterministic way

That gap is now the highest-leverage missing layer.

## Design Constraints

These constraints are authoritative for this phase:

- `todo.yml` remains the only durable workflow truth
- assistant may not directly create hidden engineering work
- assistant may not write source files
- planner remains the only graph-shaping runtime
- all durable Goal/design changes remain local-doc and file-native
- no queue service, database, or compatibility layer is introduced

## Alternatives

### A. UI-only assistant facade over existing read APIs

This would add a chat shell that only explains state and tells the user to manually edit workflow files.

Why not:

- it would not close the planner/runtime loop
- it would not persist decisions or durable preferences
- it would create a nice-looking dead end rather than a product path

### B. Goal assistant runtime plus constrained action executor

This adds:

- a Goal-scoped assistant thread history
- a small deterministic action surface
- durable decision and preference stores
- planner context integration for those stores

Why this is recommended:

- it adds the missing product substrate without changing workflow truth
- it keeps assistant authority intentionally smaller than Planner
- it composes cleanly with the current process runner and role context bundle model

### C. Full generalized multi-agent conversation system

This would add resumable assistant sessions, multi-party coordination, richer orchestration, and cross-role dialogue.

Why not now:

- too much surface area
- unclear immediate payoff relative to Goal assistant basics
- high risk of rebuilding the old prototype in a more complex shape

## Recommended Architecture

Use approach B.

The next phase should add a minimal but real Goal assistant substrate with four pieces:

1. durable assistant-adjacent files
2. Goal assistant runtime history
3. constrained assistant actions
4. planner/runtime context integration for those files

## Durable Files

### Goal-level decisions

Add:

```text
.hopi/docs/goals/<goalKey>/decisions.yml
```

Purpose:

- durable record of explicit user answers that affect planning or blockers
- authoritative local-doc answer source for `decision` blockers

Minimal shape:

- stable `decisionKey`
- `summary`
- `status`: `open | resolved`
- optional `taskRef`
- optional `answer`
- timestamps

This file should stay small and human-readable.

### Repo-level preferences

Add:

```text
.hopi/preference.md
```

Purpose:

- durable repo-level user preferences that should shape future assistant/planner behavior

This is not workflow truth. It is durable context input.

## Goal Assistant Runtime

Add a Goal-scoped runtime overlay store:

```text
.hopi/runtime/goals/<goalKey>/assistant-thread.json
```

This thread is not workflow truth and is allowed to be runtime overlay state.

It should persist:

- user messages
- assistant messages
- structured assistant actions
- action results

This thread is the canonical assistant conversation for a Goal. It is separate from task run history because its lifecycle is conversational and user-driven, not scheduler-driven.

## Assistant Authority

Assistant is not another engineering or planning agent.

Assistant may:

- read board state, Goal docs, decisions, preferences, run history, write traces, and transcript history
- explain blockers and recent runtime outcomes
- move existing tasks through legal manual transitions
- create or move visible planning tasks
- record explicit decision answers in `decisions.yml`
- update `.hopi/preference.md`

Assistant may not:

- directly create engineering tasks from vague user requests
- directly edit source files
- directly edit `goal.md` or `design.md`
- bypass the same local-doc board writer path used elsewhere
- spawn arbitrary coding subagents

## Planner Integration

Planner remains the graph author.

This phase should integrate Planner with the new assistant substrate in three ways:

### 1. Planner context includes decisions and preferences

Planner bundles should receive:

- `goal.md`
- `design.md`
- `todo.yml`
- `decisions.yml`
- `.hopi/preference.md`
- relevant write traces

### 2. Planner owns design maintenance

When a user asks for new engineering work through assistant:

- assistant should create or move visible planning work
- planner should then update `design.md` before reshaping substantial engineering tasks

### 3. Decision blockers become actionable

When a task is blocked by `decision`:

- assistant should be able to explain the blocker
- if the user provides an answer, assistant records it in `decisions.yml`
- planner can then reshape or unblock affected work through normal local-doc paths

## API Surface

This phase should add Bun API routes for:

- reading the assistant thread
- posting a user message to the assistant thread
- listing decisions for a Goal
- resolving a decision

The assistant runtime call itself should be explicit and Goal-scoped. It should not be hidden behind scheduler reconcile.

## Transport Model

Assistant should reuse the current process transport substrate instead of inventing a parallel runtime stack.

That means:

- built-in vendor transports remain available
- assistant gets its own transport-facing prompt bundle
- assistant transcript normalization can reuse the same normalized transcript event model where possible

Assistant does not need to be a scheduler `TaskItem` role. It is an on-demand Goal runtime that reuses the same execution substrate.

## First Implementation Slice

The first slice after this spec should be the smallest substrate that makes the phase real:

1. `decisions.yml` store
2. `.hopi/preference.md` bootstrap/store
3. `assistant-thread.json` runtime store
4. planner context plumbing for decisions and preferences

That slice is deliberately chosen before live assistant execution because it establishes the durable inputs and boundaries that assistant and planner must share.

## Testing Strategy

Add tests in this order:

- decisions/preference store tests
- assistant thread store tests
- planner context bundle tests proving decisions and preferences are included
- API tests for reading and writing assistant-adjacent state

Only after those pass should a live assistant runtime route be added.

## Acceptance Criteria

- Goal decisions are durable and file-native
- repo preferences are durable and bootstrapped
- a Goal assistant thread exists as runtime overlay state
- planner context bundles include decisions and preferences
- assistant authority is explicitly narrower than planner authority
- no new hidden workflow truth is introduced
