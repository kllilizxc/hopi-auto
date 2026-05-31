# HOPI Agent Handoff

Status date: 2026-05-31

This document is the handoff entry point for an agent with no prior chat context.

## Current State

HOPI is being rebuilt as a Bun-first, file-native autonomous goal orchestration system.

Phase 1 backend is complete:

- The disposable prototype backend was replaced with a deterministic Bun core.
- The backend reads and mutates file-native goal boards.
- A single-step scheduler advances one deterministic unit per call.
- Real LLM agents and worktree merging are intentionally out of scope for Phase 1.
- The React/Vite frontend remains in the repo as legacy prototype code and is not part of the current verification gate.

Use this command before and after backend work:

```sh
bun run check
```

Expected result: backend typecheck, Biome, and Bun tests pass.

## Authoritative Documents

Read these first:

- `README.md`: repo entry point and common commands.
- `docs/agent-handoff.md`: current state, guardrails, and next work.
- `docs/hopi-phase-1-authority.md`: canonical Phase 1 schema and runtime boundary.
- `docs/superpowers/plans/2026-05-31-hopi-takeover-stabilization-plan.md`: completed Phase 1 execution plan and rationale.

Historical reference only:

- `docs/hopi-goal-kanban-assistant-unified-design.md`
- `docs/hopi-multi-agent-architecture.md`
- `docs/hopi-multi-agent-implementation-plan.md`

Those historical docs contain old prototype concepts. Do not implement from them unless a newer authority doc explicitly reintroduces a concept.

## Hard Constraints

- Use Bun by default.
- Use `Bun.serve()` for backend APIs.
- Do not add Express, CORS middleware, execa, Vite backend coupling, `todo.mjs`, or a project-local kanban CLI.
- Keep the design simple. Prefer one deterministic source of truth over duplicated state.
- Do not add short-term compatibility layers for deleted prototype fields.
- Keep commits small and verified.

Phase 1 task schema does not include:

- `candidate`
- `blocked` as a task status
- `dependencyTaskList`
- durable historical blockers in `todo.yml`

## Data Model

Goal board path:

```text
.hopi/docs/goals/<goalKey>/todo.yml
```

Audit event path:

```text
.hopi/docs/goals/<goalKey>/events.jsonl
```

Runtime overlay path:

```text
.hopi/runtime/**
```

Runtime files are ignored and may be regenerated.

Canonical task shape:

```yaml
version: 1
goal:
  goalKey: example
  title: Example Goal
items:
  - ref: T-1
    kind: engineering
    status: planned
    title: Implement a backend task
    description: Make the behavior work.
    acceptanceCriteria:
      - The behavior is covered by tests.
    blockedBy: []
```

Task kinds:

- `planning`
- `engineering`

Task statuses:

- `planned`
- `in_progress`
- `in_review`
- `merging`
- `done`

Blocker kinds:

- `task`
- `decision`
- `merge_conflict`
- `intervention`

Failure kinds:

- `agent_failed`
- `reviewer_rejected`
- `merge_conflict`
- `timeout`

`blockedBy` contains only current unresolved blockers. When a task blocker references a task that is now `done`, the scheduler removes that blocker and writes a `task_blocker_resolved` event.

## Backend Modules

Current backend source:

- `packages/backend/src/domain/board.ts`: canonical task, blocker, status, failure, and event types.
- `packages/backend/src/domain/validation.ts`: YAML parsing, schema normalization, duplicate ref checks, missing task blocker checks, and task blocker cycle checks.
- `packages/backend/src/storage/paths.ts`: `.hopi` path construction.
- `packages/backend/src/storage/lock.ts`: file lock with same-process queue and stale lock handling.
- `packages/backend/src/storage/boardStore.ts`: atomic board reads, mutations, and event appends.
- `packages/backend/src/runtime/attemptStore.ts`: ignored runtime attempt budget overlay.
- `packages/backend/src/agent/AgentRunner.ts`: injectable runner interface and `MockAgentRunner`.
- `packages/backend/src/scheduler/reconcileOnce.ts`: deterministic one-step scheduler.
- `packages/backend/src/server.ts`: Bun API and SSE endpoint.
- `packages/backend/src/index.ts`: public exports.

Current backend tests:

- `packages/backend/tests/validation.test.ts`
- `packages/backend/tests/boardStore.test.ts`
- `packages/backend/tests/attemptStore.test.ts`
- `packages/backend/tests/agentRunner.test.ts`
- `packages/backend/tests/reconcileOnce.test.ts`
- `packages/backend/tests/server.test.ts`

## Scheduler Rules

`reconcileOnce` performs at most one deterministic action per call.

Before dispatching work, it removes resolved task blockers:

```text
blockedBy.kind == task and referenced task status == done
```

Then it selects the first unblocked dispatchable task and applies:

```text
planning/planned       -> planner   -> success: in_review
planning/in_review     -> reviewer  -> success: merging, reject: planned
planning/merging       -> merger    -> success: done
engineering/planned    -> generator -> success: in_review
engineering/in_review  -> reviewer  -> success: merging, reject: planned
engineering/merging    -> merger    -> success: done, merge_conflict: planned until budget exhausted
```

During a runner call, the task is temporarily persisted as `in_progress`. After the runner returns, the scheduler persists the final status.

Failure attempt budgets are stored in `.hopi/runtime/attempts.json` with keys like:

```json
{
  "T-1:merge_conflict": 2
}
```

When a failure kind reaches the max attempt budget:

- `merge_conflict` writes `blockedBy: [{ kind: "merge_conflict", ref: artifactRef }]`.
- Other failure kinds write `blockedBy: [{ kind: "intervention", ref: "<taskRef>:<failureKind>" }]`.

System errors are not task failures. Adapter, route, schema, or storage errors should be reported as system errors and must not become task blockers.

## API

Start the backend:

```sh
cd packages/backend
bun run start
```

Expected startup line:

```text
[API] Server listening on http://localhost:3000
```

Routes:

```text
GET  /api/goals/:goalKey/board
POST /api/goals/:goalKey/tasks
POST /api/goals/:goalKey/tasks/:taskRef/move
POST /api/goals/:goalKey/reconcile
GET  /api/events
GET  /
```

Create task request:

```json
{
  "ref": "T-1",
  "kind": "engineering",
  "title": "Implement atomic writes",
  "description": "Make writes safe.",
  "acceptanceCriteria": ["Concurrent writes are safe."],
  "blockedBy": []
}
```

Manual move request:

```json
{
  "status": "in_review",
  "reason": "manual transition"
}
```

## Frontend State

`packages/frontend` is still a legacy Vite prototype. Do not treat it as the target architecture.

For the next frontend pass, prefer a Bun HTML-import frontend served by the backend or another explicitly approved Bun-first arrangement. The UI should preserve the confirmed product need: users must be able to switch between steps/runs and inspect the message history for that selected step.

## Recommended Next Work

Next high-leverage phase:

1. Add a minimal run/step history model for `planner -> generator -> reviewer -> merger -> planner` loops.
2. Persist enough step metadata for the frontend to switch selected step and display messages for that step.
3. Rebuild or replace the legacy frontend against the Bun API and the new step-history model.

Keep this out of the next phase unless explicitly requested:

- Real LLM agent adapters.
- Real git worktree merge automation.
- A complex queue service.
- A database.
- Compatibility with deleted prototype schema fields.

## Handoff Checklist

Before handing off again:

- Run `bun run check` from the repo root.
- Confirm `git status --short` is clean or explain every remaining change.
- Update this document if the current state, commands, or next work changed.
- Commit documentation updates after verification.
