# Assistant Workflow Child Action Inspection

Status: implemented
Date: 2026-06-03

## Goal

Expose child-level workflow action authority on structured assistant `action` inspection instead of flattening workflow actions down to one workflow count plus top-level reuse and shared-answer metadata.

## Gap

Shared assistant `action` inspection already surfaced top-level workflow metadata like:

- `workflowKey`
- `reuseTaskRef`
- `reuseGroupKey`
- linked decision refs
- shared planner-answer counts
- reusable answer-source counts

But child-level workflow action authority was still hidden inside structured payloads:

- `workflowTaskKey`
- grouped child `groupKey`
- planning-child `requestedUpdates`
- grouped child request `taskKey`s

That meant assistant thread inspection, bundled assistant context, and Bun assistant-run detail could tell that a workflow action existed, but not which durable child was supposed to update which docs or open which grouped planning requests.

## Design

Extend the shared assistant `action` formatter so workflow actions and workflow-batch follow-through actions surface one detail line per child:

- `planning` children identify themselves by `workflowTaskKey`
- `planning` children summarize their durable updates from `requestedUpdates`
- `planning_batch` children identify themselves by `groupKey`
- `planning_batch` children summarize their grouped request intent from each request `taskKey`

Because thread inspection, bundled assistant context, and assistant run detail already reuse the same shared `action` formatter, one helper change lifts the richer child-level workflow action authority across all three inspection paths without adding a second inspection surface or changing runtime/store semantics.

## Verification

- shared assistant-thread presentation tests cover child-level workflow action details on both direct workflow actions and decision follow-through workflow actions
- bundled assistant context tests confirm the richer workflow-child action detail is visible in recent assistant thread rendering
- targeted backend tests, typecheck, and lint pass before commit
