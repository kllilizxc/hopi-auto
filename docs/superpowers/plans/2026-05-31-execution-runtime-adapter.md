# Execution Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the thin final-outcome runner boundary with an event-streaming execution adapter contract that can feed richer runtime evidence into Goal run history.

**Architecture:** The scheduler still decides workflow transitions, but adapters can now emit typed runtime events while a step is running. Runtime history stores these events as structured step evidence, and the scripted mock adapter exercises the same contract used by future real process-backed adapters.

**Tech Stack:** Bun, TypeScript, `bun:test`, `Bun.serve()`, YAML, Zod, Biome.

---

### Task 1: Extend Runtime History For Structured Step Evidence

**Files:**
- Modify: `packages/backend/src/runtime/runHistory.ts`
- Modify: `packages/backend/src/runtime/runHistoryStore.ts`
- Test: `packages/backend/tests/runHistoryStore.test.ts`

- [ ] **Step 1: Write failing tests for worktree and artifact evidence**
- [ ] **Step 2: Run `bun test tests/runHistoryStore.test.ts` and confirm failure**
- [ ] **Step 3: Implement structured step evidence storage**
- [ ] **Step 4: Re-run `bun test tests/runHistoryStore.test.ts` and confirm pass**

### Task 2: Replace The Thin Runner Contract With A Streaming Adapter Contract

**Files:**
- Modify: `packages/backend/src/agent/AgentRunner.ts`
- Modify: `packages/backend/tests/agentRunner.test.ts`

- [ ] **Step 1: Write failing tests for scripted runtime events and execution identifiers**
- [ ] **Step 2: Run `bun test tests/agentRunner.test.ts` and confirm failure**
- [ ] **Step 3: Implement the new adapter contract and scripted mock adapter**
- [ ] **Step 4: Re-run `bun test tests/agentRunner.test.ts` and confirm pass**

### Task 3: Stream Adapter Events Through The Scheduler

**Files:**
- Modify: `packages/backend/src/scheduler/reconcileOnce.ts`
- Modify: `packages/backend/tests/reconcileOnce.test.ts`
- Modify: `packages/backend/tests/server.test.ts`

- [ ] **Step 1: Write failing scheduler and API tests for streamed runtime evidence**
- [ ] **Step 2: Run `bun test tests/reconcileOnce.test.ts tests/server.test.ts` and confirm failure**
- [ ] **Step 3: Persist adapter events into run history while preserving existing workflow transitions**
- [ ] **Step 4: Re-run `bun test tests/reconcileOnce.test.ts tests/server.test.ts` and confirm pass**

### Task 4: Surface Step Evidence In The Bun UI And Handoff Docs

**Files:**
- Modify: `packages/backend/src/ui/main.ts`
- Modify: `docs/agent-handoff.md`
- Modify: `README.md`

- [ ] **Step 1: Render worktree and artifact evidence in the selected-step panel**
- [ ] **Step 2: Run `bun run check` and confirm all checks pass**
- [ ] **Step 3: Update docs to describe the new adapter boundary and next remaining phases**
