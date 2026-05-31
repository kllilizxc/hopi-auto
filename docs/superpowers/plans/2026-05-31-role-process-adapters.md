# Role Process Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable planner / generator / reviewer / merger process adapters with context bundle generation and typed outcome ingestion.

**Architecture:** A Goal docs helper bootstraps `goal.md` and `design.md`. A role-process runner reads `.hopi/runtime/agent-adapters.json`, materializes a per-step runtime bundle with `context.md` and `outcome.json`, resolves placeholders, and delegates execution to the existing `ProcessAgentRunner`. On successful exit, typed `outcome.json` can map review/merge work into `reject` or `merge_conflict` without changing scheduler control flow.

**Tech Stack:** Bun, TypeScript, `bun:test`, JSON files, markdown context bundles, `Bun.spawn`, Biome.

---

### Task 1: Add Goal Docs Bootstrap And Runtime Context Bundles

**Files:**
- Create: `packages/backend/src/runtime/goalDocsStore.ts`
- Create: `packages/backend/src/runtime/roleProcessContext.ts`
- Modify: `packages/backend/src/storage/paths.ts`
- Modify: `packages/backend/src/index.ts`
- Test: `packages/backend/tests/roleProcessContext.test.ts`

- [ ] **Step 1: Write failing tests for goal doc bootstrap and context bundle generation**
- [ ] **Step 2: Run `bun test tests/roleProcessContext.test.ts` and confirm failure**
- [ ] **Step 3: Implement goal doc bootstrap and context bundle generation**
- [ ] **Step 4: Re-run `bun test tests/roleProcessContext.test.ts` and confirm pass**

### Task 2: Add Configured Role Process Runner

**Files:**
- Create: `packages/backend/src/agent/ConfiguredRoleProcessRunner.ts`
- Modify: `packages/backend/src/agent/ProcessAgentRunner.ts`
- Modify: `packages/backend/src/index.ts`
- Test: `packages/backend/tests/configuredRoleProcessRunner.test.ts`
- Test: `packages/backend/tests/processAgentRunner.test.ts`

- [ ] **Step 1: Write failing tests for config loading, placeholder substitution, and typed outcome ingestion**
- [ ] **Step 2: Run `bun test tests/configuredRoleProcessRunner.test.ts tests/processAgentRunner.test.ts` and confirm failure**
- [ ] **Step 3: Implement the configured role-process runner and structured outcome parsing**
- [ ] **Step 4: Re-run `bun test tests/configuredRoleProcessRunner.test.ts tests/processAgentRunner.test.ts` and confirm pass**

### Task 3: Wire Configured Adapters Into Default Server Startup

**Files:**
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/tests/server.test.ts`
- Modify: `packages/backend/tests/reconcileOnce.test.ts`
- Modify: `docs/agent-handoff.md`
- Modify: `README.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Extend integration tests to prove configured adapters become the default runner when config exists**
- [ ] **Step 2: Run `bun run check` and confirm all checks pass**
- [ ] **Step 3: Update handoff docs with the new default adapter path and remaining gaps**
