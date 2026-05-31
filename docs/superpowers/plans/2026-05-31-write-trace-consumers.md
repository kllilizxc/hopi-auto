# Write Trace Consumers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add filtered write-trace reads, trace-aware context assembly, and API/UI surfacing for durable write traces.

**Architecture:** The write-trace store gains Goal-scoped filtered reads. Role-process context assembly pulls recent traces for the same run/task and writes them into `context.md`. The Bun API exposes filtered trace reads, and the existing Bun UI fetches run-scoped traces to render selected-step write evidence without moving trace truth out of docs.

**Tech Stack:** Bun, TypeScript, `bun:test`, Bun UI HTML import, existing write-trace store, existing role-process context builder, Biome.

---

### Task 1: Add Filtered Write Trace Reads

**Files:**
- Modify: `packages/backend/src/runtime/writeTraceStore.ts`
- Test: `packages/backend/tests/writeTraceStore.test.ts`

- [ ] **Step 1: Write failing tests for filtered, newest-first write-trace reads**
- [ ] **Step 2: Run `bun test tests/writeTraceStore.test.ts` and confirm failure**
- [ ] **Step 3: Implement filtered trace queries**
- [ ] **Step 4: Re-run `bun test tests/writeTraceStore.test.ts` and confirm pass**

### Task 2: Make Context Bundles Trace-Aware

**Files:**
- Modify: `packages/backend/src/runtime/roleProcessContext.ts`
- Modify: `packages/backend/src/runtime/writeTraceStore.ts`
- Test: `packages/backend/tests/roleProcessContext.test.ts`

- [ ] **Step 1: Write failing tests for including relevant earlier write traces in `context.md`**
- [ ] **Step 2: Run `bun test tests/roleProcessContext.test.ts` and confirm failure**
- [ ] **Step 3: Implement trace-aware context assembly**
- [ ] **Step 4: Re-run `bun test tests/roleProcessContext.test.ts` and confirm pass**

### Task 3: Surface Write Traces Through API And UI

**Files:**
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/src/ui/main.ts`
- Modify: `packages/backend/src/ui/index.css`
- Modify: `packages/backend/tests/server.test.ts`
- Modify: `docs/agent-handoff.md`
- Modify: `README.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Write failing server tests for filtered write-trace API responses**
- [ ] **Step 2: Run `bun test tests/server.test.ts` and confirm failure**
- [ ] **Step 3: Implement the write-trace API route and UI rendering**
- [ ] **Step 4: Run `bun run check` and confirm all checks pass**
- [ ] **Step 5: Update handoff docs with trace-consumer status and the next remaining gaps**
