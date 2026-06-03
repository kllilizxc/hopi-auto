# Assistant Grouped Planning Request Inspection

Status: implemented
Date: 2026-06-03

## Goal

Expose grouped planning request authority on structured assistant `action` inspection instead of flattening grouped planning actions down to one group key and one request count.

## Gap

Shared assistant `action` inspection already surfaced:

- grouped planning `groupKey`
- grouped request count
- root-level linked decisions
- shared planner-answer counts
- reusable answer-source counts

But request-level grouped planning authority still stayed hidden inside raw arrays:

- each grouped request `taskKey`
- each grouped request `requestedUpdates`
- each grouped request `blockedByTaskKeys`

That meant assistant thread inspection, bundled assistant context, and Bun assistant-run detail could tell that a grouped planning action existed, but not which grouped request was supposed to update which durable docs or which later grouped request depended on which earlier grouped request.

## Design

Extend the shared assistant `action` formatter so grouped planning actions emit one detail line per grouped request:

- direct `request_planning_batch` actions render `Grouped request: <taskKey> -> updates ...`
- decision-answer `followThrough.kind = "planning_batch"` actions render `Follow-through grouped request: <taskKey> -> updates ...`
- if a grouped request has `blockedByTaskKeys`, emit one extra dependency line for that request

This stays strictly inside shared inspection presentation. Thread inspection, bundled assistant context, and assistant run detail already reuse the same formatter, so one helper-level change lifts the richer grouped-request authority across all three surfaces without changing runtime or store semantics.

## Verification

- shared assistant presentation tests cover direct grouped planning actions and grouped planning follow-through actions
- bundled assistant context tests confirm grouped request detail lines are visible in recent assistant thread rendering
- targeted backend tests, typecheck, and lint pass before commit
