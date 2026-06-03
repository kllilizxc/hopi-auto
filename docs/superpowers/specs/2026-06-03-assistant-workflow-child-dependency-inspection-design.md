# Assistant Workflow Child Dependency Inspection

Status: implemented
Date: 2026-06-03

## Goal

Expose workflow-child dependency authority on structured assistant `action` inspection instead of leaving `blockedByWorkflowKeys` buried in raw workflow action payloads.

## Gap

Shared assistant `action` inspection already surfaced:

- workflow-root metadata like `workflowKey`, reuse keys, linked decisions, and shared planner-answer counts
- child-level workflow intent like `workflowTaskKey` / `groupKey`
- child-level updates or grouped request task keys

But one important piece of durable workflow-graph authority still stayed hidden:

- `blockedByWorkflowKeys`

That meant assistant thread inspection, bundled assistant context, and Bun assistant-run detail could show which child existed, but not which earlier child each workflow child was explicitly waiting on.

## Design

Extend the shared assistant `action` formatter so every workflow child detail can optionally emit one dependency line when `blockedByWorkflowKeys` is non-empty:

- direct `request_planning_workflows` children render `Workflow child <childKey> depends on: ...`
- decision follow-through `workflow_batch` children render `Follow-through workflow child <childKey> depends on: ...`
- `planning` children identify themselves by `workflowTaskKey`
- `planning_batch` children identify themselves by `groupKey`

Because assistant thread inspection, bundled assistant context, and assistant run detail already reuse the same shared formatter, one helper-level change lifts the richer workflow-child dependency authority across all three surfaces without touching runtime or store semantics.

## Verification

- shared assistant action formatter tests cover child dependency detail on direct workflow actions and answer-driven workflow follow-through actions
- bundled assistant context tests confirm the dependency lines are visible in recent assistant thread rendering
- targeted backend tests pass before commit
