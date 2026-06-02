# Decision Workflow Explicit Surface Reuse Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let decision-backed and answer-backed `workflow_batch` follow-through explicitly reuse one current planning surface or one current grouped planning surface, instead of only supporting direct workflow reuse or narrow implicit planning-linked reuse.

## Why This Slice Exists

The current system already supported:

- direct `request_planning_workflows` reuse through `reuseTaskRef` and `reuseGroupKey`
- planning-linked decision follow-through that could implicitly reuse the currently linked planning surface
- shared workflow-graph authority across direct and decision-backed multi-workflow follow-through

That still left one parity gap:

- answer-driven `workflow_batch` could not explicitly adopt an arbitrary existing planning surface
- grouped reuse on answer-driven `workflow_batch` could not represent “adopt this current grouped surface and extend it” without replaying grouped requests
- the decision-backed surface was therefore weaker than the direct workflow graph surface it already reused underneath

## Constraints

- keep `planning-requests.yml` as the only durable planner-follow-through metadata store
- keep `decisions.yml` as the only durable truth for resolved decision answers
- preserve current implicit reuse for planning-linked decisions when no explicit reuse target is supplied
- do not introduce a second workflow registry or answer-specific reuse path

## Implemented Scope

### Explicit Reuse Fields On Decision Workflow Batches

Decision-backed and answer-backed `workflow_batch` now accept optional root fields:

- `reuseTaskRef`
- `reuseGroupKey`

through:

- runtime `resolveGoalDecision(...)`
- runtime `answerGoalDecision(...)`
- runtime `answerGoalDecisions(...)`
- Bun API `resolve`, `answer`, and `answers` endpoints
- assistant `resolve_decision`, `record_answer`, and `record_answers` actions

### Shared Runtime Helper Stays Canonical

Runtime does not introduce a second reuse implementation.

Instead, decision-backed `workflow_batch` now forwards explicit reuse targets into the existing shared `requestGoalPlanningWorkflows(...)` helper:

- `reuseTaskRef` adopts one current planning task as the first workflow child
- `reuseGroupKey` adopts one current grouped planning surface as the first workflow child when that child is a matching `planning_batch`

So the same validation, blocker propagation, workflow-key persistence, and child-dependency behavior still comes from the direct-workflow runtime.

### Explicit Reuse Beats Implicit Reuse

When answer-driven `workflow_batch` supplies explicit reuse:

- runtime uses the explicit reuse target
- implicit planning-linked reuse inference does not override it

When explicit reuse is omitted, existing planning-linked implicit reuse behavior stays unchanged.

## Non-Goals

- changing default follow-through behavior when no explicit `workflow_batch` is supplied
- inferring reuse targets from raw user replies without explicit action payloads
- adding reuse of more than one existing planning surface in a single decision-backed workflow batch

## Acceptance Criteria

- decision-backed `workflow_batch` can explicitly reuse one current planning task through `reuseTaskRef`
- decision-backed `workflow_batch` can explicitly reuse one current grouped planning surface through `reuseGroupKey`
- answer-backed `record_answer` and `record_answers` expose the same explicit reuse authority
- explicit reuse continues to flow through the shared direct-workflow runtime helper rather than a separate answer-specific implementation
