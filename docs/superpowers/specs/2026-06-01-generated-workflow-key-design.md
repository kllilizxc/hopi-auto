# Generated Workflow Key Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Make higher-order planning workflow graphs durable by default, so callers do not need to handcraft a `workflowKey` just to get extension authority, shared context persistence, and workflow-wide blocker tracking.

## Why This Slice Exists

The current system already supported:

- durable workflow graphs through explicit `workflowKey`
- direct and decision-backed `workflow_batch`
- stable child identity through `workflowTaskKey`
- shared workflow-graph authority across direct and decision-backed workflow surfaces

But one practical authority gap still remained:

- callers had to invent a stable `workflowKey` manually before a workflow graph became durable
- otherwise the same `workflow_batch` shape returned `workflowKey: undefined`
- that made durable extension authority depend on prompt craftsmanship instead of runtime defaults
- assistant, API, and decision follow-through therefore still treated top-level workflow identity as optional operator labor

That was weaker than the file-native authority route.

## Constraints

- keep `planning-requests.yml` as the only durable workflow metadata truth
- do not add a workflow registry or second workflow store
- preserve explicit custom `workflowKey` values when callers provide them
- keep generated ids goal-local and deterministic relative to existing request state

## Implemented Scope

### Default Durable Workflow Identity

`requestGoalPlanningWorkflows(...)` now always resolves one durable top-level workflow identity:

- use the caller-provided `workflowKey` when present
- otherwise generate one goal-local key in the form `W-<n>`

Generated keys are derived by scanning existing planning requests for prior generated workflow ids and choosing the next available number.

### Generated Keys Apply Across Every Workflow Entry Surface

Because direct planning, assistant workflow actions, and decision-backed `workflow_batch` already converge on the shared planning-workflow runtime helper, generated keys now automatically flow through:

- direct `request_planning_workflows`
- Bun API `POST /api/goals/:goalKey/planning-requests/workflows`
- assistant `request_planning_workflows`
- decision-backed `resolve_decision`, `record_answer`, and `record_answers` when they use `followThrough.kind = "workflow_batch"`

### Generated Keys Enable Durable Defaults

Once runtime generates `W-<n>` for a new workflow graph:

- every touched planning request persists that workflow key
- workflow-root shared context persists under that key
- workflow-wide blocker retargeting uses that key immediately
- later calls can extend the same graph by reusing the returned key

So durability is now the default for every higher-order workflow graph, not a separate opt-in.

## Non-Goals

- replacing explicit semantic workflow keys like `auth-rollout-follow-through`
- generating default `workflowTaskKey`, `groupKey`, or `groupTaskKey`
- inferring when separate earlier workflow graphs should merge into one generated key
- adding a second id-allocation file outside `planning-requests.yml`

## Acceptance Criteria

- direct workflow batches without explicit `workflowKey` return a generated `W-<n>`
- decision-backed workflow batches without explicit `workflowKey` return a generated `W-<n>`
- assistant action results surface the generated workflow key on workflow-batch actions
- touched planning requests persist that generated workflow key
- explicit caller-provided workflow keys still win unchanged
