# Assistant Workflow Child Context Inspection

Status: implemented
Date: 2026-06-03

## Goal

Expose child-specific workflow action context on structured assistant `action` inspection instead of leaving extra child `decisionRefs` and child-local planner answers buried inside raw workflow payloads.

## Gap

Shared assistant `action` inspection already surfaced:

- workflow-root metadata like `workflowKey`, reuse keys, shared planner-answer counts, and linked decisions
- child identity like `workflowTaskKey` or `groupKey`
- child updates or grouped request task keys
- child dependency authority from `blockedByWorkflowKeys`

But one layer of child-specific context authority still stayed hidden:

- extra child `decisionRefs`
- child-local planner-answer counts

That meant assistant thread inspection, bundled assistant context, and Bun assistant-run detail could show that a child existed and what it updated, but not whether that child carried extra decision lineage or extra planner-answer context beyond the workflow root.

## Design

Extend the shared assistant `action` formatter so workflow children can emit optional context lines:

- direct `request_planning_workflows` children render child-specific `decisionRefs` when present
- both direct workflow children and decision-follow-through `workflow_batch` children render child-local planner-answer counts when present
- these context lines appear alongside existing child update/request and dependency lines, preserving the current one-formatter inspection path across thread, bundled context, and run detail surfaces

This keeps the change strictly in shared inspection presentation; runtime and store semantics do not change.

## Verification

- shared assistant presentation tests cover child-level decision lineage and planner-answer context on direct workflow actions and decision-follow-through workflow actions
- bundled assistant context tests confirm those child context lines are visible in recent assistant thread rendering
- targeted backend tests, typecheck, and lint pass before commit
