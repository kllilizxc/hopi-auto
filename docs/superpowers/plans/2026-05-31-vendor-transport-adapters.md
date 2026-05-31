# Vendor Transport Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add built-in Codex / Claude / OpenCode transport adapters on top of the configured role runner, with durable `prompt.md` bundles and stdin-capable process execution.

**Architecture:** The role context builder grows a transport-facing `prompt.md`, a new transport resolver translates explicit vendor configs into `ProcessAgentCommand`, and `ProcessAgentRunner` gains stdin support so vendor CLIs can run non-interactively without shell wrappers. The scheduler remains transport-agnostic and still consumes only typed `outcome.json`.

**Tech Stack:** Bun, TypeScript, Bun test, Bun.spawn, zod

---

### Task 1: Add Prompt Bundle Coverage

**Files:**
- Modify: `packages/backend/tests/roleProcessContext.test.ts`
- Modify: `packages/backend/src/runtime/roleProcessContext.ts`
- Modify: `packages/backend/src/runtime/goalDocsStore.ts` only if bundle docs need helper reuse

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `bun test tests/roleProcessContext.test.ts` and verify the new prompt-bundle assertion fails**
- [ ] **Step 3: Add `prompt.md` generation with an explicit `outcome.json` contract**
- [ ] **Step 4: Re-run `bun test tests/roleProcessContext.test.ts` and verify it passes**

### Task 2: Add Stdin Support to the Process Runner

**Files:**
- Modify: `packages/backend/tests/processAgentRunner.test.ts`
- Modify: `packages/backend/src/agent/ProcessAgentRunner.ts`

- [ ] **Step 1: Write the failing stdin test**
- [ ] **Step 2: Run `bun test tests/processAgentRunner.test.ts` and verify the new test fails**
- [ ] **Step 3: Add `stdin` support to `ProcessAgentCommand` and `ProcessAgentRunner`**
- [ ] **Step 4: Re-run `bun test tests/processAgentRunner.test.ts` and verify it passes**

### Task 3: Add Vendor Transport Command Resolution

**Files:**
- Create: `packages/backend/src/agent/vendorTransport.ts`
- Create: `packages/backend/tests/vendorTransport.test.ts`
- Modify: `packages/backend/src/agent/ConfiguredRoleProcessRunner.ts`

- [ ] **Step 1: Write failing command-resolution tests for `codex`, `claude`, and `opencode`**
- [ ] **Step 2: Run `bun test tests/vendorTransport.test.ts` and verify the tests fail**
- [ ] **Step 3: Implement transport schemas and deterministic command builders**
- [ ] **Step 4: Re-run `bun test tests/vendorTransport.test.ts` and verify it passes**

### Task 4: Prove a Built-In Transport End-to-End

**Files:**
- Modify: `packages/backend/tests/configuredRoleProcessRunner.test.ts`
- Modify: `packages/backend/src/agent/ConfiguredRoleProcessRunner.ts`
- Reuse: `packages/backend/src/runtime/roleProcessContext.ts`

- [ ] **Step 1: Write a failing configured-runner integration test using a mock `codex` binary**
- [ ] **Step 2: Run `bun test tests/configuredRoleProcessRunner.test.ts` and verify the new test fails**
- [ ] **Step 3: Wire the configured runner through the new transport resolver and prompt bundle**
- [ ] **Step 4: Re-run `bun test tests/configuredRoleProcessRunner.test.ts` and verify it passes**

### Task 5: Update Docs and Run Full Verification

**Files:**
- Modify: `docs/agent-handoff.md`
- Modify: `README.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Update the handoff/docs index to list the vendor transport slice and the new prompt bundle**
- [ ] **Step 2: Run `bun run check` from the repo root**
- [ ] **Step 3: Confirm the new tests cover stdin transport, prompt bundles, and built-in transport resolution**
