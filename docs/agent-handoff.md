# HOPI Agent Handoff

Status date: 2026-06-01

This document is the handoff entry point for an agent with no prior chat context.

## Current State

HOPI is being rebuilt as a Bun-first, file-native autonomous goal orchestration system.

Phase 1 backend is complete:

- The disposable prototype backend was replaced with a deterministic Bun core.
- The backend reads and mutates file-native goal boards.
- A single-step scheduler advances one deterministic unit per call.
- Goal-scoped runtime run/step/message history is now persisted under `.hopi/runtime/**`.
- The runner boundary now streams typed runtime events into step history.
- A real `ProcessAgentRunner` and git `WorktreeManager` now exist behind that runner boundary.
- Goal-scoped durable `write-trace.jsonl` recording now exists for process-backed file writes.
- Configured planner / generator / reviewer / merger process adapters now exist through repo-local adapter config and typed outcome files.
- Built-in vendor transport adapters now exist for Codex, Claude Code, and OpenCode, backed by durable per-step `prompt.md` bundles.
- Built-in vendor transports now normalize machine-readable CLI output into structured step transcripts instead of storing raw vendor JSON lines.
- Deterministic merger execution now performs real git merge completion and settled-run cleanup.
- Durable write traces are now queryable, injected into relevant role context bundles, and surfaced through the Bun API and UI.
- Reviewer and merger prompts now apply explicit write-trace evidence policy, including engineering evidence-gap guidance when no durable traces exist.
- The first Goal assistant substrate slice is now implemented with durable `decisions.yml`, repo `preference.md`, Goal-scoped `assistant-thread.json`, planner-context plumbing for decisions/preferences, and minimum Bun API routes for those stores.
- Live Goal assistant execution is now implemented with an explicit Goal-scoped runtime call, constrained durable actions, assistant run bundles under `.hopi/runtime/**`, and scheduler cleanup for resolved decision blockers.
- Goal assistant inspection APIs and Bun UI surfacing are now implemented for assistant prompts, decision/thread viewing, assistant run summaries, and assistant run detail inspection.
- Exact assistant bundle inspection is now implemented on the Bun product path for `context.md`, `prompt.md`, `outcome.json`, and `result.json`.
- Repo preference editing is now implemented on the active Bun API/UI path, and assistant now supports structured `request_planning` and `record_preference` actions.
- Assistant can now explicitly request decision topics, and the Bun product path now supports direct decision creation and resolution with visible blocker linking.
- Decision resolution now clears linked visible blockers immediately, and the Bun UI now exposes an explicit `Reconcile Once` control for one deterministic scheduler step.
- Resolving a decision that was blocking engineering work now creates or reuses visible planner follow-through, rewires engineering blockers onto that planning task, and lets richer later planning requests upgrade the generic follow-through instead of duplicating it.
- Goal docs are now inspectable through the Bun API/UI with deterministic `bootstrapped` versus `curated` status, and planner prompts now apply explicit doc-status follow-through policy for durable `design.md`.
- Durable `planning-requests.yml` now exists as the planner follow-through input surface: assistant and API can open file-native planning requests linked to visible planning tasks, planner context consumes them, the Bun UI surfaces them, and planning task completion auto-resolves linked requests deterministically.
- Durable planning requests now also carry decision lineage plus explicit `design.md` / `todo.yml` update targets, and reused open requests preserve newer follow-through metadata instead of dropping it.
- Planning follow-through now computes requested-update coverage from open requests plus durable write traces, surfaces that coverage in planning contexts, and deterministically sends planning review/merge work back to `planned` when explicit requested updates still lack durable evidence.
- Opening a visible decision blocker for a planning task now also enriches any existing open planning request on that task with the decision key, and defaults missing requested-update targets to `design.md` plus `todo.yml`.
- Reviewer and merger prompts now correlate prior run history, artifact refs, transcript evidence, and durable write traces instead of relying on write-trace policy alone.
- Planning reviewer and merger prompts now also enforce durable follow-through evidence against open planning requests, planning write traces, and prior run evidence.
- The Bun backend now serves the active Bun UI at `/`.
- Deeper planner/runtime behavior still remains intentionally out of scope for the current implementation slice.

Use this command before and after backend work:

```sh
bun run check
```

Expected result: backend typecheck, Biome, and Bun tests pass.

## Authoritative Documents

Read these first:

- `README.md`: repo entry point and common commands.
- `docs/agent-handoff.md`: current state, guardrails, and next work.
- `docs/hopi-phase-1-authority.md`: canonical Phase 1 schema and runtime boundary.
- `docs/superpowers/plans/2026-05-31-hopi-takeover-stabilization-plan.md`: completed Phase 1 execution plan and rationale.
- `docs/superpowers/specs/2026-06-01-live-goal-assistant-execution-design.md`: current authority note for explicit Goal assistant execution.
- `docs/superpowers/specs/2026-06-01-goal-assistant-surfacing-and-inspection-design.md`: current authority note for assistant inspection APIs and Bun UI surfacing.
- `docs/superpowers/specs/2026-06-01-assistant-run-bundle-inspection-design.md`: current authority note for exact assistant bundle inspection on the Bun product path.
- `docs/superpowers/specs/2026-06-01-goal-assistant-preferences-and-planning-request-design.md`: current authority note for repo preference editing and safer assistant planning/preference actions.
- `docs/superpowers/specs/2026-06-01-goal-assistant-decision-requests-and-management-design.md`: current authority note for assistant decision requests and direct decision management.
- `docs/superpowers/specs/2026-06-01-decision-resolution-follow-through-and-reconcile-controls-design.md`: current authority note for immediate decision-unblock follow-through and explicit reconcile controls.
- `docs/superpowers/specs/2026-06-01-write-trace-aware-review-and-merge-policy-design.md`: current authority note for trace-aware reviewer/merger prompt policy.
- `docs/superpowers/specs/2026-06-01-goal-docs-inspection-and-planner-doc-status-design.md`: current authority note for Goal doc inspection and planner durable doc-status policy.
- `docs/superpowers/specs/2026-06-01-durable-planning-requests-and-planner-follow-through-design.md`: current authority note for durable planning requests and deterministic planner follow-through.
- `docs/superpowers/specs/2026-06-01-decision-linked-planning-follow-through-design.md`: current authority note for decision-linked planning requests and explicit `design.md` / `todo.yml` follow-through targets.
- `docs/superpowers/specs/2026-06-01-planning-update-coverage-validation-design.md`: current authority note for requested-update coverage surfacing and scheduler hard guards on planning follow-through.
- `docs/superpowers/specs/2026-06-01-decision-driven-planning-request-enrichment-design.md`: current authority note for enriching open planning requests when visible decision blockers are opened for planning tasks.
- `docs/superpowers/specs/2026-06-01-decision-resolution-planner-follow-through-design.md`: current authority note for routing resolved engineering decisions through visible planner follow-through before engineering resumes.
- `docs/superpowers/specs/2026-06-01-run-history-and-artifact-aware-review-merge-policy-design.md`: current authority note for run-history and artifact-aware reviewer/merger policy.
- `docs/superpowers/specs/2026-06-01-planning-follow-through-review-merge-policy-design.md`: current authority note for planning follow-through reviewer/merger policy.

Historical reference only:

- `docs/hopi-goal-kanban-assistant-unified-design.md`
- `docs/hopi-multi-agent-architecture.md`
- `docs/hopi-multi-agent-implementation-plan.md`

Those historical docs contain old prototype concepts. Do not implement from them unless a newer authority doc explicitly reintroduces a concept.

## Hard Constraints

- Use Bun by default.
- Use `Bun.serve()` for backend APIs.
- Do not add Express, CORS middleware, execa, Vite backend coupling, `todo.mjs`, or a project-local kanban CLI.
- Keep the design simple. Prefer one deterministic source of truth over duplicated state.
- Do not add short-term compatibility layers for deleted prototype fields.
- Keep commits small and verified.

Phase 1 task schema does not include:

- `candidate`
- `blocked` as a task status
- `dependencyTaskList`
- durable historical blockers in `todo.yml`

## Data Model

Goal board path:

```text
.hopi/docs/goals/<goalKey>/todo.yml
```

Audit event path:

```text
.hopi/docs/goals/<goalKey>/events.jsonl
```

Write trace path:

```text
.hopi/docs/goals/<goalKey>/write-trace.jsonl
```

Goal decision path:

```text
.hopi/docs/goals/<goalKey>/decisions.yml
```

Planning request path:

```text
.hopi/docs/goals/<goalKey>/planning-requests.yml
```

Repo preference path:

```text
.hopi/preference.md
```

Runtime overlay path:

```text
.hopi/runtime/**
```

Runtime files are ignored and may be regenerated.

Goal assistant thread path:

```text
.hopi/runtime/goals/<goalKey>/assistant-thread.json
```

Goal assistant run path:

```text
.hopi/runtime/goals/<goalKey>/assistant/runs/<assistantRunId>/
```

Canonical task shape:

```yaml
version: 1
goal:
  goalKey: example
  title: Example Goal
items:
  - ref: T-1
    kind: engineering
    status: planned
    title: Implement a backend task
    description: Make the behavior work.
    acceptanceCriteria:
      - The behavior is covered by tests.
    blockedBy: []
```

Task kinds:

- `planning`
- `engineering`

Task statuses:

- `planned`
- `in_progress`
- `in_review`
- `merging`
- `done`

Blocker kinds:

- `task`
- `decision`
- `merge_conflict`
- `intervention`

Failure kinds:

- `agent_failed`
- `reviewer_rejected`
- `merge_conflict`
- `timeout`

`blockedBy` contains only current unresolved blockers. When a task blocker references a task that is now `done`, the scheduler removes that blocker and writes a `task_blocker_resolved` event.

When a decision blocker references a `decisionKey` that is resolved in `decisions.yml`, the scheduler removes that blocker and writes a `decision_blocker_resolved` event.

## Backend Modules

Current backend source:

- `packages/backend/src/domain/board.ts`: canonical task, blocker, status, failure, and event types.
- `packages/backend/src/domain/validation.ts`: YAML parsing, schema normalization, duplicate ref checks, missing task blocker checks, and task blocker cycle checks.
- `packages/backend/src/storage/paths.ts`: `.hopi` path construction.
- `packages/backend/src/storage/lock.ts`: file lock with same-process queue and stale lock handling.
- `packages/backend/src/storage/boardStore.ts`: atomic board reads, mutations, and event appends.
- `packages/backend/src/storage/decisionStore.ts`: durable Goal decision storage in `decisions.yml`.
- `packages/backend/src/storage/preferenceStore.ts`: bootstrap, persistence, and deduplicated durable preference recording for repo-level `preference.md`.
- `packages/backend/src/storage/planningRequestStore.ts`: durable Goal planning-request storage in `planning-requests.yml`.
- `packages/backend/src/runtime/assistantThreadStore.ts`: Goal-scoped assistant conversation overlay under `.hopi/runtime/**`.
- `packages/backend/src/runtime/decisionRequest.ts`: shared control-path helper for decision requests plus resolution-side visible blocker cleanup.
- `packages/backend/src/runtime/planningRequest.ts`: shared control-path helper for durable planning requests plus planning-task follow-through resolution.
- `packages/backend/src/assistant/goalAssistantContext.ts`: Goal-scoped assistant context and prompt bundle generation.
- `packages/backend/src/assistant/assistantRun.ts`: assistant run record types and validation.
- `packages/backend/src/assistant/assistantRunStore.ts`: read-side assistant run inspection store.
- `packages/backend/src/assistant/GoalAssistantRuntime.ts`: explicit Goal assistant execution runtime and constrained durable action application, including structured planning requests, decision requests, and preference recording.
- `packages/backend/src/runtime/attemptStore.ts`: ignored runtime attempt budget overlay.
- `packages/backend/src/runtime/runHistory.ts`: runtime run, step, message, and summary types.
- `packages/backend/src/runtime/runHistoryStore.ts`: Goal-scoped run history persistence under `.hopi/runtime/goals/<goalKey>/run-history.json`.
- `packages/backend/src/runtime/goalDocsStore.ts`: deterministic bootstrap plus inspectable `goal.md` / `design.md` content and `bootstrapped` versus `curated` status.
- `packages/backend/src/runtime/roleProcessContext.ts`: per-step `context.md` / `prompt.md` bundle generation with role-specific boundaries, planner durable-input plumbing for `todo.yml`, `decisions.yml`, `planning-requests.yml`, `.hopi/preference.md`, Goal doc status, and reviewer/merger evidence correlation across run history, artifact refs, transcript summaries, write traces, and planning follow-through requests.
- `packages/backend/src/runtime/worktreeManager.ts`: run-scoped git worktree preparation and cleanup.
- `packages/backend/src/runtime/gitMergeExecutor.ts`: deterministic git merge completion and settled-run cleanup for merger success paths.
- `packages/backend/src/runtime/writeTrace.ts`: durable write-trace types.
- `packages/backend/src/runtime/writeTraceStore.ts`: Goal-scoped append-only `write-trace.jsonl` storage.
- `packages/backend/src/runtime/writeTraceRecorder.ts`: process-focused file-change snapshot recorder for compact durable traces.
- `packages/backend/src/agent/AgentRunner.ts`: event-streaming execution adapter contract and scripted `MockAgentRunner`.
- `packages/backend/src/agent/ProcessAgentRunner.ts`: process-backed runner that can execute in the repo root or a prepared worktree and stream runtime evidence.
- `packages/backend/src/agent/ConfiguredRoleProcessRunner.ts`: repo-local role adapter config, placeholder substitution, context bundle wiring, and typed outcome ingestion.
- `packages/backend/src/agent/vendorTransport.ts`: built-in Codex / Claude / OpenCode transport config parsing and command resolution.
- `packages/backend/src/agent/vendorTranscript.ts`: built-in vendor stream normalization into structured transcript events.
- `packages/backend/src/scheduler/reconcileOnce.ts`: deterministic one-step scheduler.
- `packages/backend/src/server.ts`: Bun API, SSE endpoint, and Bun-served UI shell.
- `packages/backend/src/index.ts`: public exports.

Current backend tests:

- `packages/backend/tests/validation.test.ts`
- `packages/backend/tests/boardStore.test.ts`
- `packages/backend/tests/decisionStore.test.ts`
- `packages/backend/tests/attemptStore.test.ts`
- `packages/backend/tests/preferenceStore.test.ts`
- `packages/backend/tests/assistantThreadStore.test.ts`
- `packages/backend/tests/assistantRunStore.test.ts`
- `packages/backend/tests/runHistoryStore.test.ts`
- `packages/backend/tests/goalDocsStore.test.ts`
- `packages/backend/tests/planningRequestStore.test.ts`
- `packages/backend/tests/roleProcessContext.test.ts`
- `packages/backend/tests/agentRunner.test.ts`
- `packages/backend/tests/configuredRoleProcessRunner.test.ts`
- `packages/backend/tests/gitMergeExecutor.test.ts`
- `packages/backend/tests/processAgentRunner.test.ts`
- `packages/backend/tests/reconcileOnce.test.ts`
- `packages/backend/tests/server.test.ts`
- `packages/backend/tests/sampleGoals.test.ts`
- `packages/backend/tests/writeTraceStore.test.ts`
- `packages/backend/tests/worktreeManager.test.ts`

## Scheduler Rules

`reconcileOnce` performs at most one deterministic action per call.

Before dispatching work, it removes resolved task blockers:

```text
blockedBy.kind == task and referenced task status == done
```

Then it selects the first unblocked dispatchable task and applies:

```text
planning/planned       -> planner   -> success: in_review
planning/in_review     -> reviewer  -> success: merging, reject: planned
planning/merging       -> merger    -> success: done
engineering/planned    -> generator -> success: in_review
engineering/in_review  -> reviewer  -> success: merging, reject: planned
engineering/merging    -> merger    -> success: done, merge_conflict: planned until budget exhausted
```

During a runner call, the task is temporarily persisted as `in_progress`. After the runner returns, the scheduler persists the final status.

Failure attempt budgets are stored in `.hopi/runtime/attempts.json` with keys like:

```json
{
  "T-1:merge_conflict": 2
}
```

When a failure kind reaches the max attempt budget:

- `merge_conflict` writes `blockedBy: [{ kind: "merge_conflict", ref: artifactRef }]`.
- Other failure kinds write `blockedBy: [{ kind: "intervention", ref: "<taskRef>:<failureKind>" }]`.

System errors are not task failures. Adapter, route, schema, or storage errors should be reported as system errors and must not become task blockers.

Run history is stored in:

```text
.hopi/runtime/goals/<goalKey>/run-history.json
```

Model rules:

- a run starts when a task leaves `planned`
- a step records one `planner` / `generator` / `reviewer` / `merger` dispatch
- a run stays `active` through successful review/merge progression
- a run ends as `retryable`, `blocked`, `completed`, or `system_error`
- step messages are runtime overlay only; they do not mutate workflow truth
- step transcripts carry normalized vendor execution semantics for built-in transports
- step execution evidence may include worktree metadata and artifact references

Runtime adapter events currently supported:

- `message`
- `transcript`
- `worktree_prepared`
- `artifact`

Planner context bundles now also receive these durable inputs:

- `goal.md`
- `design.md`
- current `todo.yml` content
- `decisions.yml`
- `.hopi/preference.md`
- relevant write traces

Configured role adapters live at:

```text
.hopi/runtime/agent-adapters.json
```

Context bundles live at:

```text
.hopi/runtime/goals/<goalKey>/runs/<runId>/<stepId>/
```

Model rules:

- `context.md` carries task, Goal, and boundary context into role processes
- `prompt.md` is the transport-facing execution prompt built from the current context bundle
- `outcome.json` lets reviewer and merger return typed outcomes on exit `0`
- `goal.md` and `design.md` are bootstrapped if missing before configured role execution

Built-in vendor transports now supported in `.hopi/runtime/agent-adapters.json`:

- `process`
- `codex`
- `claude`
- `opencode`

`agent-adapters.json` may now also include a top-level `assistant` transport config alongside `roles`.

Model rules:

- built-in vendor transports keep `outcome.json` as the deterministic workflow contract
- Codex and Claude transports pass `prompt.md` through stdin
- OpenCode transports pass prompt content as the final non-interactive message argument
- built-in vendor stdout is normalized into compact transcript entries before it reaches run history
- raw `process` transports remain available for repo-local custom adapters

Merger success paths now have deterministic backend post-processing:

- engineering merger success performs a real git merge from the run branch into the root repo
- merge conflicts abort the root merge and flow through the existing retry/budget path
- settled success paths clean the run worktree and disposable branch
- planning merger success can complete without a run branch

Durable write traces are stored in:

```text
.hopi/docs/goals/<goalKey>/write-trace.jsonl
```

Model rules:

- entries are compact append-only JSON lines
- entries summarize changed repo-relative paths without file contents
- write traces do not alter scheduler decisions or workflow truth
- the current recorder is process-backed and works for both root and worktree execution

## API

Start the backend:

```sh
cd packages/backend
bun run start
```

Expected startup line:

```text
[API] Server listening on http://localhost:3000
```

Routes:

```text
GET  /api/preferences
POST /api/preferences
GET  /api/goals/:goalKey/board
GET  /api/goals/:goalKey/docs
GET  /api/goals/:goalKey/planning-requests
POST /api/goals/:goalKey/planning-requests
GET  /api/goals/:goalKey/decisions
POST /api/goals/:goalKey/decisions
POST /api/goals/:goalKey/decisions/:decisionKey/resolve
GET  /api/goals/:goalKey/runs
GET  /api/goals/:goalKey/runs/:runId
GET  /api/goals/:goalKey/write-traces
GET  /api/goals/:goalKey/assistant/thread
GET  /api/goals/:goalKey/assistant/runs
GET  /api/goals/:goalKey/assistant/runs/:assistantRunId
GET  /api/goals/:goalKey/assistant/runs/:assistantRunId/bundle
POST /api/goals/:goalKey/assistant/messages
POST /api/goals/:goalKey/assistant/run
POST /api/goals/:goalKey/tasks
POST /api/goals/:goalKey/tasks/:taskRef/move
POST /api/goals/:goalKey/reconcile
GET  /api/events
GET  /
```

Default bootstrap note:

- `createServer()` now prefers `ConfiguredRoleProcessRunner` when `.hopi/runtime/agent-adapters.json` exists.
- If adapter config is absent, it still falls back to `MockAgentRunner`.

Create task request:

```json
{
  "ref": "T-1",
  "kind": "engineering",
  "title": "Implement atomic writes",
  "description": "Make writes safe.",
  "acceptanceCriteria": ["Concurrent writes are safe."],
  "blockedBy": []
}
```

Manual move request:

```json
{
  "status": "in_review",
  "reason": "manual transition"
}
```

## Frontend State

The active frontend is now served by the backend through a Bun HTML import at `/`.

Current UI capabilities:

- read-only board projection from `todo.yml`
- durable `goal.md` and `design.md` surfacing with `bootstrapped` versus `curated` status
- durable planning-request creation and surfacing linked to visible planning work
- decision-linked planning request surfacing with explicit `design.md` / `todo.yml` update targets
- deterministic planning follow-through coverage enforcement based on requested updates plus durable write traces
- automatic decision-to-planning enrichment for existing open planning requests on the same planning task
- run list for the current Goal
- step list for the selected run
- normalized transcript history for the selected step
- message history for the selected step
- structured step evidence for worktree path and artifact references when present
- selected-step durable write-trace rendering for run-scoped file-change evidence
- assistant prompt submission
- explicit one-step `Reconcile Once` control
- repo preference surfacing and editing
- direct decision topic creation and resolution
- decision topic surfacing
- assistant thread surfacing
- assistant run list, assistant run detail inspection, and exact bundle-file inspection for `context.md`, `prompt.md`, `outcome.json`, and `result.json`

Current non-UI Goal assistant substrate:

- durable Goal decisions in `decisions.yml`
- durable Goal planning requests in `planning-requests.yml`
- decision-linked planning request metadata for explicit `design.md` / `todo.yml` reshape intent
- shared decision-request flows that backfill planning request lineage and default requested updates when a planning task becomes visibly blocked by one decision
- durable repo preferences in `.hopi/preference.md`
- Goal-scoped assistant thread storage under `.hopi/runtime/**`
- deterministic Goal doc bootstrap plus status inspection for `goal.md` and `design.md`
- planner context wiring for Goal docs, decisions, planning requests, and preferences
- explicit Goal assistant execution with constrained durable actions, including `request_planning`, `request_decision`, and `record_preference`
- reviewer/merger context correlation across prior run history, artifact refs, transcript summaries, and write traces
- planning reviewer/merger follow-through policy grounded in planning requests and durable planning write traces
- scheduler hard guards that retry planning review/merge work when explicit requested updates still lack durable trace coverage

What is still missing:

- richer assistant action coverage beyond the current decision-linked planning/decision/preference loop, especially workflows that span more than one visible planning task or require deeper Goal doc maintenance
- deeper preference policy than the current deduplicated bullet recorder when that becomes product-relevant
- deeper vendor transcript/tool-result correlation only where it improves deterministic review/merge behavior

`packages/frontend` remains only as an archived prototype reference and is no longer the product path.

## Recommended Next Work

Next high-leverage phase:

1. Extend Goal assistant and planner/runtime behavior beyond the current automatic decision-to-planner follow-through loop, especially planner workflows after answers materially reshape `design.md` and `todo.yml`.
2. Add richer planner/runtime workflows on top of `goal.md`, `design.md`, `planning-requests.yml`, and the current deterministic scheduler core, now that planning follow-through carries explicit decision lineage, requested update targets, scheduler-enforced coverage checks, and automatic decision-to-request enrichment.
3. Deepen preference policy and assistant execution evidence policy where it improves deterministic operator visibility without introducing new workflow truth.
4. Refine vendor transcript normalization with deeper tool-result correlation only where it improves deterministic review/merge behavior.

Keep this out of the next phase unless explicitly requested:

- A complex queue service.
- A database.
- Compatibility with deleted prototype schema fields.

## Handoff Checklist

Before handing off again:

- Run `bun run check` from the repo root.
- Confirm `git status --short` is clean or explain every remaining change.
- Update this document if the current state, commands, or next work changed.
- Commit documentation updates after verification.
