# Grouped Planning Follow-Through Implementation Plan

Goal: support one durable planning follow-through that spans multiple visible planning tasks.

Architecture: add optional `groupKey` metadata to planning requests, then build one shared batch helper plus one assistant action that creates or reuses multiple planning requests/tasks with deterministic intra-batch dependency mapping and grouped planner context surfacing.

Tech Stack: Bun, TypeScript, Bun test

Completed implementation tasks:

- [x] Add failing tests for `groupKey` persistence, grouped batch planning request creation, grouped planner context surfacing, and assistant multi-task planning follow-through.
- [x] Extend planning-request storage and reuse semantics with optional `groupKey` plus conflict checks.
- [x] Add `requestGoalPlanningBatch` and assistant `request_planning_batch` with deterministic local dependency mapping.
- [x] Surface planning groups through API/UI/context and verify with full checks plus local Bun API sanity checks.
