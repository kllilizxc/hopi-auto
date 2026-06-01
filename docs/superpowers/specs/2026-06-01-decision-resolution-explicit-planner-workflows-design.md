# Decision-Resolution Explicit Planner Workflows Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Let an answered engineering-linked decision carry an explicit visible planner follow-through shape, including grouped planning stages, instead of forcing runtime to create only the generic single-task `design.md` / `todo.yml` bridge.

## Why This Slice Exists

The current system already supports:

- automatic decision-resolution planner follow-through for engineering-linked decisions
- explicit grouped planning follow-through through standalone planning actions
- validated Goal-local `requestedUpdates` beyond the built-in core files

But one important gap remained:

- resolving a decision through the assistant or API could only trigger the narrow generic follow-through
- richer planner workflows required a second separate `request_planning` or `request_planning_batch` action after the decision answer
- that split the durable answer from the durable follow-through it justified
- grouped or Goal-doc-heavy follow-through could not be expressed atomically at decision-resolution time

That left the product path too weak for answers that materially reshape several Goal-local durable docs before engineering should resume.

## Constraints

- keep `decisions.yml` as the durable answer store
- keep `planning-requests.yml` as the only durable planner follow-through store
- do not add a hidden planner queue or second workflow truth
- preserve the current generic engineering follow-through when no explicit follow-through is supplied
- keep the scope limited to engineering-linked decision resolution; planning-task decisions stay on the existing path

## Implemented Scope

### Explicit Follow-Through On Decision Resolution

`resolveGoalDecision`, the Bun API resolve route, and the assistant `resolve_decision` action now accept an optional `followThrough` payload with one of two shapes:

- `planning`: one explicit visible planning request
- `planning_batch`: one grouped visible planning workflow with stable `groupKey` plus grouped `taskKey` stages

Runtime injects the resolved decision key into the created or reused planning requests automatically so callers do not need to duplicate that lineage manually.

### Deterministic Blocker Rewiring

When an explicit grouped follow-through is used, runtime rewires affected engineering work onto the current open grouped sink tasks rather than the first grouped task.

This preserves the existing grouped-blocker model:

- engineering remains blocked on the current grouped planning tail
- grouped prerequisites still remain visible through task blockers

### Shared Result Visibility

Decision-resolution results now surface whether they created or reused follow-through requests, including request refs, task refs, and grouped keys when present.

This lets assistant execution summaries and Bun API broadcasts treat decision-resolution-created planning follow-through as first-class visible work.

## Non-Goals

- semantic inference from arbitrary non-decision user messages
- changing the default generic bridge when no explicit follow-through is provided
- adding automatic follow-through for unrelated tasks that were not linked to the resolved decision
- changing planning-task decision resolution semantics

## Acceptance Criteria

- resolving an engineering-linked decision can create one explicit planning follow-through through the shared decision-resolution path
- resolving an engineering-linked decision can create grouped planning follow-through through the shared decision-resolution path
- grouped explicit follow-through rewires affected engineering blockers onto the current grouped sink tasks
- created or reused follow-through requests automatically carry the resolved decision lineage
- assistant and API use the same decision-resolution follow-through model while preserving the current default generic bridge
