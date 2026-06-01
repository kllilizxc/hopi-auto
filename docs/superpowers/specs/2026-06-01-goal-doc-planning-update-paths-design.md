# Goal-Doc Planning Update Paths Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let durable planning requests target validated Goal-local document paths beyond the fixed `goal.md`, `design.md`, and `todo.yml` trio.

## Why This Slice Exists

The current planner follow-through model already supports:

- durable `planning-requests.yml`
- explicit requested update coverage
- scheduler enforcement against missing durable follow-through
- grouped planning follow-through and grouped blocker propagation

But one important long-term gap remained:

- `requestedUpdates` was hardcoded to the three built-in files
- assistant actions, API validation, write-trace evidence, and Bun UI all enforced that fixed enum
- planner follow-through could not explicitly request maintenance of richer Goal-local docs such as `research.md`, `api-contract.md`, or `notes/rollout.md`

That made the file-native planning model too narrow for later phases where durable planning work needs more than the original three surfaces.

## Constraints

- keep `requestedUpdates` as the single durable field; do not add a parallel target model
- keep validation deterministic and Goal-local
- reject paths that escape the Goal docs directory
- reject writes to reserved runtime/audit files through this planning-doc surface
- preserve the existing first-class behavior of `goal.md`, `design.md`, and `todo.yml`

## Implemented Scope

### Validated Goal-Local Update Paths

`requestedUpdates` now stores normalized relative paths rooted at `.hopi/docs/goals/<goalKey>/`.

Supported examples include:

- `goal.md`
- `design.md`
- `todo.yml`
- `research.md`
- `api-contract.md`
- `notes/rollout.md`

Normalization:

- trims whitespace
- collapses redundant `./` and duplicate separators
- preserves a deterministic relative path string

Rejected targets:

- absolute paths such as `/tmp/escape.md`
- traversal such as `../escape.md`
- reserved Goal runtime/state files such as `decisions.yml`, `planning-requests.yml`, `events.jsonl`, and `write-trace.jsonl`

### Unified Schema Surface

The same target-path validation now applies at every durable ingress:

- planning-request store reads and writes
- Bun API request validation
- assistant action validation for `request_planning` and `request_planning_batch`
- Bun UI request creation

This keeps the file-native contract consistent instead of allowing each surface to invent its own interpretation.

### Generalized Follow-Through Evidence

Planning follow-through evidence now works for arbitrary validated Goal-local targets instead of only the fixed enum.

Coverage still preserves the current first-class ordering for the core files:

- `goal.md`
- `design.md`
- `todo.yml`

Any additional Goal-local targets then appear in stable first-seen order after those core paths.

Write traces satisfy a requested update when they touch either:

- the exact relative target path
- a Goal-local file path whose suffix matches that target path

### Planner and Assistant Guidance

Planner context and prompt policy now state that:

- requested update paths are relative to the Goal docs directory
- planner may satisfy planning follow-through by creating or updating other Goal-local durable docs when explicitly requested
- `goal.md`, `design.md`, and `todo.yml` still carry their existing specialized policy guidance

Assistant guidance and the Bun UI now expose the same generalized relative-path model instead of suggesting only the old fixed trio.

## Non-Goals

- bootstrapping arbitrary extra Goal docs automatically
- letting planning requests point at source files outside the Goal docs directory
- replacing the special policy for `goal.md`, `design.md`, or `todo.yml`
- adding a second durable follow-through store

## Acceptance Criteria

- planning requests accept normalized Goal-local doc targets such as `research.md` and `notes/rollout.md`
- traversal, absolute paths, and reserved Goal state files are rejected deterministically
- planning write-trace evidence reports observed and missing coverage for extra Goal-local targets
- planner, assistant, API, and Bun UI all use the same validated requested-update path model
