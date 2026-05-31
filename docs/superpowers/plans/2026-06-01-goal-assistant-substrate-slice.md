# Goal Assistant Substrate Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first Goal assistant substrate: durable `decisions.yml`, repo `preference.md`, Goal-scoped `assistant-thread.json`, planner context plumbing, and the minimum Bun API surface for those stores.

**Architecture:** Durable Goal docs stay file-native under `.hopi/docs/**`, assistant conversation state lives in `.hopi/runtime/**`, and planner context bundles are extended to include the new decision/preference inputs without changing scheduler workflow truth. The server exposes read/write routes for decisions and assistant-thread messages, but does not yet run a live assistant agent.

**Tech Stack:** Bun, TypeScript, zod, YAML, Bun test

---

### Task 1: Add Durable Decision And Preference Stores

**Files:**
- Modify: `packages/backend/src/storage/paths.ts`
- Create: `packages/backend/src/storage/decisionStore.ts`
- Create: `packages/backend/src/storage/preferenceStore.ts`
- Create: `packages/backend/tests/decisionStore.test.ts`
- Create: `packages/backend/tests/preferenceStore.test.ts`

- [ ] **Step 1: Write failing tests for missing-file bootstraps, persisted entries, and updates**
- [ ] **Step 2: Run `bun test tests/decisionStore.test.ts tests/preferenceStore.test.ts` and verify they fail**
- [ ] **Step 3: Implement the stores with file-native bootstraps and validation**
- [ ] **Step 4: Re-run `bun test tests/decisionStore.test.ts tests/preferenceStore.test.ts` and verify they pass**

### Task 2: Add Goal Assistant Thread Runtime Store

**Files:**
- Modify: `packages/backend/src/storage/paths.ts`
- Create: `packages/backend/src/runtime/assistantThreadStore.ts`
- Create: `packages/backend/tests/assistantThreadStore.test.ts`

- [ ] **Step 1: Write failing tests for empty thread reads and user/assistant entry appends**
- [ ] **Step 2: Run `bun test tests/assistantThreadStore.test.ts` and verify it fails**
- [ ] **Step 3: Implement the runtime overlay thread store**
- [ ] **Step 4: Re-run `bun test tests/assistantThreadStore.test.ts` and verify it passes**

### Task 3: Extend Planner Context Bundles

**Files:**
- Modify: `packages/backend/src/runtime/roleProcessContext.ts`
- Modify: `packages/backend/tests/roleProcessContext.test.ts`

- [ ] **Step 1: Write failing planner-context tests for `todo.yml`, `decisions.yml`, and `.hopi/preference.md` inputs**
- [ ] **Step 2: Run `bun test tests/roleProcessContext.test.ts` and verify the new assertions fail**
- [ ] **Step 3: Wire the new stores and file paths into planner context generation**
- [ ] **Step 4: Re-run `bun test tests/roleProcessContext.test.ts` and verify it passes**

### Task 4: Add Minimum Assistant/Decision API Surface

**Files:**
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/tests/server.test.ts`

- [ ] **Step 1: Write failing API tests for reading decisions, resolving decisions, reading assistant thread, and posting a user message**
- [ ] **Step 2: Run `bun test tests/server.test.ts` and verify the new tests fail**
- [ ] **Step 3: Implement the routes on top of the new stores**
- [ ] **Step 4: Re-run `bun test tests/server.test.ts` and verify it passes**

### Task 5: Update Docs And Verify

**Files:**
- Modify: `docs/agent-handoff.md`
- Modify: `README.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Update handoff/docs to describe the Goal assistant substrate slice and the remaining live-assistant gap**
- [ ] **Step 2: Run `bun run check` from the repo root**
- [ ] **Step 3: Confirm the new storage, context, and API coverage are all represented in tests**
