# Vendor Transcript Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize built-in Codex / Claude / OpenCode output streams into compact structured step transcripts instead of storing opaque vendor JSON lines as messages.

**Architecture:** The process runner gains a transcript-format hint and emits normalized `transcript` runtime events using a focused vendor parser. Run history persists transcript entries alongside messages, the built-in transports opt into machine-readable output modes, and the Bun UI renders the transcript before the lower-level message stream.

**Tech Stack:** Bun, TypeScript, zod, Bun test, Bun.spawn

---

### Task 1: Add Transcript History Types

**Files:**
- Modify: `packages/backend/src/runtime/runHistory.ts`
- Modify: `packages/backend/src/runtime/runHistoryStore.ts`
- Modify: `packages/backend/tests/runHistoryStore.test.ts`

- [ ] **Step 1: Write the failing transcript-persistence test**
- [ ] **Step 2: Run `bun test tests/runHistoryStore.test.ts` and verify the new test fails**
- [ ] **Step 3: Add transcript entry types, schemas, and persistence wiring**
- [ ] **Step 4: Re-run `bun test tests/runHistoryStore.test.ts` and verify it passes**

### Task 2: Add Vendor Transcript Parsing

**Files:**
- Create: `packages/backend/src/agent/vendorTranscript.ts`
- Create: `packages/backend/tests/vendorTranscript.test.ts`
- Modify: `packages/backend/src/agent/AgentRunner.ts`

- [ ] **Step 1: Write failing parser tests for Codex, Claude, and OpenCode sample events**
- [ ] **Step 2: Run `bun test tests/vendorTranscript.test.ts` and verify the tests fail**
- [ ] **Step 3: Implement normalized transcript event parsing**
- [ ] **Step 4: Re-run `bun test tests/vendorTranscript.test.ts` and verify it passes**

### Task 3: Teach the Process Runner to Emit Transcript Events

**Files:**
- Modify: `packages/backend/src/agent/ProcessAgentRunner.ts`
- Modify: `packages/backend/tests/processAgentRunner.test.ts`
- Modify: `packages/backend/src/agent/vendorTransport.ts`
- Modify: `packages/backend/tests/vendorTransport.test.ts`

- [ ] **Step 1: Write failing tests for transcript-format-aware process execution**
- [ ] **Step 2: Run `bun test tests/processAgentRunner.test.ts tests/vendorTransport.test.ts` and verify the new assertions fail**
- [ ] **Step 3: Add transcript-format command hints and route stdout/stderr through the parser**
- [ ] **Step 4: Re-run `bun test tests/processAgentRunner.test.ts tests/vendorTransport.test.ts` and verify they pass**

### Task 4: Surface Transcripts Through API and UI

**Files:**
- Modify: `packages/backend/tests/server.test.ts`
- Modify: `packages/backend/src/ui/main.ts`
- Modify: `packages/backend/src/ui/index.css`

- [ ] **Step 1: Write a failing server test that expects normalized transcript entries on run detail**
- [ ] **Step 2: Run `bun test tests/server.test.ts` and verify the new test fails**
- [ ] **Step 3: Render transcript entries in the Bun UI using the existing run detail response**
- [ ] **Step 4: Re-run `bun test tests/server.test.ts` and verify it passes**

### Task 5: Update Handoff Docs and Verify

**Files:**
- Modify: `docs/agent-handoff.md`
- Modify: `README.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Update docs to mark transcript normalization complete and move the next phase forward**
- [ ] **Step 2: Run `bun run check` from the repo root**
- [ ] **Step 3: Confirm the new parser, runner, history, API, and UI coverage are all represented in tests**
