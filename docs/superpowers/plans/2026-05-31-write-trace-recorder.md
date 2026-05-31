# Write Trace Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable Goal-scoped `write-trace.jsonl` recording for process-backed task execution.

**Architecture:** A `WriteTraceStore` appends compact JSONL entries under `.hopi/docs/goals/<goalKey>/write-trace.jsonl`. A process-focused recorder derives changed repo-relative paths from before/after filesystem snapshots, and `ProcessAgentRunner` invokes that recorder after command execution without changing scheduler workflow logic.

**Tech Stack:** Bun, TypeScript, `bun:test`, `Bun.spawn`, filesystem snapshots, Biome.

---

### Task 1: Add Durable Write Trace Storage

**Files:**
- Create: `packages/backend/src/runtime/writeTrace.ts`
- Create: `packages/backend/src/runtime/writeTraceStore.ts`
- Modify: `packages/backend/src/storage/paths.ts`
- Modify: `packages/backend/src/index.ts`
- Test: `packages/backend/tests/writeTraceStore.test.ts`

- [ ] **Step 1: Write failing tests for missing-trace reads and JSONL append/list behavior**
- [ ] **Step 2: Run `bun test tests/writeTraceStore.test.ts` and confirm failure**
- [ ] **Step 3: Implement the write-trace types and store**
- [ ] **Step 4: Re-run `bun test tests/writeTraceStore.test.ts` and confirm pass**

### Task 2: Record Process File Writes

**Files:**
- Create: `packages/backend/src/runtime/writeTraceRecorder.ts`
- Modify: `packages/backend/src/agent/ProcessAgentRunner.ts`
- Test: `packages/backend/tests/processAgentRunner.test.ts`

- [ ] **Step 1: Write failing tests for root-mode and worktree-mode write-trace recording**
- [ ] **Step 2: Run `bun test tests/processAgentRunner.test.ts` and confirm failure**
- [ ] **Step 3: Implement the process-focused write-trace recorder and runner integration**
- [ ] **Step 4: Re-run `bun test tests/processAgentRunner.test.ts` and confirm pass**

### Task 3: Wire The New Durable Trace Into Existing Surfaces

**Files:**
- Modify: `packages/backend/tests/reconcileOnce.test.ts`
- Modify: `packages/backend/tests/server.test.ts`
- Modify: `docs/agent-handoff.md`
- Modify: `README.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Extend integration tests to prove write-trace recording through existing scheduler/API contracts where useful**
- [ ] **Step 2: Run `bun run check` and confirm all checks pass**
- [ ] **Step 3: Update handoff docs with the new durable trace layer and the next remaining gaps**
