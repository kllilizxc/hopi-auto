# HOPI Phase 1 Authority

Phase 1 builds a Bun-first deterministic backend core for file-native HOPI goal boards.

Status: implemented and verified.

For zero-context handoff, start with `docs/agent-handoff.md`.

The completed execution plan is `docs/superpowers/plans/2026-05-31-hopi-takeover-stabilization-plan.md`.

## Phase 1 Schema

Tasks use:

- `kind`: `planning` or `engineering`
- `status`: `planned`, `in_progress`, `in_review`, `merging`, or `done`
- `blockedBy`: current unresolved blockers only

`candidate`, `blocked`, and `dependencyTaskList` are not part of the Phase 1 task schema.

## Runtime Boundary

`todo.yml` stores current workflow truth.
`events.jsonl` stores audit events.
`.hopi/runtime/**` stores ignored runtime overlay such as attempts and mock runner plans.

## Backend Constraint

The Phase 1 backend uses Bun APIs directly. Express and execa are not part of the target backend.

## Implemented Surface

- `packages/backend/src/domain/board.ts`
- `packages/backend/src/domain/validation.ts`
- `packages/backend/src/storage/boardStore.ts`
- `packages/backend/src/runtime/attemptStore.ts`
- `packages/backend/src/agent/AgentRunner.ts`
- `packages/backend/src/scheduler/reconcileOnce.ts`
- `packages/backend/src/server.ts`

Run `bun run check` from the repo root before handing work to another agent.
