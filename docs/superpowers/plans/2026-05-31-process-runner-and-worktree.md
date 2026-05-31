# Process Runner And Worktree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real git-worktree provisioning and a process-backed execution adapter that streams runtime output into the existing run-history model.

**Architecture:** A `WorktreeManager` provisions disposable run-scoped git worktrees under `.hopi/worktrees/**`. `ProcessAgentRunner` uses that manager plus `Bun.spawn` to execute local commands in either the repo root or the prepared worktree, and emits typed runtime events back through the existing scheduler observer contract.

**Tech Stack:** Bun, TypeScript, `bun:test`, `Bun.spawn`, git CLI, Biome.

---

### Task 1: Add A Real Worktree Manager

**Files:**
- Create: `packages/backend/src/runtime/worktreeManager.ts`
- Modify: `packages/backend/src/storage/paths.ts`
- Modify: `packages/backend/src/index.ts`
- Test: `packages/backend/tests/worktreeManager.test.ts`

- [ ] **Step 1: Write failing tests for worktree prepare and cleanup**
- [ ] **Step 2: Run `bun test tests/worktreeManager.test.ts` and confirm failure**
- [ ] **Step 3: Implement the git worktree manager**
- [ ] **Step 4: Re-run `bun test tests/worktreeManager.test.ts` and confirm pass**

### Task 2: Add A Process-Backed Agent Runner

**Files:**
- Create: `packages/backend/src/agent/ProcessAgentRunner.ts`
- Modify: `packages/backend/src/index.ts`
- Test: `packages/backend/tests/processAgentRunner.test.ts`

- [ ] **Step 1: Write failing tests for root-mode execution, worktree-mode execution, stdout/stderr streaming, and non-zero exit**
- [ ] **Step 2: Run `bun test tests/processAgentRunner.test.ts` and confirm failure**
- [ ] **Step 3: Implement the process-backed adapter**
- [ ] **Step 4: Re-run `bun test tests/processAgentRunner.test.ts` and confirm pass**

### Task 3: Wire The New Runtime Skeleton Into Existing Surfaces

**Files:**
- Modify: `packages/backend/tests/server.test.ts`
- Modify: `packages/backend/tests/reconcileOnce.test.ts`
- Modify: `docs/agent-handoff.md`
- Modify: `README.md`

- [ ] **Step 1: Extend integration tests to exercise the process-backed runner through existing contracts where useful**
- [ ] **Step 2: Run `bun run check` and confirm all checks pass**
- [ ] **Step 3: Update handoff docs with the new execution substrate and remaining gaps**
