# Live Goal Assistant Execution Implementation Plan

Goal: add a real Goal assistant runtime on top of the existing substrate, with explicit execution, constrained durable actions, and scheduler-compatible decision resolution.

Architecture: Goal assistant is its own Goal-scoped runtime service. It reuses the transport config substrate and transcript normalizer, writes runtime files under `.hopi/runtime/goals/<goalKey>/assistant/runs/**`, and applies only a narrow local-doc action surface.

Tech Stack: Bun, TypeScript, zod, Bun test

Completed implementation tasks:

- [x] Extend decision storage to support stable custom `decisionKey` values.
- [x] Extend scheduler cleanup so resolved `decision` blockers are removed deterministically.
- [x] Add Goal assistant context/prompt/outcome/result bundle generation.
- [x] Add explicit Goal assistant runtime execution against repo-local assistant transport config.
- [x] Add constrained assistant actions for `move_task`, `create_planning_task`, `resolve_decision`, and `update_preference`.
- [x] Add `POST /api/goals/:goalKey/assistant/run`.
- [x] Verify the slice through direct store tests, scheduler tests, API tests, and full `bun run check`.
