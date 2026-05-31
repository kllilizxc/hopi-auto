# Goal Docs Inspection And Planner Doc-Status Implementation Plan

Goal: make `goal.md` and `design.md` inspectable on the active Bun product path and strengthen planner prompts with explicit durable doc-status policy.

Architecture: extend `GoalDocsStore` with deterministic read-side inspection, expose that snapshot through Bun API, surface it in the Bun UI, and feed derived doc-status into planner context/prompt generation without introducing new hidden state.

Tech Stack: Bun, TypeScript, Bun test

Completed implementation tasks:

- [x] Add failing tests for Goal doc inspection and planner doc-status prompt behavior.
- [x] Extend `GoalDocsStore` with read-side Goal doc snapshots and deterministic `bootstrapped` versus `curated` classification.
- [x] Expose Goal docs through `GET /api/goals/:goalKey/docs`.
- [x] Inject Goal doc status into planner context and prompt policy.
- [x] Surface Goal docs and status in the active Bun UI.
- [x] Verify through focused tests, full `bun run check`, and local HTTP sanity checks.
