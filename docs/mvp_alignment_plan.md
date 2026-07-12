# HOPI MVP Implementation Alignment

Status: MVP implementation aligned; live end-to-end audit complete
Last updated: 2026-07-11

This ledger records implementation evidence for [the MVP design](./mvp_design.md). It is not a
second product or architecture authority. The design, document model, execution design, state
machine, and publish protocol win if this ledger conflicts with them.

## Completion Bar

Alignment is complete only when:

- Assistant, Project, and Goal are the only durable user concepts
- canonical home and Project packages validate entirely from documents
- one Coordinator and one global publication queue own canonical mutation
- the fixed Planner, Generator, Reviewer, and C1 flow advances active Goals automatically
- retry, revision, Attention, completion, notification, and crash boundaries match the authority
  documents
- HOPI never uses a user checkout as publication, integration, Preview, or repair state
- the UI is Assistant-first and its Kanban is a read-only Work projection
- the workspace Assistant is one persistent Codex conversation whose only canonical mutation path
  is validated HOPI tools
- responsibility Attempts preserve normalized events and the raw process stream, while state reads
  expose bounded diagnostics and their local paths
- meaningful state changes can run one interruptible read-only Reflection whose only possible effect
  is an internal handoff to the persistent Assistant conversation
- the one-way legacy import preserves supported history without retaining an old writable authority
- all repository checks and MVP acceptance suites pass

## Cutover Result

| Concern | Pre-MVP authority | MVP production authority | Verification |
| --- | --- | --- | --- |
| Project | user `rootDir` and mutable checkout | `home.yml`, `projects.yml`, `project.yml`, managed `hopi/release` worktree | dirty checkout and rebind tests |
| Goal | one mutable `todo.yml` board | bounded Goal package with one document per fact owner | schema, migration, and transition tests |
| Ordering | blockers, decisions, planning requests | permanent Engineering `dependsOn` plus singleton Planning guard | graph and readiness tests |
| Assistant | Goal thread, parsed `actions[]`, or stateless staged diffs | durable Inbox turns, persistent Codex thread, read-only Reflection, and validated HOPI tools | direct conversation, session resume, Reflection, tool, and recovery tests |
| Workflow | manual controls and hard-coded task lanes | one code-owned profile through generic `RoleRunner` | profile parity and end-to-end reconcile tests |
| Publication | direct writes and nested locks | OS instance lock, global mutex, one-gate `publish`, durable receipt and C1 ref | concurrency and fault-injection tests |
| Isolation | per-Run worktrees merged into user root | stable Work branch/worktree plus managed integration root | retry, migration rebuild, and checkout tests |
| Completion | lane exhaustion | final Planner proposal plus structural Goal gate | C1 and completion verifier tests |
| UI | React/Vite writable workflow screens | restored React package, Bun HTML import, Assistant, Goal design, read-only Kanban, Attention, Preview | frontend bundle and API smoke tests |
| Notification | deduplication concept only | canonical identity, `notifiedAt`, webhook, bounded runtime backoff | delivery and lost-ack tests |

## Current Alignment Delta

- [x] Preserve the raw stdout/stderr stream for every responsibility Attempt.
- [x] Return bounded Run/Attempt diagnostics and local log paths from HOPI state reads.
- [x] Add one coalesced, interruptible, read-only Reflection loop with an internal Inbox handoff.
- [x] Keep Reflection turns hidden unless the speaking thread explicitly promotes its reply.
- [x] Treat a newly queued same-Goal Planning Work as admission control instead of retroactively
  staling an already admitted Engineering result.
- [x] Treat non-active Goal lifecycle as both admission control and a Goal-scoped live-Run lease
  revocation rule.
- [x] Keep `hopi_read_state` bounded to current control facts and diagnostic paths; leave durable
  history in canonical documents and raw runtime files.
- [x] Normalize semantic-guard invalidation to one stale application even when detected before C1;
  never turn expected concurrency into Project Attention.
- [x] Anchor every speaking-thread state result to its immutable current Inbox event so a long-lived
  Codex session cannot substitute the prior turn after reading state.
- [x] Guard complete selected authority membership as well as existing file hashes, so additions
  during a Run cannot publish through an incomplete snapshot.
- [x] Stage only selected authority into Engineering context instead of exposing the entire Goal
  history to every responsibility pass.
- [x] Use one empty sparse proposal overlay for every responsibility; absent canonical paths remain
  unchanged instead of requiring Planner to mirror a complete candidate snapshot.
- [x] Give both Engineering responsibilities the same Run-scoped network execution needed for local
  implementation and verification while keeping Planner network-free.
- [x] Give Planner the compact canonical Work and Attention field shapes it may create, so it never
  searches other Goals or historical Runs merely to infer fixed frontmatter.
- [x] Treat Goal creation as admission of the current instruction plus initial Planning; a repeated
  idempotent request adds no canonical state and requires no tool-order state machine.
- [x] End the speaking turn after an asynchronous effect is admitted; never sleep or poll for later
  workflow state that Reflection already owns reporting.
- [x] Bind a Reflection completion handoff to its exact Goal Attention and acknowledge that canonical
  delivery only when the speaking thread exposes its reply.
- [x] Defer ordinary semantic changes while deterministic or responsibility progress remains; keep
  unnotified Attention, unavailable Project, and stale Run immediately Reflection-eligible.
- [x] Require the single Project Preview adapter to start from a clean managed integration worktree
  and emit its endpoint only when reachable; route dependency, timeout, and startup failures through
  ordinary Assistant repair.
- [x] Stop a running Preview after successful or recovered C1 integration, clear its obsolete
  endpoint, and leave restart as one explicit user action without affecting the durable C1 outcome.
- [x] Require the backend product route smoke to load every emitted frontend asset, not merely return
  an HTML shell.
- [x] Rerun backend, frontend, build, and production smoke checks.

## Implemented Slices

1. Assistant home initializes a stable `homeId`, links one Repo per Project, creates `hopi/release`,
   and keeps the user checkout untouched. Explicit rebind repairs moved Git worktree administration
   but refuses to reconstruct a missing canonical managed root.
2. `PublicationCoordinator` serializes snapshots and publications, validates the complete candidate,
   writes support before one gate, durably acknowledges Inbox receipt, and delegates C1 to a guarded
   durable Git ref boundary.
3. Canonical Goal, Work, Input, Attention, and Evidence documents enforce identity, revision,
   permanent dependencies, singleton Planning, retry, targeting, provenance, and completion rules.
4. The fixed profile runs immutable Planner, Generator, and Reviewer contexts through one
   `RoleRunner`; missing `AGENTS.md` is silent Planner bootstrap and Engineering Work keeps one stable
   branch and checkout.
5. Workspace Assistant preserves lossless Inbox turns without parsing reply prose or an Action
   object, resumes one persistent Codex thread, exposes validated HOPI tools through a single-turn
   MCP capability, and records normalized live messages, tool calls, results, and failures. One
   disposable read-only Reflection assesses coalesced state changes, can only hand an internal turn
   to that thread, and is interrupted by newer user input.
6. Reconciler derives readiness, runs passes within fixed capacity, rebuilds C1 over clean target
   advances, fails invalid projects closed, completes only from Planner proof, and delivers Attention
   through one optional webhook channel.
7. The restored React UI exposes Assistant, Project, Goal contract/design, Pause/Resume, Needs you,
   completion updates, four-column Kanban, cancelled archive, Project model defaults, Repo rebind,
   Work Attempt message streams, an on-demand Reflection debug stream, and managed-target Preview;
   Bun serves it through one backend process.
8. The old server, stores, Assistant Actions, decision/planning-request graph, merger, per-Run
   worktrees, Vite runtime, and writable legacy React screens are deleted. `todo.yml` and v1/v2
   adapter config remain read-only one-way migration inputs only.

## Acceptance Evidence

- autonomous Goal: `projectReconciler.test.ts`
- concurrent instructions and fixed capacities: `coordinatorReconciler.test.ts`
- Assistant direct conversation, session resume, live tool events, design-to-code choice:
  `workspaceAssistant.test.ts`, `assistantTools.test.ts`, `hopiMcpServer.test.ts`, and a real isolated
  Codex read/mutate/read-back smoke
- restart and cross-root tool receipts: `workspaceAssistant.test.ts`, `assistantTools.test.ts`,
  `hopiMcpServer.test.ts`, and `publisher.test.ts`
- revision, cancellation, retry, pause/resume, reopen: `goalController.test.ts`
- managed isolation, project migration, stable task recovery: `assistantHomeStore.test.ts`,
  `stableWorktreeManager.test.ts`
- deterministic integration and completion: `c1Integrator.test.ts`, `completionVerifier` coverage in
  Goal and Project reconciliation tests
- notification identity, acknowledgement loss, webhook, backoff: `attentionDelivery.test.ts`
- Preview adapter and repair prompt: `previewManager.test.ts`
- Project preparation bootstrap, repeated execution, source-mutation guard, Reviewer clean rebuild,
  operational retry backoff, and Preview reuse: `projectPreparation.test.ts`,
  `stableWorktreeManager.test.ts`, `projectReconciler.test.ts`, `workProjection.test.ts`, and
  `previewManager.test.ts`
- portable image adoption and exact role image input: `assistantTools.test.ts`,
  `roleContextStager.test.ts`, `vendorTransport.test.ts`, and `passOutcomeCoordinator.test.ts`
- Project model persistence, inheritance, role resolution, and API: `assistantHomeStore.test.ts`,
  `adapterConfig.test.ts`, `mvpServer.test.ts`
- runtime Attempt persistence, raw transcript capture, restart interruption, bounded diagnostic
  paths, and API: `roleRunner.test.ts`, `runAttemptStore.test.ts`, `assistantTools.test.ts`,
  `projectReconciler.test.ts`, and `mvpServer.test.ts`
- Reflection baseline/digest behavior, one-handoff capability, child-process interruption, user
  priority, hidden/public projection, and main-thread recovery: `assistantReflection.test.ts`,
  `hopiMcpServer.test.ts`, `coordinatorReconciler.test.ts`, `workspaceAssistant.test.ts`, and
  `mvpServer.test.ts`
- Reflection-linked completion delivery and canonical acknowledgement: `assistantTools.test.ts`,
  `attentionDelivery.test.ts`, `hopiMcpServer.test.ts`, and a live handoff/notify/read-back audit
- lazy Reflection debug API and runtime-stream projection: `assistantReflection.test.ts`,
  `mvpServer.test.ts`, frontend type/build checks, and browser polling verification
- UI/API production surface: `mvpServer.test.ts` fetches deep-route HTML and every emitted asset;
  frontend route tests and Bun HTML bundle verification cover the presentation package
- supported CardGame-style history migration: `legacyGoalMigration.test.ts`

## Live End-to-End Audit

This is a validation ledger, not another runtime workflow. A scenario is distinct only when it
crosses a canonical state or ownership boundary. Variants that exercise the same boundary remain
observations of one scenario rather than new states, roles, queues, or configuration.

For each scenario, drive an ordinary Assistant Inbox turn as the operator would, observe Kanban and
Attempt state through public APIs plus the referenced local diagnostics, and compare the result with
the authority documents. When behavior diverges, update the authority design first, implement the
smallest general rule, rerun the exact scenario and its nearest boundary, then ask whether any new
concept can be removed. Model wording and incidental tool order are not assertions.

| Boundary | Representative live scenario | Current evidence |
| --- | --- | --- |
| Conversation vs effect | greeting or explanation stays conversational; an explicit instruction uses HOPI tools and returns after asynchronous admission | real Assistant `hi` and contextual tool turns; `EV-f3bd2edf...` changed Goal priority in 29 seconds with no sleep or progress polling |
| Goal delivery | new Goal clarifies only material ambiguity, records design, builds, reviews, integrates, and completes | CardGame theme and Preview Goals both reached `done` through Planner, Generator, Reviewer, C1, and final Planner assessment |
| Concurrent instruction | user input queues Planning while an admitted Generator or Reviewer finishes first; Input added during Planner staging stales and reruns that Planner | live `EV-acc8fce8...`: admitted Reviewer published before `plan-0005`; `EV-46dffe5c...` made `R-e9a7b6dd...` stale on the new path and immediately reran `plan-0003` |
| Recovery | Reviewer rejection retries; exhausted attempts produces Attention; Assistant retry resolves it without direct state edits | live `W-expedition-theme` retry and Attention recovery |
| Diagnostics | current state and responsibility context are bounded; explicit Attempt application and stale reason remain visible even when unconsumed Evidence exists | live stale Attempt API restored exact reason; state fell from about 93 KB to 25-28 KB; a noisy Engineering manifest fell from 14.3 KB to 4.3 KB and then read its final referenced Evidence |
| Lifecycle | Pause interrupts active Runs without consuming output; Resume plans before new Engineering | live `EV-36973460...` resumed into only `plan-0006`; `EV-d27fe7ce...` interrupted it and cleared active Runs without Project Attention |
| Runtime capability | Generator and Reviewer can build, start a Run-scoped service, inspect runtime behavior, preserve artifacts, and leave no process behind | live Generator and independent Reviewer port-conflict smoke tests; both selected a non-`8080` endpoint and verified `SIGTERM` cleanup |
| Project operation | Preview uses only the managed release target and routes missing/broken adapter repair through Assistant | missing dependency and early fixed-port readiness failures reopened the existing Preview Goal; after repair, host Start returned `running` only with reachable `http://127.0.0.1:43960`, and Stop closed the endpoint and both child processes without affecting the user-owned `8080` service |
| Capacity and isolation | independent Goals use fixed capacity; same Work keeps one branch; C1 target movement does not stale semantic output | live concurrent CardGame Goals plus scheduler/C1 coverage |
| Reflection priority and delivery | a new user turn interrupts in-flight background thought; a later completion handoff is public exactly once and acknowledges its Attention | `RF-70944253...` became `interrupted` within one poll after `EV-a8aea957...`, whose reply was `pong`; `RF-a8c56860...` handed off exact Attention `completion-bun-guidance-ready-fa64079e...`, `hopi_notify_user` returned `attentionAcknowledged: true`, and follow-up `RF-fc713cdd...` ended with no handoff |
| Documentation-only delivery | existing project guidance is assessed before code; a real gap becomes the smallest design-backed Work, while sufficient current fact completes without Engineering | `G-41b9a706...` corrected the initial assumption, updated design first, changed only root `AGENTS.md`, passed Review and C1, and delivered completion; follow-up `G-bc11aea0...` used only `plan-initial`, made no project change, performed no foreign-Goal/runtime template lookup, and completed with one acknowledged Attention |

The next scenario is selected from the oldest unverified boundary, unless a real run exposes a more
fundamental mismatch. This priority rule is enough; the MVP adds no scenario scheduler or test-state
machine.

## Final Simplification Review

- No new durable concept was added. Planner field guidance is only the existing document schema in
  its prompt; it does not create a template registry, DSL, role, or configuration surface.
- Duplicate model tool calls remain harmless through existing idempotent publications. HOPI does
  not track tool order or add a conversation workflow state machine to forbid them.
- Speaking turns never become progress watchers. The same Reflection handoff and Attention identity
  cover completion, blockers, and decisions, including interruption and exactly-once
  acknowledgement, so no second queue or notification ledger is needed.

## Final Gate

- [x] Backend lint, typecheck, and all 207 tests pass; all 27 frontend tests pass.
- [x] Bun builds the frontend successfully and the backend serves loadable deep routes with all
  emitted assets.
- [x] `git diff --check` reports no patch errors.
- [x] Legacy production-authority search reports only explicit one-way migration and presentation
  compatibility; responsibility `result.json` remains the fixed role adapter boundary.
- [x] Production-entry smoke returns canonical `/api/state` and rejects a second Coordinator through
  the OS instance lock.
