# Goal Doc Planning Update Targets Implementation Plan

Goal: make `goal.md` a first-class requested update target inside durable planning follow-through.

Architecture: widen the shared planning-request update-target enum to include `goal.md`, then thread that target through assistant/API/UI contracts, follow-through evidence rendering, planner policy text, and scheduler validation.

Tech Stack: Bun, TypeScript, Bun test

Completed implementation tasks:

- [x] Add failing tests for `goal.md` request-target storage, evidence coverage, planner context rendering, scheduler hard guards, and API acceptance.
- [x] Extend shared planning-request target enums and product-surface schemas to include `goal.md`.
- [x] Update follow-through evidence ordering plus planner policy wording so Goal doc maintenance is explicit and inspectable.
- [x] Verify through focused tests, full `bun run check`, and a local Bun API sanity check.
