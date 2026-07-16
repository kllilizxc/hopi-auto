# HOPI MVP Design

Status: forward product and architecture authority
Last updated: 2026-07-16

This document defines the target MVP for HOPI. New product and architecture work follows it.

- [The document model](./mvp_document_model.md) owns file layout, schemas, and field invariants.
- [The Assistant design](./mvp_assistant.md) owns conversation, vendor-qualified session continuity, HOPI
  tools, and Assistant UI behavior.
- [The execution design](./mvp_execution.md) owns responsibilities, scheduling, worktrees,
  completion, delivery, and Preview behavior.
- [The state machine](./mvp_state_machine.md) is the derived lifecycle visualization. It is not a
  second workflow authority.
- [The publish protocol ADR](./mvp_publish_protocol.md) owns implementation details for the
  kernel publication primitive.
- `docs/unified_design.md` is a historical redirect only; it is not current implementation authority.

## Product Goal

HOPI is the operating system for a one-person company.

The operator talks to one workspace-wide Assistant. The Assistant accepts instructions at any
time, answers as one normal persistent Assistant conversation, and uses HOPI tools when it needs to
create or control Goals. Reconciler schedules work and drives a fixed multi-agent delivery flow.
Together they interrupt the operator only when:

- a Goal is complete
- work cannot continue safely
- a product or business decision requires operator authority

Every deviation is detected, recorded, and owned. HOPI repairs safe deviations without
interruption. A deviation that changes the Goal contract, exhausts bounded recovery, or requires
authority HOPI does not have becomes Attention and a reliable notification.

The MVP proves this loop for software delivery before generalizing responsibilities or workflows.

## Product Mental Model

The operator needs only three durable concepts:

1. **Assistant**: the conversation and intent surface.
2. **Project**: stable product context containing its repository binding, project guidance,
   responsibility-runner defaults, Preview capability, and Goals. Project has no workflow
   lifecycle.
3. **Goal**: an outcome HOPI keeps advancing until it is done, cancelled, paused, or needs the
   operator.

Attention remains an internal durable control document, not a separate product concept. Open
Attention with a target is routed internally through Reflection. It appears as **Waiting for
Assistant** before a speaking reply is delivered and **Needs you** afterward when it remains
unresolved. Only the speaking Assistant decides whether the operator must be asked. Targetless
completion Attention appears as a normal Assistant and Goal update. There is no separate Attention
page.

The speaking Assistant is the only operator-delivery authority. Inbox context correlates a public
reply to complete canonical Goal-local or workspace Attention references, then `notifiedAt` records
that durable in-app delivery. A configured webhook mirrors the already handled public reply and has
its own Inbox acknowledgement; raw Attention is never another user channel.

Each Goal has a Kanban view for progress and troubleshooting. Its columns and cards are projections
of Work, readiness, Runs, and Attention rather than another workflow authority.

The three operator surfaces have distinct jobs: Assistant shows the latest outcome and any action
the operator must take, Kanban shows current progress, and Attempt details show execution evidence
and diagnostics. Assistant does not duplicate the board or narrate the internal delivery process.
Provider progress messages, tool calls, and recoverable tool errors remain in the raw turn record and
one collapsed Activity row; only the turn's final durable reply is rendered as Assistant speech.

Internally:

```text
User -> durable conversation turn -> configured Assistant session -> ordinary reply
                                                             \-> optional HOPI tool call
                                                          -> publish(bundle)
                                                          -> sparse Work DAG
                                                          -> fixed responsibility pass
                                                          -> semantic guard -> Evidence / Attention

semantic state change -> disposable read-only Reflection -> optional internal Inbox brief
                                                        -> configured Assistant session
```

## Design Principles

### 1. Documents are durable truth

If durable product state can live in files, it does not live only in a database.

- Goal contracts, designs, Work, dependencies, routed inputs, timing, Attention, and Evidence are
  documents.
- PIDs, leases, heartbeats, raw transcripts, indexes, and UI projections are disposable runtime
  data.
- A database or search service may be a rebuildable index, never the sole workflow authority.
- Canonical project documents are Git-tracked or covered by a lossless export path.

Multiple files do not create multiple truths. Each fact has one owning document.

Model input is a disposable projection of those documents, never another authority. A responsibility
Run receives the current assignment first, followed by exact canonical source paths and the small
fixed role contract needed to act on it. HOPI may inline an objective, acceptance criteria, accepted
Input, or latest Evidence summary to make the assignment salient, but the projection always names
the owning document and is discarded with the Run.

### 2. A Goal is a bounded document package

A Goal is one product concept backed by separate contract, design, Input, Work, Attention, and
Evidence documents. Different facts remain searchable and do not accumulate in one large file.

### 3. The Work DAG is sparse and incremental

Planner creates Work only when it is independently schedulable, independently verifiable, or
expected to outlive one responsibility-pass Run. The whole graph need not exist up front.

Before publishing runnable Work, Planner records every known causal or conflict-avoidance order
in `dependsOn`. The MVP has no second resource-lock or file-overlap graph.

### 4. The MVP has one fixed delivery profile

```text
Planning Work:    Planner -> done
Engineering Work: Generator -> Reviewer -> Coordinator integration -> done
```

The Reconciler reads one built-in versioned profile. Planner, Generator, and Reviewer are fixed
responsibility passes executed by one generic `RoleRunner`; they are not durable actor types.
Coordinator integration is deterministic kernel behavior, not another responsibility pass or Work
stage. Project overrides, arbitrary passes, capability matching, workflow expressions, and a
workflow editor are deferred.

Responsibility passes own semantic judgment and their authorized content surfaces. Coordinator
alone owns mechanical side effects outside those surfaces: Git index, branch checkpoints, canonical
publication, integration refs, Run-scoped process cleanup, and retry scheduling. Targeted Attention
means missing operator authority or an external action only; it is never a generic representation of
a sandbox, Git, port, or tool failure that Coordinator or a later Run can handle.

### 5. Engineering Work is the isolation boundary

Each engineering Work item owns one stable branch and worktree. Generator repair, Reviewer
inspection, and Coordinator integration reuse it. Goal worktrees are too coarse and Run
worktrees are too short-lived.

Each Project also owns the fixed HOPI-managed integration branch `hopi/release` and one stable
integration worktree. Task worktrees branch from that target and C1 moves only that target. Managed
worktrees live together under a Repo-adjacent `.hopi-worktrees/<repo-name>/` root, never inside the
selected checkout or Assistant-home state. The selected checkout remains non-canonical, but its
branch recorded at link time is the delivery projection: after C1 and every managed Repo projection
are verified, Coordinator may advance that clean branch by fast-forward only.

### 6. Prefer one publisher over a lock hierarchy

The MVP has one Coordinator process and one global publication mutex. Model calls, tests, and
task worktrees remain parallel; only final semantic validation and durable publication are
serialized.

One project may belong to only one active HOPI home. Linking the same writable project to two
homes is an unsupported deployment; ownership must move only after the old home is stopped.

The kernel exposes three ideas to product architecture:

- `publish(bundle)`: validated, idempotent document publication with at most one control gate
- semantic guard: stale or no-longer-authorized results cannot advance state
- bounded retry: repeated failure becomes Attention instead of an infinite loop

Publication mechanics live only in [the publish protocol ADR](./mvp_publish_protocol.md).

### 7. Identity is stable and explicitly scoped

Assistant home owns a stable `homeId`; each project owns a stable `projectId`. Canonical identities
are:

- event: `(homeId, eventId)`
- Goal: `(projectId, goalId)`
- Work: `(projectId, goalId, workId)`
- producer Run reference: `(projectId, goalId, workId, runId)`
- Goal-local Attention: `(projectId, goalId, attentionId)`
- workspace Attention: `(homeId, attentionId)`

Local IDs may repeat outside their owning package. Integration, delivery, receipts, references,
and migration use the complete canonical identity rather than a bare local ID.

A Run record, process, and transcript may be discarded, but its `runId` is never reused within the
owning Work. Any qualified producer Run reference retained in Evidence or Git remains permanently
meaningful after runtime cleanup.

#### Project and Repo boundary

`Project` is the user's durable product context; `Repo` is a Git object and ref namespace. A Project
owns one or more Repos with stable `repoId` values and exactly one `primaryRepoId`. The primary Repo
contains the one canonical `.hopi` Project package and the Project-level `AGENTS.md`, preparation,
and Preview entrypoints. Every Repo has a HOPI-owned `hopi/release` ref and managed integration
worktree. The selected checkout is never a canonical publication root; it is a guarded delivery
projection of the accepted release.

Engineering Work explicitly names the Repos in its source workspace. Goal, Work, Kanban, and the
fixed responsibility passes remain Project-scoped rather than multiplying per Repo. The primary
`hopi/release` ref remains the one logical C1 boundary: its `project.yml` snapshots the target commit
for each secondary Repo, whose managed refs and worktrees are recoverable projections after C1.
The complete protocol belongs to [the multi-Repo design](./mvp_multi_repo.md).

### 8. Structured control, unstructured semantics

The kernel validates small structured control envelopes: identity, lifecycle, stage, references,
timing, retry count, and provenance. Intent, reasoning, findings, acceptance meaning, and evidence
explanations remain free Markdown interpreted by models.

HOPI does not introduce a criteria-mapping DSL, model-produced Assistant Action result, or
structured domain ontology for the MVP. The configured model uses ordinary tool calls whose small schemas are
permission and validation boundaries; reply prose is never parsed as control. Responsibility
passes are replaceable prompts and permission envelopes run through the same generic `RoleRunner`;
their durable effects are documents and fixed result values.

### 9. Proactive reasoning keeps one action authority

The Assistant may assess meaningful state changes in one disposable background Reflection so a
failure does not depend on the operator noticing a card. Reflection is read-only and has no product
lifecycle. It either ends silently or submits one internal brief to the persistent Assistant
conversation. That speaking thread rereads current truth and remains the only model authority that
may use mutating HOPI tools or notify the operator. User input has speaking priority; an independent
Reflection may finish but its handoff is discarded when its immutable digest is stale. This adds
proactive diagnosis without another agent role, workflow, action format, or operator-visible thread.

## Architecture Map

The authority is split by concern rather than repeated in one large document:

- [Document model](./mvp_document_model.md): file layout, schemas, field ownership, references,
  dependencies, revision, recovery counters, Attention, and Evidence.
- [Assistant](./mvp_assistant.md): persistent vendor-qualified conversation, read-only Reflection, HOPI tools,
  turn recovery, and live conversation behavior.
- [Execution](./mvp_execution.md): Planner responsibilities, fixed profile, semantic
  guards, worktrees, scheduling, completion, notification, and Preview.
- [Multi-Repo](./mvp_multi_repo.md): Project Repo membership, multi-root Work execution, primary
  C1 release manifests, and projection recovery.
- [Multi-vendor adapters](./multi_vendor_agent_support.md): vendor command, event, image, MCP, and
  session implementation boundary beneath the shared Assistant and RoleRunner contracts.
- [State machine](./mvp_state_machine.md): derived lifecycle, readiness, and Kanban visualization.
- [Publish protocol](./mvp_publish_protocol.md): single-gate file publication, cross-root receipts,
  C1 durability, and crash boundaries.

## Core Model Summary

- Assistant receives every instruction as a normal conversation turn; selected Project or Goal is context
  only, and canonical effects occur only through HOPI tool calls.
- Images are immutable Inbox attachments first. Assistant may explicitly adopt a relevant image as
  a portable Goal asset whose path and purpose live in editable design Markdown.
- Reflection proactively assesses meaningful state changes but can only hand a brief to that same
  Assistant; it never mutates state or appears as another product thread.
- Project owns stable context, one primary Repo, and one or more HOPI-managed `hopi/release`
  worktrees; it has no workflow lifecycle.
- Goal owns the outcome contract and lifecycle.
- Planning Work keeps the Goal blocked while Planner clarifies, updates design, maintains the
  sparse Work DAG, and makes the final semantic completion assessment.
- Engineering Work moves through Generator, Reviewer, and deterministic C1 integration.
- Attention is the only operator-interruption document; Evidence is immutable provenance.
- Coordinator is the sole publisher and deterministic authority for structural guards.

## Product Surface

The MVP UI contains:

1. Global Assistant conversation with live model messages and tool activity, queued turns,
   Assistant-mediated clarification messages and ordinary completion updates. Internal Reflection
   turns remain hidden unless the speaking thread explicitly promotes its reply. A header debug
   entry may inspect disposable Reflection runtime streams on demand without adding product state.
   The composer supports bounded image selection and paste, and the conversation preserves image
   thumbnails with their source turns.
2. Project switcher and overview with the Home Assistant model, Project guidance, effective
   responsibility model defaults, and Goals, but no Project workflow status. Assistant and Project
   model settings remain visibly separate.
3. Goal list with derived current/next summaries rather than workflow controls.
4. Goal detail with contract, derived focus, Assistant updates, and explicit Pause or Resume.
5. Goal Kanban showing active Work as cards in `Plan`, `Build`, `Review`, and `Done`, with cancelled
   Work hidden by default behind an archive filter.

Each nonterminal card shows one primary badge derived in priority order: **Needs you**, **Waiting
for Assistant**, `working`, `scheduled`, `queued`, then `waiting`. Terminal and cancelled cards
receive no readiness badge.
Kanban is read-only: it has no drag-to-transition or direct status mutation. A card links to its
canonical Work, Evidence, dependency, timing, and error facts. A `working` badge contains one small
spinner. Opening a card also lists each runtime Attempt and its normalized live message/tool stream;
that diagnostic stream is not another workflow authority. A separate polished Diagnostics product
is deferred.

Active Goals reconcile without manual Start until they complete, pause, cancel, reach
`notBefore`, or need Attention.

## Explicit MVP Non-Goals

The MVP does not include:

- editable or project-specific workflow profiles
- a project-configurable integration target
- project-defined responsibility passes or capability matching
- workflow expressions, hooks, BPMN, or a general workflow DSL
- responsibility prompt editing in the UI
- model-produced Assistant Actions, staged-diff commands, or parsing reply prose as commands
- a separate Attention page or direct internal-diagnostics command surface
- separate decision documents or a second blocking relation
- multiple control targets on one Attention
- multiple notification channels or exactly-once delivery
- Schedule documents, recurring schedules, or Goal-level time state
- resource claims or inferred file-overlap locks
- per-project, per-Goal, or target-aware publication locks
- switching or removing the primary Repo after Project creation
- a general cross-root transaction layer outside the fixed primary-C1 Repo projection protocol
- importing uncommitted checkout content, rewriting a delivery branch, or delivering by merge,
  rebase, reset, force update, or conflict resolution
- one writable project attached to multiple active HOPI homes
- child-process reattachment
- kernel compatibility judgments for stale output
- product-visible restart, fence, pending-result, or patch-rebuild states
- multi-user RBAC or remote tenancy
- vector memory as workflow truth
- OCR pipelines, embeddings, automatic image relevance classification, an Asset lifecycle, or a
  standalone media library
- direct Kanban mutation or drag-to-transition
- parallel source writers in one task worktree
- speculative Work created only to keep lanes busy
- database-owned Goal, Work, Input, timing, Attention, or notification truth
- a canonical Goal journal, terminal-Work archive lifecycle, or control semantics for ordinary
  supporting-file directories
- a general crash-atomic transaction layer for multi-file or cross-root publication
- universal domain operation IDs or durable semantic operation receipts
- a criteria-to-Evidence mapping DSL or semantic Input normalization schema
- raw transcripts as the primary observability surface
- silent deployment, payment, deletion, or external communication outside approval policy

## Implemented Cutover Boundary

The production path is the MVP path:

- Bun serves the API and imports the React product UI through one colocated HTML route whose module
  entry remains `packages/frontend/src/main.tsx`. The same server must serve every JS, CSS, and asset
  URL emitted into that HTML; an HTML shell without loadable assets is not a working UI.
- `RoleRunner` is the only responsibility runner; vendor transports are adapters beneath it.
- Assistant runs one persistent conversation through its Home-configured vendor adapter and reaches canonical state only through HOPI
  tools; it has no staged-diff or model-produced Action protocol.
- canonical Assistant-home and Project documents, one `PublicationCoordinator`, stable Work
  worktrees, and deterministic C1 own control and integration.
- one built-in profile fixes Planner, Generator, Reviewer, retry, and concurrency behavior.
- the read-only four-column Kanban, Attention feed, Preview adapter, and webhook delivery project
  directly from canonical state.

The Goal-scoped Assistant authority, `todo.yml` board authority, decisions, planning requests,
parsed `actions[]`, merger role, per-Run task worktrees, old server routes, Vite runtime, and writable
React workflow screens are deleted. `packages/frontend` remains as the React presentation boundary
and reads only MVP projections. The only legacy production code is a one-way `todo.yml` import and
adapter-config schema migration; neither can write an old authority.

## Completed Delivery Order

1. Establish `{ projectId, repoPath, deliveryBranch }` linking, the HOPI-owned `hopi/release` branch,
   the Repo-adjacent stable integration worktree, and guarded delivery fast-forward.
2. Implement the single Coordinator instance lock, global publication mutex, single-gate
   `publish(bundle)` contract, and startup validation against that managed root.
3. Add the fixed three-pass profile, canonical context bundles, root `AGENTS.md` bootstrap,
   deterministic Coordinator integration, and the single recovery counter.
4. Make task branches stable and derive branch and checkpoint facts from qualified Work identity
   and task branch HEAD.
5. Introduce global two-state Inbox turns, one persistent vendor-qualified session, live events, and HOPI
   control tools.
6. Add `contractRevision`, semantic guards, and singleton Planning Work.
7. Introduce bounded Goal packages, single-target Attention, and per-Work documents.
8. Make Assistant, Project, Goal, and derived Goal Kanban the primary UI; expose Pause or Resume
   through the same intent path.
9. Retire `planning-requests.yml`, Assistant Actions, old state authorities, and compatibility
   paths after migration tests.

Each completed slice preserved an end-to-end path and added migration or restart coverage.

## MVP Acceptance Scenarios

### Autonomous software Goal

Assistant receives a bug report, uses its Goal tool to create Goal documents and Planning Work,
and Reconciler drives Planner,
Generator, and Reviewer passes through the generic runner. After Reviewer success, Coordinator
integrates deterministically. Final Planning judges the Goal criteria satisfied, writes one
evidence-backed completion proposal, and finishes; Coordinator checks structural facts, marks the
Goal `done`, and delivers that proposal as the completion update.

### Screenshot-guided Goal

The operator attaches a reference screenshot while asking Assistant to reproduce an interface.
The Inbox receipt durably owns the original image. Assistant sees it, adopts it into the selected
Goal with a concise purpose, and starts Planning in the same publication. Planner records the design
decision and cites the exact Goal asset in each related Engineering Work. Generator and Reviewer
receive that image with their Work while unrelated Work receives no image context. Restart, retry,
and Project migration preserve the same file and Markdown provenance.

### Concurrent instructions

Instructions arriving during active Runs or another Assistant turn become durable immediately.
Assistant turns remain FIFO within one speaking conversation; pass Runs continue in parallel while their
final publications enter one short global queue. A same-Goal material change accepted through a
HOPI tool
increments `contractRevision`; stale output cannot advance state. Other Goals schedule
independently.

### Decision and automatic resume

A pass creates targeted Attention with one recommendation. The operator answers in the normal
conversation; Assistant reads current state and uses the appropriate HOPI tool. A Goal-local answer
publishes its effects and Input before resolving Attention. An event-target answer resolves that
guard and lets the original pending turn run again with the answer visible in durable conversation
history, without parsing prose into an Action.

### Persistent external blocker

A required browser environment remains unavailable after HOPI has provided its normal Run-scoped
runtime capability. HOPI preserves the task branch and raw diagnostics. A technical failure follows
bounded recovery and Background Reflection before user escalation. Targeted Attention is created
only when the remaining next action actually requires the operator, such as enabling a browser,
supplying a credential, or making a product decision.

### Restart recovery

The server exits during a Run, publication, integration, or notification. On restart HOPI first
validates every root, never reattaches the old child, and preserves the task branch and every
published attempt count. Its runtime Attempt is marked interrupted for UI history. Evidence without
a Work gate remains unconsumed and a later attempt uses a new Run, so a process crash may undercount
one canonical recovery attempt. An Attention-producing outcome leaves Work
unchanged by design until a new Run follows resolution. Any inconsistency after the C1 ref boundary
creates workspace project Attention. Delivery recovery may reattempt the one recorded clean
fast-forward, but it never repairs checkout content or changes branches. Managed-root ownership does
not authorize destructive reconstruction of newer canonical documents.
Invalid Assistant-home state requires supervisor intervention. Inbox turn state, qualified Goal
Input path and digest, qualified Work integration trailers, Work references to
immutable Evidence, Attention identity and `notifiedAt`, and current semantic state prevent
duplicate domain effects. At-least-once webhook mirroring may repeat after a crash but keeps the
same canonical Inbox event identity and cannot repeat domain effects.

### Project migration

Git refs and canonical `.hopi` files move to another machine. Goal Inputs, contracts, DAG, timing,
task branches, Attention, Evidence, stable Repo IDs, and the primary release manifest remain
self-contained. Assistant-home Inbox turns and workspace Attention move with the HOPI-home export
together with `home.yml`; the complete existing Repo-ID set is explicitly rebound as one local
operation before validation allows work to resume. A startup against stale paths fails closed and
may expose Project Attention, but cannot schedule Agent work. HOPI refuses to reconstruct a missing
primary managed root from a potentially older Git checkpoint.

## Evidence From CardGame

The CardGame history supports the retained choices:

- long-running Goals need multiple documents, durable Work, verification, and task isolation
- task worktrees keep failed work off the integration target
- fixed Planner, Generator, and Reviewer responsibilities provide understandable passes while
  deterministic integration does not require another responsibility pass
- bounded failure followed by proactive Attention is valuable

It also demonstrates what this MVP removes:

- a 161-task, 1,275-line `todo.yml`
- erased dependency history
- duplicate planning refills
- stale or malformed Goal and design text
- disagreement between tasks, blockers, requests, and runtime state
- mechanical status-to-responsibility routing
- repeated unchanged environment failures
- divergent retry worktrees
- ignoring all canonical `.hopi` files

The lesson is not to abandon documents, Work, responsibilities, or worktrees. It is to give every
fact one authority, validate every publication, keep ordering explicit, and make execution
isolation match durable Work.

## Deferred Evolution

After the fixed flow is reliable, HOPI may add:

- selectable and safely editable workflow profiles
- responsibility passes for research, operations, support, and business workflows
- capability- and permission-based Run contracts
- conditional assurance policies
- recurring schedules and richer connectors
- multiple notification channels
- sharded publication when a single global queue becomes a measured bottleneck
- rebuildable SQLite FTS or other indexes
- a temporary recovery bundle or Git snapshot publisher only if measured crash-recovery evidence
  shows that single-gate publication is insufficient

Extensions must preserve the document authorities and invariants in this design rather than
create a parallel workflow truth.

## Supported Host Boundary

The MVP Coordinator and executable adapter contract support macOS, Linux, and WSL. WSL is the
supported Windows deployment because it preserves POSIX executables, signals, process groups, Git
worktrees, and shell adapters. A Windows browser may connect to a Coordinator running in WSL.
Native `win32` hosting is rejected at startup with an actionable message and remains deferred; HOPI
does not add a second PowerShell adapter, executable-mode emulation, or process-control protocol
until that deployment is required.
