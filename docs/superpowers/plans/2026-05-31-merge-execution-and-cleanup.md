# Merge Execution And Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic git merge execution and settled-run cleanup on top of the existing typed merger adapter contract.

**Architecture:** A git merge executor derives the run-scoped source branch from `goalKey + taskRef + runId`, executes or skips the actual merge according to task kind and repo state, and performs worktree cleanup only on settled success paths. `reconcileOnce` invokes this executor when a merger step returns `success`, while existing retry/budget behavior continues to handle `merge_conflict`.

**Tech Stack:** Bun, TypeScript, `bun:test`, git CLI, existing `WorktreeManager`, existing scheduler/runtime stores, Biome.

---

### Task 1: Add A Deterministic Git Merge Executor

**Files:**
- Create: `packages/backend/src/runtime/gitMergeExecutor.ts`
- Modify: `packages/backend/src/storage/paths.ts` (only if a helper is needed)
- Modify: `packages/backend/src/index.ts`
- Test: `packages/backend/tests/gitMergeExecutor.test.ts`

- [ ] **Step 1: Write failing tests for engineering merge success, no-op success, conflict abort, and planning success**
- [ ] **Step 2: Run `bun test tests/gitMergeExecutor.test.ts` and confirm failure**
- [ ] **Step 3: Implement the git merge executor and cleanup policy**
- [ ] **Step 4: Re-run `bun test tests/gitMergeExecutor.test.ts` and confirm pass**

### Task 2: Wire Merge Execution Into Scheduler Flow

**Files:**
- Modify: `packages/backend/src/scheduler/reconcileOnce.ts`
- Modify: `packages/backend/tests/reconcileOnce.test.ts`

- [ ] **Step 1: Write failing scheduler tests for merger success performing a real merge before `done`**
- [ ] **Step 2: Run `bun test tests/reconcileOnce.test.ts` and confirm failure**
- [ ] **Step 3: Integrate merger post-processing with system-error vs merge-conflict handling preserved**
- [ ] **Step 4: Re-run `bun test tests/reconcileOnce.test.ts` and confirm pass**

### Task 3: Keep The Default Product Path Honest

**Files:**
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/tests/server.test.ts`
- Modify: `docs/agent-handoff.md`
- Modify: `README.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Extend integration tests to prove configured merger flows can complete real merge execution through the server path**
- [ ] **Step 2: Run `bun run check` and confirm all checks pass**
- [ ] **Step 3: Update handoff docs with settled merge execution and the next remaining gaps**
