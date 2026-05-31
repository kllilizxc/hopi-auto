# Decision-Driven Planning Request Enrichment Implementation Plan

Goal: automatically enrich open planning requests when a visible decision blocker is opened for their planning task.

Architecture: keep decision blockers on tasks and planning intent in `planning-requests.yml`, extend the shared decision-request runtime helper to enrich existing open planning requests for the same planning task, and reuse that helper from both assistant and direct API decision flows.

Tech Stack: Bun, TypeScript, Bun test

Completed implementation tasks:

- [x] Add failing tests for shared decision-to-planning enrichment, API decision creation, and assistant decision-request flow.
- [x] Extend the shared decision-request runtime helper to enrich existing open planning requests for the linked planning task.
- [x] Default missing requested updates to `design.md` plus `todo.yml` only when the linked planning request has no explicit targets yet.
- [x] Verify through focused tests, full `bun run check`, and a local Bun API sanity check.
