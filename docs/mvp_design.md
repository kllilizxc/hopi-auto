# HOPI MVP Design

Status: forward product and architecture authority
Last updated: 2026-07-17

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
Assistant** while Assistant owns the next action and **Needs you** only while its explicit
`operatorRequest` points at an unanswered public Assistant request. Needs-you decorates that exact
question and contributes to one non-zero floating Assistant count; Kanban does not duplicate it as
a page banner. An informational update does not transfer ownership. An exact operator reply returns
ownership to Assistant through immutable Inbox `replyTo` correlation, and resolution restores
ordinary message styling. An ordinary message on the same Goal is not inferred to be a reply. Only the speaking
Assistant decides whether the operator must be asked. Targetless completion Attention appears as a
normal Assistant and Goal update. There is no separate Attention page.

The speaking Assistant is the only operator-delivery authority. Inbox context correlates a public
reply to complete canonical Goal-local or workspace Attention references, then `notifiedAt` records
that durable in-app delivery. When the reply actually requests a decision or external action,
`operatorRequest` additionally records its exact canonical Inbox event. A configured webhook mirrors
the already handled public reply and has its own Inbox acknowledgement; raw Attention is never
another user channel.

Each Goal has a Kanban view for progress and troubleshooting. Its columns and cards are projections
of Work, readiness, Runs, and Attention rather than another workflow authority.

The three operator surfaces have distinct jobs: Assistant shows the latest outcome and any action
the operator must take, Kanban shows current progress, and Attempt details show execution evidence
and diagnostics. Assistant does not duplicate the board or narrate the internal delivery process.
Provider progress messages, tool calls, and recoverable tool errors remain in the raw turn record and
become one collapsed Activity row after the next non-tool boundary; only the turn's final durable
reply is rendered as Assistant speech. While tools are still the conversation tail, their stream is
shown directly. A single rebuildable conversation-level activity projection renders public work as
`Working` and otherwise renders hidden active Reflection or internal speaking work as `Thinking`.
It appears only at the tail and never becomes historical conversation state.

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

That projection keeps a stable authority prefix and a bounded current-state suffix. The prefix owns
the role contract and complete Work; the suffix owns the latest candidate delta, prior observed
checks, Evidence findings, and Run-local paths to copied reproducer artifacts. A previous Agent
summary is a claim, never proof. This shape lets a healthy vendor Session and provider prompt cache
retain its code map without making accumulated conversation or an obsolete Run path authoritative.
The Session is reused only while its transport, model, execution boundary, and Work contract remain
compatible and its last invocation has no unresolved execution-infrastructure failure.

### 2. A Goal is a bounded document package

A Goal is one product concept backed by separate contract, design, Input, Work, Attention, and
Evidence documents. Different facts remain searchable and do not accumulate in one large file.

### 3. The Work DAG is sparse and incremental

Assistant may admit one complete Engineering Work directly from one accepted Input. It uses this
bounded path only when current Goal authority already defines one cohesive, independently
verifiable delivery and no existing Work or durable design contract must be revised. One Input can
directly admit at most one Engineering Work across the Home. When more than one new Work, contract
revision, design judgment, or graph rewrite is needed, Planner creates Work only when it is
independently schedulable, independently verifiable, or expected to outlive one
responsibility-pass Run. The whole graph need not exist up front.

Before publishing runnable Work, Planner records every known causal or conflict-avoidance order
in `dependsOn`. Independent Work remains as dependency-free roots when both can start from the
current release and they do not require one another's published results, write overlapping source,
or contend for the same exclusive external resource. Parallelism is a consequence of that
independence, not a reason to split one cohesive outcome. The MVP has no second resource-lock or
file-overlap graph.

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

Planning is a responsibility, not a mandatory admission stage. Goal creation requires its caller to
author and explicitly select one Planning or Engineering first Work, then publishes it atomically
with the Goal and accepted Input. Coordinator derives structural Work fields but not its semantic
assignment. Direct admission does not imply Goal completion: after Engineering Work drains, the
ordinary final Planning
assessment still decides whether the Goal is complete, needs more Work, or needs authority.

Agent permission follows resource ownership rather than semantic command allowlists. One resolved
execution envelope is used both to launch the provider and to describe its actual shell, network,
filesystem, tool, and root capabilities to the Agent. Deterministic boundaries protect only HOPI authority and managed Git
projections, another responsibility's immutable surface, and external side effects not authorized by
the current Input, Work, or operator. Natural-language authority remains sufficient; HOPI adds no
permission DSL, capability field, or command taxonomy.

Each envelope describes only its current process. A speaking Assistant's bounded environment does
not describe the independent environment of a later responsibility Run. Accepted Work carries the
authorized objective into that Run, which resolves its own capabilities at start and records actual
execution failures as diagnostics instead of treating the speaking turn's limits as global HOPI
limits.

Provider-native unrestricted host access is a Project-local operator preference, not durable Project
authority. It defaults off and is stored in HOPI's local runtime settings, with localStorage as a UI
mirror rather than an execution-time source of truth. When enabled, newly started speaking
Assistant turns in that Project and its Planner, Generator, and Reviewer Runs use the ordinary HOPI
OS user's permissions. When disabled or unavailable, adapters retain their bounded workspace and
declared-root policy. The runtime reads this setting when each invocation starts, so backend restart,
route changes, and an absent browser cannot silently change the effective mode. Background Reflection
remains read-only in either mode.

Responsibility passes own semantic judgment and their authorized content surfaces. Coordinator
alone owns canonical publication, managed task-worktree Git metadata and checkpoints, integration
refs, Run-scoped process cleanup, and retry scheduling. It does not own Git operations in a
Run-owned scratch clone when accepted Work requires branch or PR delivery. Targeted Attention means
missing operator authority or an unavailable external action only; it is never a generic
representation of a sandbox, Git, port, or tool failure that Coordinator or a later Run can handle.

### 5. Engineering Work is the isolation boundary

Each engineering Work item owns one stable branch and worktree. Generator repair, Reviewer
inspection, and Coordinator integration reuse it. Goal worktrees are too coarse and Run
worktrees are too short-lived.

Before admitting another responsibility pass, Coordinator synchronizes that stable task branch
with the current Repo release while preserving its checkpointed Work delta. An already-current
branch is reused unchanged; a clean release advance is incorporated mechanically. A dirty or
conflicting branch that cannot be synchronized without guessing is preserved behind Work-target
Attention before a model pass starts. Speaking Assistant may retry after a concrete repair or
request Planning when the contract or DAG actually needs to change; the sync fault itself does not
invent a Goal-wide Planning guard. This is maintenance of the existing Work projection, not another
workflow state.

Work identity also bounds what may be preserved. When accepted Planning requires the old task delta
or checkpoint not to be used at all, Planner creates a distinct Engineering Work identity and routes
the monotonic DAG through it. Coordinator never resets the old stable branch and HOPI adds no
`freshWorktree`, repair mode, or branch-generation field.

Each Project-to-Repo binding owns the derived HOPI-managed integration branch
`hopi/project/<projectId>/release` and one stable integration worktree. Task worktrees branch from
that target and C1 moves only that target. Managed worktrees live under the Repo-adjacent
`.hopi-worktrees/<repo-name>/projects/<projectId>/` root, never inside the selected checkout or
Assistant-home state. The selected checkout only locates the Git object database and initial HEAD;
Coordinator never changes its branch, index, or working tree.

### 6. Prefer one publisher over a lock hierarchy

The MVP has one Coordinator process and one global publication mutex. Model calls, tests, and
task worktrees remain parallel; only final semantic validation and durable publication are
serialized.

One project may belong to only one active HOPI home. Linking the same writable project to two
homes is an unsupported deployment; ownership must move only after the old home is stopped.

The kernel exposes three ideas to product architecture:

- `publish(bundle)`: validated, idempotent document publication with at most one control gate
- semantic guard: stale or no-longer-authorized results cannot advance state
- bounded Work recovery: reviewed or operational exhaustion becomes Attention instead of an
  infinite automatic retry; HOPI adds no Goal-level Run-count or similarity fuse

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

The ordinary linking UI does not expose `projectId`. The first durable link derives a readable,
Home-unique identity from the primary selected Project folder; that identity is then persisted and
never re-derived from a later path or folder rename. Explicit IDs remain available at the API
boundary for migration and deterministic automation.

The ordinary Goal form likewise does not expose `goalId`. New Goals derive a Project-local,
readable `G-<title>` identity from the Goal title. Unicode letters and numbers remain readable,
spacing and punctuation normalize to `-`, and a same-name collision receives the smallest free
numeric suffix (`-2`, `-3`, ...). Existing identities are never renamed; explicit IDs remain an API
compatibility boundary.

Local IDs may repeat outside their owning package. Integration, delivery, receipts, references,
and migration use the complete canonical identity rather than a bare local ID.

A Run record, process, and transcript may be discarded, but its `runId` is never reused within the
owning Work. Any qualified producer Run reference retained in Evidence or Git remains permanently
meaningful after runtime cleanup.

#### Agent plan runtime projection

A responsibility adapter may emit a structured Agent plan while executing one Attempt. HOPI
normalizes that vendor event into a transport-independent runtime snapshot whose items contain only
display text and completion state. The snapshot is observability, not workflow authority:

- plan items describe outcome, decision, or dependency boundaries that materially change what
  remains to be achieved. Supporting reads, setup, routine checks, result serialization, and other
  operations with no independently meaningful outcome stay folded into the owning item. Independent
  operations may be batched. HOPI imposes no simple/complex classification and no minimum or maximum
  item count; it preserves the model's proportionate plan instead of rewriting or hiding items by
  keyword;

- it never creates Work, changes a Work stage, satisfies a dependency, or contributes Evidence;
- the latest snapshot from the latest running Attempt replaces earlier snapshots instead of merging
  them across retries, resumed sessions, responsibilities, or Runs;
- adapters may retain only vendor task identity and title inside the matching vendor Session cache
  so an incremental update after native Session resume can still name the affected task. The current
  Attempt snapshot contains only tasks created, updated, or authoritatively listed in that Attempt;
  untouched historical tasks are not merged into it. The cache is discarded with the vendor Session,
  transport change, or Work contract revision;
- Kanban shows Agent plan items as one compact segmented progress track, collapsed by default. Each
  item owns one segment; expanding the track reveals the complete current list, and the running
  segment uses a restrained pulsing full fill with a quiet same-color glow. Completed segments and
  their expanded item markers inherit the containing Lane's phase color rather than a global success
  color. Expanded items remain a non-interactive projection rather than independent Subtask entities;
  clicking one opens the containing Work detail, while only the progress summary toggles expansion.
  The track exists only after a non-terminal Work has started; never-started, Done, and cancelled Work
  render no progress track. Started Work without an Agent plan uses one fallback segment derived from
  its runtime state.
  Attempt detail does not repeat this card-level task projection; the normalized plan event remains
  available in the Run record;
- plan events stay out of the conversational Activity projection, because changing an internal plan
  is neither Assistant speech nor a tool interaction; and
- raw vendor transcripts remain diagnostic input only. Product UI reads the normalized event stream
  and gracefully omits plans recorded before normalization support existed.

An Agent plan may be revised or abandoned at any time. Canonical decomposition remains Planner-owned
Work in the Goal package; promoting an internal plan item into durable Work requires the ordinary
reviewed planning path.

#### Project and Repo boundary

`Project` is the user's durable product context; `Repo` is a Git object database shared by one or
more Project bindings. A Project owns one or more Repo bindings with stable `repoId` values and
exactly one `primaryRepoId`. The primary Repo binding
contains the one canonical `.hopi` Project package and the Project-level `AGENTS.md`, preparation,
and Preview entrypoints. Every binding has a HOPI-owned `hopi/project/<projectId>/release` ref and
managed integration worktree. The selected checkout is never a canonical publication or delivery
root.

Engineering Work explicitly names the Repos in its source workspace. Goal, Work, Kanban, and the
fixed responsibility passes remain Project-scoped rather than multiplying per Repo. The primary
Project-qualified release ref remains the one logical C1 boundary: its `project.yml` snapshots the target commit
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
- Assistant receives environment, conversation, scoped state, and operation semantics as facts,
  including whether an effect is internal scratch state or operator-addressable Evidence, and judges
  the semantic owner. Its goal is an effect matching the operator intent's scope, durability, and
  accessibility; no deterministic prose classifier maps requests to Goal operations.
- UI and Assistant expose the same semantic product operations through shared domain commands;
  pickers, navigation, and dialogs remain presentation rather than new workflow concepts.
- Images are immutable Inbox attachments first. Assistant may explicitly adopt a relevant image as
  a portable Goal asset whose path and purpose live in editable design Markdown.
- Reflection proactively assesses meaningful state changes but can only hand a brief to that same
  Assistant; it never mutates state or appears as another product thread.
- Project owns stable context, one primary Repo binding, and one or more Project-qualified managed
  release worktrees; a Git Repo may participate in several Projects.
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
   turns remain hidden unless the speaking thread explicitly promotes its reply. A hidden corner
   debug entry may inspect disposable Reflection runtime streams on demand without adding product
   state or persistent Assistant/Reflection list headers.
   The composer supports bounded image selection and paste, and the conversation preserves image
   thumbnails with their source turns.
2. Project switcher and overview with one Home agent-settings panel for Assistant, Planner,
   Generator, and Reviewer, plus Project guidance, effective responsibility model defaults, and
   Goals, but no Project workflow status. Each Home role may explicitly select its transport, model,
   and compatible reasoning effort; an inherited workflow role continues to use each owning
   Project's default.
3. Goal list with derived current/next summaries rather than workflow controls.
4. Goal detail with contract, derived focus, Assistant updates, and explicit Pause or Resume.
5. Goal Kanban showing active Work as cards in `Plan`, `Build`, `Review`, and `Done`, with cancelled
   Work hidden by default behind an archive filter.

Every peer-view tab surface uses one shared tab rail. Project shortcuts, Goal switching,
Kanban/Goal docs navigation, and Activity/Work contract share selection, keyboard, overflow, and
navigation behavior while using only the visual variant required by their hierarchy. Goal switching
is rendered once in the Goal surface's title slot rather than duplicated in the global shell: the
selected Goal is the page title, nearby Goals are smaller muted peers beside it, and additional Goals
remain available through the same overflow control. This title variant has no rail border or
background. The compact Project rail and ordinary content tabs retain their sliding selected
indicator. Attempt history and document indexes remain lists because they select records rather than
peer views.

Browser-local Goal view state contains only presentation preferences: expanded Work progress rows
and the currently snapped compact Lane, keyed by stable Project and Goal identity. Re-entry restores
those preferences but never treats them as Work, plan, or Lane authority. Compact startup, lazy-route
loading, and initial Goal reads share one bottom-right non-modal loading notice; it does not replace
the mounted shell or capture pointer input.

Goal and Work-message navigation is stale-while-revalidate. Cached canonical projections render
immediately and refresh without replacing visible content. When the target has never been read, the
current surface remains mounted while navigation intent warms the route module and target query;
only then does the URL and visible surface switch. Work-card and Attempt selection apply the same
rule to Attempt summaries and paged event history. Navigation requests are ordered so a slower
earlier preload cannot override the operator's latest selection. Direct cold URLs may use a local
skeleton because no prior surface exists to preserve.

Message history additionally keeps a bounded browser-session snapshot keyed by exact stream
identity. Re-entry or same-tab reload may render the last successfully displayed Assistant, Attempt,
or Reflection history and the selected Work's Attempt index synchronously while cursor
synchronization runs in the background. These snapshots are disposable read caches: they cannot
cross stream scopes, satisfy Evidence, or become conversation, Run, or workflow authority.

Read projections are scoped to the surface that renders them. The Kanban projection contains Goal
header facts, card facts, current Agent plans, and relevant Attention, but excludes design documents,
Goal Evidence bodies and artifacts, canonical Work bodies, and Goal Attention bodies. Attention on
the Board is open status and routing identity only; resolved history and readable bodies belong to
Assistant. Goal docs polls a
catalog of document paths and short display excerpts; it reads only the selected design body on
demand and never transfers Work or artifact data. An opened Work contract similarly reads that
single Work body on demand. The persistent shell projection excludes Attention bodies, which are
read only while Assistant is visible. Active projections use the fast polling cadence, settled Goal
projections back off, and hidden or closed live streams stop. The quantitative budgets and repeatable
desktop/mobile profile are canonical in `packages/frontend/PERFORMANCE.md`. Compact Kanban keeps every
Lane in the horizontal navigation geometry but mounts card lists only for the selected Lane and its
immediate neighbors; advancing selection moves that render window before another Lane becomes
adjacent.

The projection still derives one primary badge in priority order: **Needs you**, **Waiting for
Assistant**, `working`, `scheduled`, `queued`, then `waiting`. The card footer shows the count of
real runtime Attempts and, only when dispatch is currently prevented, one concise `Blocked by …`
reason derived from readiness facts. A Done card also shows when its successful terminal Attempt
made completion effective. The Done Lane orders cards by that derived time, newest first; records
without a derivable completion time follow timestamped cards in stable projection order. This is a
presentation rule over the server-derived read projection and durable Attempt log, not another
model-maintained Work field; older Attempt records without application metadata may be used only
when their successful terminal responsibility unambiguously matches the Work kind. This runtime
count is not the canonical Work `attempts` repair counter. Lane placement and segmented progress
already communicate ordinary running and queued state without repeating footer labels.
Kanban is read-only: it has no drag-to-transition or direct status mutation. A card links to its
canonical Work, Evidence, dependency, timing, and error facts. Only the running title and current
segment fill carry restrained status motion; the title uses the Lane color while the card surface
remains still. Reduced-motion keeps the title as a static emphasis. Opening a card also lists each
runtime Attempt and its normalized live message/tool stream. The detail header shows the execution
model and reasoning effort captured for the selected Attempt; switching Attempts switches that
value, while older records without a captured execution show an explicit unavailable value rather
than today's Home role setting. One horizontally scrollable fact strip combines that execution
identity with revision/recovery timing and the selected Attempt's cost diagnostics. It omits Stage,
Responsibility, and Repositories because the Lane, Attempt list, and Work contract already own that
context. A terminal result summary is a collapsed single-line preview above Activity, not an
unbounded fixed paragraph: expanding it exposes the full text in a bounded diagnostic region so the
message stream retains useful height. The diagnostic stream is not another workflow authority. A
separate polished Diagnostics product is deferred.

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
- importing uncommitted checkout content or rewriting a selected checkout by branch switch, merge,
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

1. Establish `{ projectId, repoPath }` bindings, Project-qualified HOPI release branches, and
   Repo-adjacent stable integration worktrees without mutating selected checkouts.
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
unchanged by design until a new Run follows resolution. Any managed-projection inconsistency after
the C1 ref boundary creates workspace project Attention. Delivery recovery may reattempt the one
recorded clean fast-forward, but delivery drift is nonblocking and it never repairs checkout content
or changes branches. Managed-root ownership does not authorize destructive reconstruction of newer
canonical documents.
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
exposes Project Attention, but cannot schedule Agent work. While that Project authority is unreadable,
the product state remains available as a Project/Repo/Attention shell and does not pretend to list
Goals from missing files; successful complete-set Rebind reloads the same canonical Goal packages.
HOPI refuses to reconstruct a missing primary managed root from a potentially older Git checkpoint.

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
