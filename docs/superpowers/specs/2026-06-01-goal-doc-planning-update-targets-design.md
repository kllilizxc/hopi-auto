# Goal Doc Planning Update Targets Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Make `goal.md` a first-class planning follow-through target so deeper Goal doc maintenance uses the same durable planner contract as `design.md` and `todo.yml`.

## Why This Slice Exists

The current planner/runtime stack already supports:

- durable Goal docs through `goal.md` and `design.md`
- file-native `planning-requests.yml`
- explicit `requestedUpdates` on planning requests
- planner/reviewer/merger evidence policy grounded in planning requests plus durable write traces
- scheduler hard guards that send planning work back when requested durable evidence is missing

But one important mismatch remained:

- `goal.md` was part of durable Goal docs
- planner already had permission to update `goal.md`
- richer planner/runtime workflows were explicitly expected to build on top of `goal.md`, `design.md`, and `planning-requests.yml`
- yet `requestedUpdates` could only name `design.md` and `todo.yml`

That meant deeper Goal doc maintenance had no explicit durable follow-through target, no evidence coverage surface, and no scheduler-enforced contract.

## Constraints

- `todo.yml` remains the only workflow truth
- `goal.md` remains durable context, not workflow state
- planner is still the only role allowed to reshape Goal docs
- no hidden inference layer for when `goal.md` must change
- decision-driven defaults remain conservative; this slice only widens explicit planner targets

## Implemented Scope

### `goal.md` As A Requested Update Target

Planning requests now support three explicit durable update targets:

- `goal.md`
- `design.md`
- `todo.yml`

This target is available through the same shared paths as existing update targets:

- durable `planning-requests.yml`
- assistant `request_planning`
- Bun API request validation
- Bun UI planning-request creation

### Evidence And Policy Parity

When a planning request targets `goal.md`, the existing planning follow-through machinery now treats it exactly like other durable targets:

- write-trace evidence inspection can observe `goal.md`
- planner context surfaces `goal.md` in relevant open planning requests and requested-update coverage
- planner prompt policy explicitly tells planner to refresh durable goal context when `goal.md` is requested
- planning reviewer/merger prompts inspect the same requested-update coverage
- scheduler hard guards will reject planning success when requested `goal.md` evidence is still missing

### Ordered Coverage

Requested-update coverage now renders in Goal-doc-first order:

- `goal.md`
- `design.md`
- `todo.yml`

This matches the intended conceptual stack of durable goal context, then design rationale, then task graph.

## Non-Goals

- automatically inferring that every material answer must update `goal.md`
- changing default decision-driven follow-through from `design.md` plus `todo.yml`
- allowing non-planner roles to edit Goal docs
- turning `goal.md` into workflow truth or approval state

## Acceptance Criteria

- planning requests can explicitly target `goal.md`
- assistant, API, and Bun UI accept and surface `goal.md` through the existing planning-request control path
- requested-update evidence and planner/reviewer/merger policy render `goal.md` alongside other durable targets
- scheduler hard guards planning review/merge success when requested `goal.md` evidence is missing
