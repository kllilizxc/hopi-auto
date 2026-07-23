# HOPI MVP Implementation Alignment

Status: MVP implementation aligned; live end-to-end audit complete
Last updated: 2026-07-13

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
- HOPI never uses a selected checkout as canonical publication, integration, Preview, or repair
  state; it may only receive the guarded accepted-release fast-forward
- a Project may bind multiple Repos while retaining one Work, one review, and one primary C1
- the UI is Assistant-first and its Kanban is a read-only Work projection
- the workspace Assistant is one persistent Home-configured vendor conversation whose only canonical mutation path
  is validated HOPI tools
- responsibility Attempts preserve normalized events and the raw process stream, while state reads
  expose bounded diagnostics and their local paths
- meaningful state changes can run one immutable-snapshot read-only Reflection whose only possible
  effect is a digest-guarded internal handoff to the persistent Assistant conversation
- the one-way legacy import preserves supported history without retaining an old writable authority
- all repository checks and MVP acceptance suites pass

## Cutover Result

| Concern | Pre-MVP authority | MVP production authority | Verification |
| --- | --- | --- | --- |
| Project | user checkout locator | `home.yml`, multi-Repo `projects.yml`, primary `project.yml` release manifest, Project-qualified managed release worktrees | migration, dirty checkout, shared binding, link, and rebind tests |
| Goal | one mutable `todo.yml` board | bounded Goal package with one document per fact owner | schema, migration, and transition tests |
| Ordering | blockers, decisions, planning requests | permanent Engineering `dependsOn`, exact Work authority, and Goal contract revisions | graph and readiness tests |
| Assistant | Goal thread, parsed `actions[]`, or stateless staged diffs | durable Inbox turns, vendor-qualified persistent session, read-only Reflection, and validated HOPI tools | direct conversation, per-vendor session resume, Reflection, tool, and recovery tests |
| Workflow | manual controls and hard-coded task lanes | one code-owned profile through generic `RoleRunner` | profile parity and end-to-end reconcile tests |
| Publication | direct writes and nested locks | OS instance lock, global mutex, one-gate `publish`, durable receipt and C1 ref | concurrency and fault-injection tests |
| Isolation | per-Run worktrees merged into user root | stable Work branch/worktree per Project Repo plus managed integration roots | retry, migration rebuild, multi-root, and checkout tests |
| Completion | lane exhaustion | final Planner proposal plus structural Goal gate | C1 and completion verifier tests |
| UI | React/Vite writable workflow screens | restored React package, Bun HTML import, Assistant, Goal design, read-only Kanban, Attention, Preview | frontend bundle and API smoke tests |
| Notification | deduplication concept only | canonical identity, `notifiedAt`, webhook, bounded runtime backoff | delivery and lost-ack tests |

## Current Alignment Delta

- [x] Let Home configure Codex, Claude, or OpenCode for both speaking Assistant and Reflection while
  preserving one conversation, one HOPI tool protocol, and a vendor-qualified disposable session cache.
- [x] Keep blocked user Inbox events Reflection-eligible, normalize malformed proposal documents to
  ordinary Work failure, and derive restart-safe operational exhaustion from Attempt plus Attention.
- [x] Restore the Home Assistant model editor without changing current Attention/Kanban semantics,
  then prove all three vendor adapters with fake-CLI contracts and full end-to-end regression tests.

- [x] Preserve the raw stdout/stderr stream for every responsibility Attempt.
- [x] Return bounded Run/Attempt diagnostics and local log paths from HOPI state reads.
- [x] Add one coalesced, immutable-snapshot, read-only Reflection loop with an internal Inbox handoff.
- [x] Keep Reflection turns hidden unless the speaking thread explicitly requests reply exposure.
- [x] Treat a newly queued same-Goal Planning Work as admission control instead of retroactively
  staling an already admitted Engineering result.
- [x] Treat non-active Goal lifecycle as both admission control and a Goal-scoped live-Run lease
  revocation rule.
- [x] Keep `hopi_read_state` bounded to current control facts and diagnostic paths; leave durable
  history in canonical documents and raw runtime files.
- [x] Normalize semantic-guard invalidation to one stale application even when detected before C1;
  never turn expected concurrency into Project Attention.
- [x] Anchor every speaking-thread state result to its immutable current Inbox event so a long-lived
  vendor session cannot substitute the prior turn after reading state.
- [x] Guard complete selected authority membership as well as existing file hashes, so additions
  during a Run cannot publish through an incomplete snapshot.
- [x] Stage only selected authority into Engineering context instead of exposing the entire Goal
  history to every responsibility pass.
- [x] Use one empty sparse proposal overlay for every responsibility; absent canonical paths remain
  unchanged instead of requiring Planner to mirror a complete candidate snapshot.
- [x] Give both Engineering responsibilities the same Run-scoped network execution needed for local
  implementation and verification. Give Planner network access only when a local
  `HOPI_API_ORIGIN` is staged, so explicit post-C1 Preview proof is possible without making public
  Preview a pre-C1 Engineering responsibility.
- [x] Give Planner the compact canonical Work and Attention field shapes it may create, so it never
  searches other Goals or historical Runs merely to infer fixed frontmatter.
- [x] Treat Goal creation as admission of the current instruction plus one initial Planning or direct Engineering gate; a repeated
  idempotent request adds no canonical state and requires no tool-order state machine.
- [x] End the speaking turn after an asynchronous effect is admitted; never sleep or poll for later
  workflow state that Reflection already owns reporting.
- [x] Attach exact Goal Attention identities in Coordinator, fall back when Reflection omits a
  required handoff, and acknowledge delivery only after the speaking reply is handled.
- [x] Defer ordinary semantic changes while deterministic or responsibility progress remains; keep
  unnotified Attention, unavailable Project, and stale Run immediately Reflection-eligible.
- [x] Require the single Project Preview adapter to start from a clean managed integration worktree
  and emit its endpoint only when reachable; route dependency, timeout, and startup failures through
  ordinary Assistant repair.
- [x] Stop a running Preview after successful or recovered C1 integration, clear its obsolete
  endpoint, and leave restart as one explicit user action without affecting the durable C1 outcome.
- [x] Bind one or more Repos to a Project, give every Work the complete Project Repo environment,
  and keep one Generator,
  Reviewer, card, retry counter, and primary C1 across the combined workspace.
- [x] Persist secondary release commits in primary `project.yml`; recover incomplete ref/worktree
  projections after C1 and block unexpected external ref values without rollback.
- [x] Use the complete Project Repo set in each Engineering `HOPI_REPOS_FILE` instead of asking a
  model to preselect execution roots; let Agents choose relevant commands, Coordinator derive
  participation from actual Git deltas, and unchanged Repos remain C1 no-ops.
- [x] Keep all-Repo preparation as the Project Preview contract without making it an Engineering
  dispatch or Reviewer gate.
- [x] Materialize HOPI-owned integration and task worktrees with `core.autocrlf=false` without
  changing the user's checkout or Git configuration.
- [x] Start Planner in its Run root, keep proposal paths single-prefixed, and make injected MCP
  schemas authoritative so Planner and Assistant do not search runtime history for fixed formats.
- [x] Interrupt same-Goal Runs after a material revision becomes durable, checkpoint safe partial
  Generator source without publishing Evidence, and retain the immutable publication guard as the
  final race boundary.
- [x] Split Preview proof at the existing C1 boundary: Engineering directly proves its candidate
  script; final Planner uses exact public start/status/stop routes only when accepted design
  explicitly requires integrated-release proof.
- [x] Accept compatible Bun `>=1.3.11 <2` runtimes and replace platform-specific instance-lock FFI
  with one cross-platform crash-released runtime lock.
- [x] Bound Reflection failure retries per digest, derive **Needs you** from existing `notifiedAt`,
  and serialize all Preview operations including exceptional startup paths.
- [x] Require the backend product route smoke to load every emitted frontend asset, not merely return
  an HTML shell.
- [x] Rerun backend, frontend, build, and production smoke checks.
- [x] Replace local Inbox Attention IDs with complete canonical Goal-local or workspace references;
  keep singular/local forms as read-only migration input.
- [x] Make the speaking Assistant the only Attention delivery authority, preserve its handled public
  reply before `notifiedAt`, and reduce webhook to an independently acknowledged Inbox reply mirror.
- [x] Remove the unused raw-Attention delivery worker and cover Goal, workspace, completion, retry,
  restart, and repeated-local-ID boundaries end to end.
- [x] Enforce the documented host boundary at startup: macOS, Linux, and WSL are supported; native
  Windows remains deferred rather than gaining a second adapter protocol.
- [x] Keep Preview runtime-only: graceful shutdown owns children, while hard-kill process-tree cleanup
  belongs to the deployment supervisor instead of a durable PID/lease model.
- [x] Serialize Git commands that share one managed worktree index; do not add a second lock or retry
  state to race `write-tree` against `status` during C1 or completion verification.

## Implemented Slices

1. Assistant home initializes a stable `homeId`, links one or more Repos per Project, creates each
   `hopi/project/<projectId>/release`, and keeps selected checkouts read-only and non-canonical. Explicit
   per-Repo rebind repairs moved Git
   worktree administration but refuses to reconstruct a missing canonical primary root.
2. `PublicationCoordinator` serializes snapshots and publications, validates the complete candidate,
   writes support before one gate, durably acknowledges Inbox receipt, and delegates C1 to a guarded
   durable Git ref boundary.
3. Canonical Goal, Work, Input, Attention, and Evidence documents enforce identity, revision,
   permanent dependencies, singleton Planning, retry, targeting, provenance, and completion rules.
4. The fixed profile runs immutable Planner, Generator, and Reviewer contexts through one
   `RoleRunner`; missing `AGENTS.md` is silent Planner bootstrap and Engineering Work keeps one stable
   branch and checkout in every Project Repo.
5. Workspace Assistant preserves lossless Inbox turns without parsing reply prose or an Action
   object, resumes one compatible vendor-qualified session, exposes validated HOPI tools through a single-turn
   MCP capability, and records normalized live messages, tool calls, results, and failures. One
   disposable read-only Reflection assesses immutable coalesced state, can only hand an internal
   turn to that thread, and publishes only while its semantic digest remains current.
6. Reconciler derives readiness, runs passes within fixed capacity, rebuilds one primary C1 over
   clean selected-Repo target advances, recovers secondary release projections, fails invalid
   projects closed, and completes only from Planner proof. Reflection routes Attention through the
   speaking Assistant; an optional webhook mirrors only its handled public replies.
7. The restored React UI exposes Assistant, Home-wide model settings by role, Project, Goal
   contract/design, Pause/Resume, Waiting for Assistant, completion updates, four-column Kanban,
   cancelled archive, Repo add and rebind, Work Attempt
   message streams, an on-demand Reflection debug stream, and managed-target Preview; Bun serves it
   through one backend process.
8. The old server, stores, Assistant Actions, decision/planning-request graph, merger, per-Run
   worktrees, Vite runtime, and writable legacy React screens are deleted. `todo.yml` and v1/v2
   adapter config remain read-only one-way migration inputs only.

## Acceptance Evidence

- autonomous Goal: `projectReconciler.test.ts`
- concurrent instructions and fixed capacities: `coordinatorReconciler.test.ts`
- Assistant direct conversation, session resume, live tool events, design-to-code choice:
  `workspaceAssistant.test.ts`, `assistantTools.test.ts`, `hopiMcpServer.test.ts`, and a real isolated
  Codex read/mutate/read-back smoke
- Home Assistant vendor/model updates, compatible session retention, cross-vendor rebuild, Claude
  provider environment isolation, OpenCode model qualification, normalized output, image access,
  and process-group cleanup: `adapterConfig.test.ts`, `assistantConversationStore.test.ts`,
  `claudeSettingsEnvironment.test.ts`, `vendorAssistantOutput.test.ts`,
  `workspaceAssistant.test.ts`, and `mvpServer.test.ts`
- restart and cross-root tool receipts: `workspaceAssistant.test.ts`, `assistantTools.test.ts`,
  `hopiMcpServer.test.ts`, and `publisher.test.ts`
- revision, cancellation, retry, pause/resume, reopen: `goalController.test.ts`
- managed isolation, project migration, stable task recovery: `assistantHomeStore.test.ts`,
  `stableWorktreeManager.test.ts`
- multi-Repo linking/API, combined Planner-to-C1 Work, primary/secondary-only delivery, pre-C1
  conflicts, partial projection recovery, and unexpected-ref blocking: `assistantHomeStore.test.ts`,
  `mvpServer.test.ts`, `projectReconciler.test.ts`, and `multiRepoC1.test.ts`
- deterministic integration and completion: `c1Integrator.test.ts`, `completionVerifier` coverage in
  Goal and Project reconciliation tests, plus 30 repeated multi-Repo primary/secondary C1 passes
- canonical Goal-local/workspace identity, legacy read compatibility, reply-before-acknowledgement,
  acknowledgement recovery, completion collision, webhook, and backoff: `attentionReference.test.ts`,
  `assistantAttentionE2E.test.ts`, `workspaceAssistant.test.ts`, `mvpServer.test.ts`, and
  `attentionDelivery.test.ts`
- Preview adapter and repair prompt: `previewManager.test.ts`
- Preview candidate/integrated ownership, Planner API context, material interruption, and partial
  Generator checkpoint: `roleContextStager.test.ts`, `vendorTransport.test.ts`,
  `assistantTools.test.ts`, and `projectReconciler.test.ts`
- Project preparation bootstrap, repeated execution, source-mutation guard, Reviewer clean rebuild,
  operational retry backoff, and Preview reuse: `projectPreparation.test.ts`,
  `stableWorktreeManager.test.ts`, `projectReconciler.test.ts`, `workProjection.test.ts`, and
  `previewManager.test.ts`
- blocked-event Reflection eligibility, malformed proposal normalization, and restart-safe
  operational exhaustion through ordinary Work Attention: `coordinatorReconciler.test.ts`,
  `passOutcomeCoordinator.test.ts`, `projectReconciler.test.ts`, and `goalController.test.ts`
- portable image adoption and exact role image input: `assistantTools.test.ts`,
  `roleContextStager.test.ts`, `vendorTransport.test.ts`, and `passOutcomeCoordinator.test.ts`
- Home role model persistence, fallback, resolution, and API: `adapterConfig.test.ts`,
  `assistantTools.test.ts`, `mvpServer.test.ts`
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
| Goal delivery | new Goal clarifies only material ambiguity, records design, builds, reviews, integrates, and completes | retained live Goal `G-82b2beda...` reproduced the failing fixture, updated design, generated one fix, independently reviewed it, integrated through C1, reran `bun test`, reached `done`, and rendered 3/3 in Kanban without touching the user checkout; the deterministic contract repeats Inbox-to-C1 mechanics, and a zero-model browser smoke proves Projects-page Assistant admission |
| Concurrent instruction | user input queues Planning while an admitted Generator or Reviewer finishes first; Input added during Planner staging stales and reruns that Planner | live `EV-acc8fce8...`: admitted Reviewer published before `plan-0005`; `EV-46dffe5c...` made `R-e9a7b6dd...` stale on the new path and immediately reran `plan-0003` |
| Recovery | Reviewer rejection retries; exhausted attempts produces Attention; Assistant retry stays pending until the requested invocation resolves it or returns its diagnostic | live `W-expedition-theme` retry and Attention recovery |
| Diagnostics | current state and responsibility context are bounded; explicit Attempt application and stale reason remain visible even when unconsumed Evidence exists | live stale Attempt API restored exact reason; state fell from about 93 KB to 25-28 KB; a noisy Engineering manifest fell from 14.3 KB to 4.3 KB and then read its final referenced Evidence |
| Lifecycle | Pause interrupts active Runs without consuming output; Resume plans before new Engineering | live `EV-36973460...` resumed into only `plan-0006`; `EV-d27fe7ce...` interrupted it and cleared active Runs without Project Attention |
| Runtime capability | Generator and Reviewer can build, start a Run-scoped service, inspect runtime behavior, preserve artifacts, and leave no process behind | live Generator and independent Reviewer port-conflict smoke tests; both selected a non-`8080` endpoint and verified `SIGTERM` cleanup |
| Project operation | Preview uses only the managed release target and routes missing/broken adapter repair through Assistant | missing dependency and early fixed-port readiness failures reopened the existing Preview Goal; after repair, host Start returned `running` only with reachable `http://127.0.0.1:43960`, and Stop closed the endpoint and both child processes without affecting the user-owned `8080` service |
| Multi-Repo delivery | one Assistant instruction plans, changes, reviews, and integrates a Work spanning a primary `web` Repo and secondary `api` Repo without touching either user checkout | isolated Project `P-dogfood`, Goal `G-68391b3e...`: API contract and dashboard crossed two Repos through one Work/C1 model; an omitted runtime Repo caused `replan` rather than checkout discovery; revision 3 repaired the exact ready protocol, primary release reached `db090e4`, secondary release stayed at its documented `c78867e`, and both user `main` checkouts remained at their original clean commits |
| Post-C1 proof | public Preview validates only the integrated release, while Generator and Reviewer prove the candidate directly from their Run manifest | final `plan-0005` used `POST /preview/start`, `GET /preview`, live dashboard and readiness HTTP 200 checks, then `POST /preview/stop`; Goal completed only after the public session reached `running`, and no validation process remained |
| Capacity and isolation | independent Goals use fixed capacity; same Work keeps one branch; C1 target movement does not stale semantic output | live concurrent CardGame Goals plus scheduler/C1 coverage |
| Reflection priority and delivery | public speech has priority without cancelling read-only thought; only a current digest and explicit model-selected references may hand off, and a complete public reply precedes exact Attention acknowledgement | `assistantAttentionE2E.test.ts` drives both Goal-local and workspace Attention through explicit handoff, public reply, exact canonical acknowledgement, and **Needs you** projection while the user checkout remains clean; `mvpServer.test.ts` proves two Goals may reuse one local completion ID without feed collision |
| Cross-platform runtime and Preview recovery | compatible Bun 1 releases start on macOS, Linux, and WSL without platform FFI; native Windows fails early rather than partially running POSIX adapters; exceptional or stopped Preview preparation cannot overlap or strand `starting` | Debian Bun 1.3.13 passed the `>=1.3.11 <2` gate; SQLite rejected a second live Coordinator and allowed replacement after release; Preview tests proved thrown preparation recovery and serialized Start after Stop; platform-gate coverage rejects `win32` with the WSL instruction |
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
  cover completion, blockers, and decisions, including stale-result rejection and idempotent
  acknowledgement, so no second queue or notification ledger is needed.

## Final Gate

- [x] Backend lint, typecheck, and all 269 tests pass; all 42 frontend tests pass.
- [x] Bun builds the frontend successfully; an isolated production server loaded its deep Goal route
  and returned one Project-level open Attention, zero duplicated Goal Attention, and the derived
  **Needs you** Goal summary. The existing Windows Chrome visual gate remains valid; a fresh optional
  rerun requires the browser's remote-debugging authorization rather than a product change.
- [x] `git diff --check` reports no patch errors.
- [x] Legacy production-authority search reports only explicit one-way migration and presentation
  compatibility; responsibility `result.json` remains the fixed role adapter boundary.
- [x] Production-entry smoke returns canonical `/api/state` and rejects a second Coordinator through
  the OS instance lock.
