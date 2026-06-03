# Assistant Workflow Child Result Inspection

Status: implemented
Date: 2026-06-03

## Goal

Expose child-level workflow result authority on structured assistant `action_result` inspection instead of flattening workflow results down to one child count and aggregate request/task/blocker ids.

## Gap

Shared `action_result` inspection already surfaced top-level workflow metadata like:

- `workflowKey`
- `groupKeys`
- aggregate `requestKeys`
- aggregate `taskRefs`
- aggregate `blockerTaskRefs`

But child-level workflow result authority was still hidden inside structured payloads:

- `workflowTaskKey`
- grouped child `groupKey`
- each child’s own `requestKeys`
- each child’s own `taskRefs`
- each child’s own `blockerTaskRefs`

That meant assistant thread inspection, bundled assistant context, and Bun assistant-run detail could tell that a workflow result had children, but not which durable child produced which subset of requests/tasks.

## Design

Extend the shared assistant `action_result` formatter so workflow results and follow-through workflow results surface one detail line per child:

- `planning` children identify themselves by `workflowTaskKey`
- `planning_batch` children identify themselves by `groupKey`
- each child line includes its own request/task/blocker ids

Because thread/context/run inspection already reuse the same formatter, this one helper change lifts the richer workflow-child authority across all three inspection paths without introducing a second inspection surface.

## Verification

- shared formatter tests cover child-level workflow result details on both direct workflow results and decision follow-through workflow results
- bundled assistant context tests confirm the richer workflow-child detail is visible in recent assistant thread rendering
- targeted backend tests, typecheck, and lint pass before commit
