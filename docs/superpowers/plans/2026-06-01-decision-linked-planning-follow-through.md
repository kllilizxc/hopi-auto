# Decision-Linked Planning Follow-Through Implementation Plan

Goal: enrich durable planning requests with decision lineage and explicit durable update targets so planner follow-through after new answers is inspectable and deterministic.

Architecture: keep `planning-requests.yml` as the same Goal-scoped durable request surface, extend its schema with `decisionRefs` and `requestedUpdates`, merge richer metadata when open requests are reused, and thread the same fields through assistant actions, Bun API/UI, and planner context policy.

Tech Stack: Bun, TypeScript, Bun test, Bun HTML import UI

Completed implementation tasks:

- [x] Add failing tests for richer planning-request storage, API surfacing, assistant action flow, and planner context rendering.
- [x] Extend `planning-requests.yml` schema plus shared request helper with deterministic lineage/target merging.
- [x] Extend assistant `request_planning`, direct API creation, and Bun UI creation/inspection with the richer metadata.
- [x] Strengthen planner context and follow-through policy around `design.md` and `todo.yml` targets.
- [x] Verify through focused tests, full `bun run check`, and local Bun service sanity checks.
