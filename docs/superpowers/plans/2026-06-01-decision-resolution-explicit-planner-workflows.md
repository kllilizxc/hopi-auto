# Decision-Resolution Explicit Planner Workflows Plan

Status: completed
Date: 2026-06-01

Goal: let engineering-linked decision resolution carry one explicit single or grouped planner follow-through through the shared runtime path, while preserving the current default generic bridge when no explicit follow-through is supplied.

## Steps

1. Add failing tests for shared decision-resolution support for explicit single-request follow-through and grouped follow-through, including engineering blocker rewiring to grouped sink tasks.
2. Add failing tests for the Bun API resolve route with explicit decision-resolution follow-through.
3. Add failing tests for the Goal assistant `resolve_decision` action with explicit grouped follow-through.
4. Extend the shared decision-resolution helper with an optional explicit follow-through payload, shared follow-through result metadata, and deterministic grouped sink blocker rewiring.
5. Extend API and assistant schemas plus prompt guidance to accept the new decision-resolution follow-through shape.
6. Surface planning-request change visibility when decision resolution creates follow-through through the API or assistant path.
7. Run focused tests, then `bun run check`.
8. Update handoff/docs indexes and commit the verified slice.
