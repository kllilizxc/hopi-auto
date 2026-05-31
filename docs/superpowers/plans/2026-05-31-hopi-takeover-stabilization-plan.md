# HOPI Takeover Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disposable prototype backend with a Bun-first deterministic core that can read, mutate, reconcile, and expose file-native HOPI goal boards without Express, Vite coupling, or real agent dependencies.

**Architecture:** `todo.yml` is the current workflow truth, `events.jsonl` is the audit trail, and `.hopi/runtime/**` is ignored runtime overlay. The backend exposes a small `Bun.serve()` API and a single-step scheduler; real LLM execution is outside this phase and represented by an injectable mock runner. The React/Vite frontend remains in the repository but is not part of the Phase 1 completion gate.

**Tech Stack:** Bun 1.3+, TypeScript, `bun:test`, `Bun.serve()`, `Bun.file`, `Bun.write`, `yaml`, `zod`, Biome.

---

## Phase 1 Authority

This plan is the execution authority for Phase 1. It intentionally supersedes prototype details in the current implementation and any older doc sections that still mention `candidate`, `blocked` as a task status, `dependencyTaskList`, Express, Vite-backed backend assumptions, or exit-code-only review.

The canonical product direction remains `docs/hopi-goal-kanban-assistant-unified-design.md`, but Phase 1 uses the simplified schema and scheduler rules below.

## Confirmed Design Decisions

- Bun-first is a hard constraint.
- Existing backend code is disposable prototype code; reuse only when it matches the target architecture.
- First delivery is a Bun-first minimal vertical core, not only a document.
- Real agents are not in Phase 1.
- `planner` is an agent role or pipeline contract, not a lane.
- `planned` is a task status.
- Task `kind` is durable task semantics: `planning` or `engineering`.
- All task kinds share the same statuses: `planned`, `in_progress`, `in_review`, `merging`, `done`.
- `candidate` is removed from Phase 1.
- `blocked` is removed from Phase 1 statuses.
- `blockedBy` replaces both `dependencyTaskList` and `blockers`.
- `blockedBy` contains only current unresolved blockers; resolved blockers are removed from `todo.yml`.
- Historical blockers are discoverable through `events.jsonl` and runtime artifacts, not kept on the current task.
- `blockedBy.kind` is `task`, `decision`, `merge_conflict`, or `intervention`.
- A `task` blocker is removed automatically once the referenced task is `done`.
- Planning tasks produce proposals; their reviewer and merger contracts differ from engineering tasks.
- Assistant can create planning work, inspect state, move existing work, and answer decisions; it does not directly author engineering task graphs.
- Engineering reviewer evaluates worktree diff, acceptance criteria, test result, and design context, not only an exit code.
- Merge conflicts are runtime attempt context until the automatic repair budget is exhausted.
- After merge conflict budget exhaustion, a `merge_conflict` blocker is written to `todo.yml`.
- Attempt budget is keyed by `taskRef + failureKind`.
- Task failures are `agent_failed`, `reviewer_rejected`, `merge_conflict`, and `timeout`.
- System errors are not task failures and do not mutate task status or `blockedBy`.
- System errors are written to `events.jsonl` with correlation details.
- Backend validation must pass `bun test`, `bun run typecheck`, and `bun run lint`.
- Root validation must be available through `bun run check`.
- Commits are made after each verified logical phase.

## Target Task Schema

```yaml
version: 1
goal:
  goalKey: example
  title: Example Goal
items:
  - ref: T-1
    kind: engineering
    status: planned
    title: Implement atomic todo writes
    description: Make writes safe under concurrent calls.
    acceptanceCriteria:
      - Concurrent writes do not corrupt todo.yml.
      - Every mutation appends events.jsonl.
    blockedBy:
      - kind: task
        ref: T-0
```

Type contract:

```ts
export const TASK_KINDS = ['planning', 'engineering'] as const
export const TASK_STATUSES = ['planned', 'in_progress', 'in_review', 'merging', 'done'] as const
export const BLOCKER_KINDS = ['task', 'decision', 'merge_conflict', 'intervention'] as const
export const FAILURE_KINDS = ['agent_failed', 'reviewer_rejected', 'merge_conflict', 'timeout'] as const
```

## Target API

```text
GET  /api/goals/:goalKey/board
POST /api/goals/:goalKey/tasks
POST /api/goals/:goalKey/tasks/:taskRef/move
POST /api/goals/:goalKey/reconcile
GET  /api/events
```

## File Structure

Create these backend modules:

- `packages/backend/src/domain/board.ts`: task, blocker, event, runtime, and scheduler result types.
- `packages/backend/src/domain/validation.ts`: zod schemas and YAML normalization.
- `packages/backend/src/storage/paths.ts`: root, goal, todo, event, lock, and runtime path helpers.
- `packages/backend/src/storage/lock.ts`: lock-file acquisition with retry and stale lock handling.
- `packages/backend/src/storage/boardStore.ts`: read, validate, write, mutate, and append event operations.
- `packages/backend/src/runtime/attemptStore.ts`: ignored runtime attempt overlay.
- `packages/backend/src/agent/AgentRunner.ts`: runner interface and mock runner.
- `packages/backend/src/scheduler/reconcileOnce.ts`: deterministic one-step scheduler.
- `packages/backend/src/server.ts`: Bun API/SSE server.
- `packages/backend/src/index.ts`: exports for tests and server startup.

Replace or remove these prototype files:

- `packages/backend/src/skills/kanban/yaml.ts`
- `packages/backend/src/skills/kanban/todo.mjs`
- `packages/backend/src/scheduler/GoalScheduler.ts`
- `packages/backend/src/agent/AgentDispatcher.ts`
- `packages/backend/src/worktree/WorktreeManager.ts`
- `packages/backend/src/test-utils/mock-agent.ts`

Create or replace these tests:

- `packages/backend/tests/validation.test.ts`
- `packages/backend/tests/boardStore.test.ts`
- `packages/backend/tests/reconcileOnce.test.ts`
- `packages/backend/tests/server.test.ts`

Modify these package and repo files:

- `package.json`
- `packages/backend/package.json`
- `packages/backend/tsconfig.json`
- `biome.json`
- `.gitignore`
- `README.md`

## Task 1: Document Phase 1 Authority

**Files:**
- Create: `docs/hopi-phase-1-authority.md`
- Modify: `README.md`

- [ ] **Step 1: Create the authority note**

Create `docs/hopi-phase-1-authority.md` with this content:

```markdown
# HOPI Phase 1 Authority

Phase 1 builds a Bun-first deterministic backend core for file-native HOPI goal boards.

The execution authority is `docs/superpowers/plans/2026-05-31-hopi-takeover-stabilization-plan.md`.

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
```

- [ ] **Step 2: Update README**

Replace the root `README.md` with:

```markdown
# hopi-claude

HOPI is a file-native autonomous goal orchestration prototype being rebuilt around a Bun-first deterministic core.

## Phase 1

The active execution plan is:

`docs/superpowers/plans/2026-05-31-hopi-takeover-stabilization-plan.md`

The Phase 1 authority note is:

`docs/hopi-phase-1-authority.md`

## Commands

Install dependencies:

```sh
bun install
```

Run the backend:

```sh
bun run dev:backend
```

Run all Phase 1 checks:

```sh
bun run check
```
```

- [ ] **Step 3: Commit**

Run:

```sh
git add docs/hopi-phase-1-authority.md README.md docs/superpowers/plans/2026-05-31-hopi-takeover-stabilization-plan.md
git commit -m "docs: define phase 1 takeover plan"
```

Expected: commit succeeds.

## Task 2: Normalize Package Scripts And Dependencies

**Files:**
- Modify: `package.json`
- Modify: `packages/backend/package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Update root scripts**

Set root `package.json` scripts to:

```json
{
  "dev:backend": "cd packages/backend && bun dev",
  "dev:frontend": "cd packages/frontend && bun dev",
  "dev": "bun run dev:backend & bun run dev:frontend",
  "check": "bun run check:backend",
  "check:backend": "cd packages/backend && bun run check"
}
```

- [ ] **Step 2: Update backend package**

Set `packages/backend/package.json` to:

```json
{
  "name": "hopi-agent-orchestrator",
  "module": "src/server.ts",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "bun run src/server.ts",
    "dev": "bun --watch src/server.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "check": "bun run typecheck && bun run lint && bun test",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "yaml": "^2.6.1",
    "zod": "^3.24.1"
  }
}
```

- [ ] **Step 3: Ignore runtime overlay**

Ensure `.gitignore` contains:

```gitignore
# HOPI runtime artifacts
.hopi/runtime/
.hopi/worktrees/
packages/backend/.hopi/
packages/backend/tests/tmp/
packages/backend/tests/shadow-project/.git/
packages/backend/tests/shadow-project/.hopi/runtime/
packages/backend/tests/shadow-project/.hopi/worktrees/
```

- [ ] **Step 4: Install**

Run:

```sh
bun install
```

Expected: `bun.lock` updates and no package manager other than Bun is used.

- [ ] **Step 5: Commit**

Run:

```sh
git add package.json packages/backend/package.json .gitignore bun.lock
git commit -m "chore: align backend with bun phase 1"
```

Expected: commit succeeds.

## Task 3: Implement Board Domain And Validation

**Files:**
- Create: `packages/backend/src/domain/board.ts`
- Create: `packages/backend/src/domain/validation.ts`
- Replace: `packages/backend/tests/validation.test.ts`

- [ ] **Step 1: Add domain types**

Create `packages/backend/src/domain/board.ts`:

```ts
export const TASK_KINDS = ['planning', 'engineering'] as const
export const TASK_STATUSES = ['planned', 'in_progress', 'in_review', 'merging', 'done'] as const
export const BLOCKER_KINDS = ['task', 'decision', 'merge_conflict', 'intervention'] as const
export const FAILURE_KINDS = ['agent_failed', 'reviewer_rejected', 'merge_conflict', 'timeout'] as const

export type TaskKind = (typeof TASK_KINDS)[number]
export type TaskStatus = (typeof TASK_STATUSES)[number]
export type BlockerKind = (typeof BLOCKER_KINDS)[number]
export type FailureKind = (typeof FAILURE_KINDS)[number]

export interface BlockerRef {
  kind: BlockerKind
  ref: string
}

export interface TaskItem {
  ref: string
  kind: TaskKind
  status: TaskStatus
  title: string
  description: string
  acceptanceCriteria: string[]
  blockedBy: BlockerRef[]
}

export interface TodoBoard {
  version: 1
  goal: {
    goalKey: string
    title: string
  }
  items: TaskItem[]
}

export interface BoardEvent {
  id: string
  timestamp: string
  writer: string
  action: string
  goalKey: string
  taskRef?: string
  reason?: string
  beforeStatus?: TaskStatus
  afterStatus?: TaskStatus
  systemError?: {
    kind: string
    message: string
    correlationId: string
  }
}
```

- [ ] **Step 2: Add validation**

Create `packages/backend/src/domain/validation.ts`:

```ts
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { BLOCKER_KINDS, TASK_KINDS, TASK_STATUSES, type TodoBoard } from './board'

const BlockerRefSchema = z.object({
  kind: z.enum(BLOCKER_KINDS),
  ref: z.string().min(1),
})

const TaskItemSchema = z.object({
  ref: z.string().min(1),
  kind: z.enum(TASK_KINDS),
  status: z.enum(TASK_STATUSES),
  title: z.string().min(1),
  description: z.string().default(''),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  blockedBy: z.array(BlockerRefSchema).default([]),
})

const TodoBoardSchema = z.object({
  version: z.literal(1).default(1),
  goal: z.object({
    goalKey: z.string().min(1),
    title: z.string().min(1),
  }),
  items: z.array(TaskItemSchema).default([]),
})

export function parseBoardYaml(source: string): TodoBoard {
  const raw = parse(source)
  return validateBoard(raw)
}

export function validateBoard(input: unknown): TodoBoard {
  const result = TodoBoardSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')
    throw new Error(`Invalid todo.yml format: ${issues}`)
  }

  const refs = new Set<string>()
  for (const item of result.data.items) {
    if (refs.has(item.ref)) {
      throw new Error(`Duplicate task ref found: ${item.ref}`)
    }
    refs.add(item.ref)
  }

  for (const item of result.data.items) {
    for (const blocker of item.blockedBy) {
      if (blocker.kind === 'task' && !refs.has(blocker.ref)) {
        throw new Error(`Task '${item.ref}' is blocked by unknown task '${blocker.ref}'`)
      }
    }
  }

  assertNoTaskBlockerCycles(result.data)
  return result.data
}

export function stringifyBoardYaml(board: TodoBoard): string {
  return stringify(validateBoard(board), { indent: 2 })
}

function assertNoTaskBlockerCycles(board: TodoBoard) {
  const byRef = new Map(board.items.map((item) => [item.ref, item]))

  const visit = (ref: string, path: string[]) => {
    if (path.includes(ref)) {
      throw new Error(`Task blocker cycle detected: ${[...path, ref].join(' -> ')}`)
    }

    const item = byRef.get(ref)
    if (!item) return

    for (const blocker of item.blockedBy) {
      if (blocker.kind === 'task') {
        visit(blocker.ref, [...path, ref])
      }
    }
  }

  for (const item of board.items) {
    visit(item.ref, [])
  }
}
```

- [ ] **Step 3: Add validation tests**

Create `packages/backend/tests/validation.test.ts` with tests for valid boards, duplicate refs, unknown task blockers, and task blocker cycles.

The cycle test data:

```ts
const board = {
  version: 1,
  goal: { goalKey: 'g', title: 'Goal' },
  items: [
    {
      ref: 'T-1',
      kind: 'engineering',
      status: 'planned',
      title: 'One',
      description: 'One',
      acceptanceCriteria: ['One passes'],
      blockedBy: [{ kind: 'task', ref: 'T-2' }],
    },
    {
      ref: 'T-2',
      kind: 'engineering',
      status: 'planned',
      title: 'Two',
      description: 'Two',
      acceptanceCriteria: ['Two passes'],
      blockedBy: [{ kind: 'task', ref: 'T-1' }],
    },
  ],
}
```

- [ ] **Step 4: Run tests**

Run:

```sh
cd packages/backend && bun test tests/validation.test.ts
```

Expected: validation tests pass.

- [ ] **Step 5: Commit**

Run:

```sh
git add packages/backend/src/domain packages/backend/tests/validation.test.ts
git commit -m "feat: define phase 1 board schema"
```

Expected: commit succeeds.

## Task 4: Implement Atomic Board Store And Events

**Files:**
- Create: `packages/backend/src/storage/paths.ts`
- Create: `packages/backend/src/storage/lock.ts`
- Create: `packages/backend/src/storage/boardStore.ts`
- Replace: `packages/backend/tests/boardStore.test.ts`

- [ ] **Step 1: Implement path helpers**

Path helpers must expose:

```ts
export interface ProjectPaths {
  rootDir: string
  goalDir(goalKey: string): string
  todoPath(goalKey: string): string
  eventsPath(goalKey: string): string
  lockPath(goalKey: string): string
  runtimeDir(): string
  attemptsPath(): string
}
```

- [ ] **Step 2: Implement lock helper**

Lock behavior:

```ts
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T>
```

Rules:

- create the lock file with exclusive create mode
- retry 8 times
- start at 25 ms delay
- double the delay on each retry
- remove stale locks older than 30 seconds
- always remove the lock after `fn` settles

- [ ] **Step 3: Implement board store**

Board store must expose:

```ts
export interface BoardStore {
  readBoard(goalKey: string): Promise<TodoBoard>
  mutateBoard(goalKey: string, writer: string, reason: string, mutate: (board: TodoBoard) => void): Promise<TodoBoard>
  appendEvent(goalKey: string, event: Omit<BoardEvent, 'id' | 'timestamp'>): Promise<BoardEvent>
}
```

Atomic write rules:

- write YAML to `${todoPath}.tmp.${crypto.randomUUID()}`
- replace the original with `rename`
- append one JSON object per line to `events.jsonl`
- create a skeleton board only when a mutation targets a missing goal

- [ ] **Step 4: Add tests**

Create tests that verify:

- missing board reads as empty board with the requested `goalKey`
- adding a task writes `todo.yml`
- every mutation appends an event
- concurrent mutations produce valid YAML and all tasks are present

- [ ] **Step 5: Run tests**

Run:

```sh
cd packages/backend && bun test tests/boardStore.test.ts
```

Expected: board store tests pass.

- [ ] **Step 6: Commit**

Run:

```sh
git add packages/backend/src/storage packages/backend/tests/boardStore.test.ts
git commit -m "feat: add atomic board store"
```

Expected: commit succeeds.

## Task 5: Implement Runtime Attempts

**Files:**
- Create: `packages/backend/src/runtime/attemptStore.ts`
- Replace: `packages/backend/tests/attemptStore.test.ts`

- [ ] **Step 1: Implement attempt store**

Attempt store API:

```ts
export interface AttemptStore {
  get(taskRef: string, failureKind: FailureKind): Promise<number>
  increment(taskRef: string, failureKind: FailureKind): Promise<number>
  reset(taskRef: string, failureKind: FailureKind): Promise<void>
}
```

Persistence format in `.hopi/runtime/attempts.json`:

```json
{
  "T-1:merge_conflict": 2,
  "T-2:reviewer_rejected": 1
}
```

- [ ] **Step 2: Add tests**

Verify:

- missing file returns zero attempts
- increment persists values
- reset removes the key
- different failure kinds do not share budget

- [ ] **Step 3: Run tests**

Run:

```sh
cd packages/backend && bun test tests/attemptStore.test.ts
```

Expected: attempt store tests pass.

- [ ] **Step 4: Commit**

Run:

```sh
git add packages/backend/src/runtime packages/backend/tests/attemptStore.test.ts
git commit -m "feat: add runtime attempt overlay"
```

Expected: commit succeeds.

## Task 6: Implement Agent Runner Interface

**Files:**
- Create: `packages/backend/src/agent/AgentRunner.ts`
- Replace: `packages/backend/tests/agentRunner.test.ts`

- [ ] **Step 1: Define runner contracts**

Runner contract:

```ts
export type AgentRole = 'planner' | 'generator' | 'reviewer' | 'merger'

export type AgentOutcome =
  | { kind: 'success'; artifactRef?: string }
  | { kind: 'reject'; artifactRef?: string; reason: string }
  | { kind: 'fail'; reason: string }
  | { kind: 'timeout'; reason: string }
  | { kind: 'merge_conflict'; artifactRef: string }

export interface AgentStepInput {
  goalKey: string
  taskRef: string
  taskKind: TaskKind
  role: AgentRole
}

export interface AgentRunner {
  run(input: AgentStepInput): Promise<AgentOutcome>
}
```

- [ ] **Step 2: Implement mock runner**

Mock runner behavior:

```ts
export class MockAgentRunner implements AgentRunner {
  constructor(private readonly plan: Record<string, AgentOutcome[]> = {}) {}
}
```

The mock runner consumes outcomes by `taskRef:role`. If no outcome is configured, return `{ kind: 'success' }`.

- [ ] **Step 3: Add tests**

Verify:

- default outcome is success
- configured outcomes are consumed in order
- reviewer reject returns `reject`
- merger conflict returns `merge_conflict`

- [ ] **Step 4: Run tests**

Run:

```sh
cd packages/backend && bun test tests/agentRunner.test.ts
```

Expected: agent runner tests pass.

- [ ] **Step 5: Commit**

Run:

```sh
git add packages/backend/src/agent/AgentRunner.ts packages/backend/tests/agentRunner.test.ts
git commit -m "feat: add mock agent runner contract"
```

Expected: commit succeeds.

## Task 7: Implement Single-Step Scheduler

**Files:**
- Create: `packages/backend/src/scheduler/reconcileOnce.ts`
- Replace: `packages/backend/tests/reconcileOnce.test.ts`

- [ ] **Step 1: Implement scheduler contract**

Scheduler API:

```ts
export interface ReconcileOptions {
  goalKey: string
  store: BoardStore
  attempts: AttemptStore
  runner: AgentRunner
  writer?: string
  maxAttempts?: number
}

export type ReconcileResult =
  | { kind: 'idle' }
  | { kind: 'advanced'; taskRef: string; from: TaskStatus; to: TaskStatus }
  | { kind: 'blocked'; taskRef: string; blocker: BlockerRef }

export async function reconcileOnce(options: ReconcileOptions): Promise<ReconcileResult>
```

- [ ] **Step 2: Implement resolved task blocker cleanup**

Before dispatching work, remove every `blockedBy` entry where:

```ts
blocker.kind === 'task' && referencedTask.status === 'done'
```

Append an event with:

```ts
action: 'task_blocker_resolved'
reason: `task:${blocker.ref}`
```

Return `{ kind: 'idle' }` after cleanup so each call performs one deterministic mutation.

- [ ] **Step 3: Implement dispatch rules**

Use this table:

```text
planning/planned       -> planner   -> success: in_review
planning/in_review     -> reviewer  -> success: merging, reject: planned
planning/merging       -> merger    -> success: done
engineering/planned    -> generator -> success: in_review
engineering/in_review  -> reviewer  -> success: merging, reject: planned
engineering/merging    -> merger    -> success: done, merge_conflict: planned until budget exhausted
```

Rules:

- skip tasks with non-empty `blockedBy`
- `in_progress` is used while a runner step is active inside a reconcile call
- persist the final status after the runner returns
- on `fail` increment `agent_failed`
- on `timeout` increment `timeout`
- on `reject` increment `reviewer_rejected`
- on `merge_conflict` increment `merge_conflict`
- if a failure kind reaches `maxAttempts`, write `blockedBy`
- `merge_conflict` budget exhaustion writes `{ kind: 'merge_conflict', ref: artifactRef }`
- other budget exhaustion writes `{ kind: 'intervention', ref: '<taskRef>:<failureKind>' }`

- [ ] **Step 4: Add scheduler tests**

Verify:

- task blocker cleanup removes resolved task blockers
- engineering task advances from `planned` to `in_review`
- engineering reviewer reject returns to `planned`
- reviewer reject budget exhaustion writes an intervention blocker
- merge conflict retries by returning to `planned`
- merge conflict budget exhaustion writes a merge conflict blocker
- planning task uses planner role from `planned`
- planning merge success marks task `done`

- [ ] **Step 5: Run tests**

Run:

```sh
cd packages/backend && bun test tests/reconcileOnce.test.ts
```

Expected: scheduler tests pass.

- [ ] **Step 6: Commit**

Run:

```sh
git add packages/backend/src/scheduler/reconcileOnce.ts packages/backend/tests/reconcileOnce.test.ts
git commit -m "feat: add deterministic reconcile step"
```

Expected: commit succeeds.

## Task 8: Implement Bun API And SSE

**Files:**
- Replace: `packages/backend/src/server.ts`
- Replace: `packages/backend/src/index.ts`
- Replace: `packages/backend/tests/server.test.ts`

- [ ] **Step 1: Export backend factory**

`packages/backend/src/index.ts` must export:

```ts
export { createServer } from './server'
export { createBoardStore } from './storage/boardStore'
export { createAttemptStore } from './runtime/attemptStore'
export { reconcileOnce } from './scheduler/reconcileOnce'
export { MockAgentRunner } from './agent/AgentRunner'
export type { TodoBoard, TaskItem, BlockerRef } from './domain/board'
```

- [ ] **Step 2: Implement Bun server**

`createServer` contract:

```ts
export interface ServerOptions {
  rootDir?: string
  port?: number
  runner?: AgentRunner
}

export function createServer(options?: ServerOptions): Server
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

Request body for task creation:

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

Request body for move:

```json
{
  "status": "in_review",
  "reason": "manual transition"
}
```

- [ ] **Step 3: Implement system error events**

On uncaught route errors:

- return HTTP 500
- append a `system_error` event when `goalKey` is known
- do not mutate `todo.yml`

- [ ] **Step 4: Add server tests**

Verify:

- `GET /api/goals/test/board` returns an empty board for a missing goal
- `POST /api/goals/test/tasks` creates a task
- `POST /api/goals/test/reconcile` advances a task
- invalid request bodies return HTTP 400
- system errors return HTTP 500 without task mutation

- [ ] **Step 5: Run tests**

Run:

```sh
cd packages/backend && bun test tests/server.test.ts
```

Expected: server tests pass.

- [ ] **Step 6: Commit**

Run:

```sh
git add packages/backend/src/server.ts packages/backend/src/index.ts packages/backend/tests/server.test.ts
git commit -m "feat: expose bun backend api"
```

Expected: commit succeeds.

## Task 9: Remove Prototype Backend Paths

**Files:**
- Delete: `packages/backend/src/skills/kanban/todo.mjs`
- Delete: `packages/backend/src/skills/kanban/yaml.ts`
- Delete: `packages/backend/src/scheduler/GoalScheduler.ts`
- Delete: `packages/backend/src/agent/AgentDispatcher.ts`
- Delete: `packages/backend/src/worktree/WorktreeManager.ts`
- Delete: `packages/backend/src/test-utils/mock-agent.ts`
- Delete: `packages/backend/tests/run-shadow-test.ts`
- Delete: `packages/backend/tests/scheduler.test.ts`

- [ ] **Step 1: Delete prototype files**

Remove the files listed above after the replacement modules and tests are passing.

- [ ] **Step 2: Search for forbidden backend imports**

Run:

```sh
rg -n "express|cors|execa|node .*todo\\.mjs|dependencyTaskList|status: 'blocked'|status: \"blocked\"|candidate" packages/backend
```

Expected: no matches in backend source or tests.

- [ ] **Step 3: Run backend check**

Run:

```sh
cd packages/backend && bun run check
```

Expected: typecheck, lint, and tests pass.

- [ ] **Step 4: Commit**

Run:

```sh
git add packages/backend
git commit -m "refactor: remove prototype backend orchestrator"
```

Expected: commit succeeds.

## Task 10: Final Root Verification

**Files:**
- Modify if needed: `README.md`

- [ ] **Step 1: Run root check**

Run:

```sh
bun run check
```

Expected: root check passes.

- [ ] **Step 2: Run backend server manually**

Run:

```sh
cd packages/backend && bun run start
```

Expected:

```text
[API] Server listening on http://localhost:3000
```

Stop the server after confirming startup.

- [ ] **Step 3: Commit verification doc updates**

If README command output changed, run:

```sh
git add README.md
git commit -m "docs: update phase 1 verification notes"
```

Expected: commit succeeds only if README changed.

## Self-Review

Spec coverage:

- Bun-first backend: covered by Tasks 2, 8, and 9.
- Minimal task schema: covered by Task 3.
- `blockedBy` current-only blockers: covered by Tasks 3 and 7.
- Resolved task blocker cleanup: covered by Task 7.
- Events and system errors: covered by Tasks 4 and 8.
- Runtime attempts: covered by Task 5.
- Mock agent only: covered by Task 6.
- Single-step scheduler: covered by Task 7.
- API/SSE vertical: covered by Task 8.
- Verification and commits: covered by each task and Task 10.

Placeholder scan:

- The plan uses exact file paths, command lines, schemas, API contracts, and expected outcomes.
- No task asks an implementer to invent unspecified status names, blocker kinds, or package scripts.

Type consistency:

- `TaskStatus`, `TaskKind`, `BlockerRef`, and `FailureKind` are defined once in `domain/board.ts`.
- `blockedBy` is used consistently; `blockers` and `dependencyTaskList` are not Phase 1 fields.
- `merge_conflict` appears both as failure kind and blocker kind, with the blocker written only after budget exhaustion.

