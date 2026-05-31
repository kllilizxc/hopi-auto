# Run History And Bun UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Goal-scoped runtime run/step/message history overlay and replace the legacy frontend with a Bun-first read-only UI that can inspect that history.

**Architecture:** Runtime history stays in `.hopi/runtime/**` behind a dedicated store. `reconcileOnce` creates runs and steps as deterministic overlay state while the Bun API exposes list/detail routes. The legacy Vite prototype is replaced by a Bun HTML-import frontend served by the backend and focused on board plus run/step inspection.

**Tech Stack:** Bun, TypeScript, `bun:test`, `Bun.serve()`, React via Bun HTML imports, YAML, Zod, Biome.

---

### Task 1: Add Runtime History Types And Store

**Files:**
- Create: `packages/backend/src/runtime/runHistory.ts`
- Create: `packages/backend/src/runtime/runHistoryStore.ts`
- Modify: `packages/backend/src/storage/paths.ts`
- Test: `packages/backend/tests/runHistoryStore.test.ts`

- [ ] **Step 1: Write the failing store tests**

Cover:

- missing history reads as empty
- starting a run from `planned` creates a new run with one step
- appending a review or merge step reuses the active run
- closing a run records final state and messages

- [ ] **Step 2: Run the targeted test file and confirm failure**

Run:

```sh
cd packages/backend
bun test tests/runHistoryStore.test.ts
```

Expected: missing module or missing exported functions.

- [ ] **Step 3: Implement runtime history types and store**

Add:

- run terminal state model
- step outcome model
- Goal-scoped JSON persistence under `.hopi/runtime/goals/<goalKey>/run-history.json`
- lock-protected atomic writes

- [ ] **Step 4: Re-run the targeted store tests**

Run:

```sh
cd packages/backend
bun test tests/runHistoryStore.test.ts
```

Expected: PASS.

### Task 2: Integrate Runtime History Into Reconcile And API

**Files:**
- Modify: `packages/backend/src/scheduler/reconcileOnce.ts`
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/src/index.ts`
- Modify: `packages/backend/src/domain/board.ts`
- Test: `packages/backend/tests/reconcileOnce.test.ts`
- Test: `packages/backend/tests/server.test.ts`

- [ ] **Step 1: Extend reconcile tests first**

Cover:

- `planned` dispatch starts a new run and step
- `in_review` and `merging` append steps to the same run
- reject, merge conflict, and `done` close runs with the correct terminal state
- runner-thrown system errors close the active step/run without mutating task blockers

- [ ] **Step 2: Extend API tests first**

Cover:

- run list route returns summaries
- run detail route returns ordered steps and messages
- unknown run id returns 404

- [ ] **Step 3: Run the targeted tests and confirm failure**

Run:

```sh
cd packages/backend
bun test tests/reconcileOnce.test.ts tests/server.test.ts
```

Expected: assertions fail because runtime history is not written or exposed yet.

- [ ] **Step 4: Implement scheduler and API integration**

Add:

- history store wiring in `reconcileOnce`
- dispatch start/result/system-error messages
- new Bun routes for run list/detail

- [ ] **Step 5: Re-run the targeted tests**

Run:

```sh
cd packages/backend
bun test tests/reconcileOnce.test.ts tests/server.test.ts
```

Expected: PASS.

### Task 3: Replace The Legacy Frontend With A Bun UI

**Files:**
- Create: `packages/backend/src/ui/index.html`
- Create: `packages/backend/src/ui/main.tsx`
- Create: `packages/backend/src/ui/app.tsx`
- Create: `packages/backend/src/ui/index.css`
- Modify: `packages/backend/src/server.ts`
- Delete: `packages/frontend/src/*` as replaced by the new target architecture
- Modify: `package.json`
- Modify: `README.md`
- Test: `packages/backend/tests/server.test.ts`

- [ ] **Step 1: Add a failing server test for the UI shell**

Cover:

- `GET /` returns the Bun-served HTML UI instead of plain text

- [ ] **Step 2: Run the targeted test and confirm failure**

Run:

```sh
cd packages/backend
bun test tests/server.test.ts
```

Expected: the root route still returns the old plain-text response.

- [ ] **Step 3: Build the Bun HTML-import UI**

Implement:

- board fetch
- run list fetch
- selected run + selected step behavior
- message history panel

- [ ] **Step 4: Remove legacy frontend wiring**

Update root scripts and docs so the project points only at the Bun-served UI.

- [ ] **Step 5: Re-run focused tests and a build-style verification**

Run:

```sh
cd packages/backend
bun test tests/server.test.ts
```

Expected: PASS.

### Task 4: Full Verification And Handoff Update

**Files:**
- Modify: `docs/agent-handoff.md`
- Modify: `README.md`

- [ ] **Step 1: Run the full project verification**

Run:

```sh
bun run check
```

Expected: all backend tests, typecheck, and lint pass.

- [ ] **Step 2: Update handoff docs to reflect the new current state**

Document:

- runtime history model
- API surface
- Bun UI status
- next remaining phases after this slice

