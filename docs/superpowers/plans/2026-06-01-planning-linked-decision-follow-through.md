# Planning-Linked Decision Follow-Through Plan

Status: completed
Date: 2026-06-01

Goal: let explicit decision-resolution follow-through reuse the current planning task surface when the resolved decision is linked to planning work, while preserving the current default behavior when no explicit follow-through is supplied.

## Steps

1. Add failing tests for planning-request helpers that bind a durable planning request or grouped first stage onto an existing planning task ref.
2. Add failing tests for shared decision resolution so explicit planning-linked follow-through reuses the current planning surface and can still rewire engineering blockers when present.
3. Add failing tests for the Bun API and assistant product path on planning-linked explicit follow-through.
4. Extend shared planning-request helpers with an internal existing-task reuse path for single requests and grouped batches.
5. Extend shared decision-resolution follow-through logic to reuse the linked planning task surface when explicit follow-through is supplied.
6. Update assistant guidance and handoff docs to describe explicit planning-linked decision follow-through.
7. Run focused tests, then `bun run check`.
8. Do one real local Bun API sanity check on planning-linked grouped follow-through.
9. Update handoff/docs indexes and commit the verified slice.
