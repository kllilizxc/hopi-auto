# Standalone Decision Follow-Through Plan

Status: completed
Date: 2026-06-01

Goal: let explicit `resolve_decision` follow-through create visible planning work even before there is an engineering blocker or reusable planning surface, while preserving current defaults and existing reuse behavior.

## Steps

1. Add failing tests for shared decision resolution on an existing unlinked decision topic with explicit single-task follow-through.
2. Add failing tests for the Bun API and assistant product path so explicit `resolve_decision` follow-through can create planner work without pre-existing blockers or reusable planning surfaces.
3. Extend shared decision-resolution follow-through logic so explicit `followThrough` can create planning work even when there are no affected engineering tasks and no linked planning surface.
4. Preserve existing reuse behavior when a planning surface exists and preserve default no-follow-through behavior when explicit `followThrough` is absent.
5. Update assistant guidance plus authority docs for standalone answer-driven follow-through.
6. Run focused tests, then `bun run check`.
7. Do one real local Bun API sanity check for an unlinked decision topic with explicit grouped follow-through.
8. Update handoff/docs indexes and commit the verified slice.
