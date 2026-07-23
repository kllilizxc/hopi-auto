# HOPI MVP Execution

Status: forward execution authority
Last updated: 2026-07-23

This document owns semantic guards, the fixed responsibility profile, scheduling, worktrees,
recovery, completion assessment, notification, and Preview behavior for
[the HOPI MVP design](./mvp_design.md). Document schemas belong to
[the document model](./mvp_document_model.md), Assistant conversation and tools to
[the Assistant design](./mvp_assistant.md), lifecycle visualization to
[the state machine](./mvp_state_machine.md), and mechanical publication guarantees to
[the publish protocol ADR](./mvp_publish_protocol.md).

## Canonical Publication

Canonical documents are not shared model scratch space.

- Coordinator is the sole publisher of canonical control state.
- The deployment permits one active Coordinator through one cross-platform OS-backed instance lock.
- Every canonical mutation enters one global publication queue and mutex.
- Every canonical snapshot used for control decisions or model staging is copied while briefly
  holding the same mutex; consumers release it before model calls, tests, or other long work.
- Model calls, tests, pass Runs, source edits, and proposal construction happen outside the mutex.
- Assistant mutations arrive through validated HOPI tools. Every responsibility receives the same
  proposal model: a sparse writable overlay beside a complete immutable authority snapshot.
- A proposal starts empty and contains only documents the responsibility wants to add or replace.
  An absent path means unchanged; canonical deletion is not a responsibility-pass capability in
  the MVP. Coordinator combines the overlay with current authority before validation.
- Source and ordinary project docs are edited only in the owning task worktree, except that Planner
  may create a missing root `AGENTS.md` as its context-bootstrap supporting write.
- Every canonical publication targets the managed integration worktree. HOPI ignores uncommitted
  delivery-checkout content; only the post-C1 guarded fast-forward may materialize an accepted
  release there.
- Direct mutation of canonical files while Coordinator runs is unsupported; changes enter through
  staged publication or an explicit offline import and validation path.
- PublicationCoordinator maintains one process-local generation per storage root. A successful
  publication, uncertain failed publication, or C1 critical section advances that generation.
  Coordinator's high-frequency reconciliation poll may reuse one Goal-ID plus validated
  Goal-package snapshot only while it is unchanged; ordinary Assistant, API, control, and recovery
  reads remain fresh. Restart begins from an empty cache and validates storage again. This is a read
  optimization, never a durable version, workflow fact, or substitute for publication validation.

One `publish(bundle)` call changes exactly one storage root. Under the global mutex, Coordinator
rereads current documents, validates the proposed final view and semantic authorization, then
publishes supporting writes followed by at most one control gate. A mutation needing two gates is
split into two publications with an ordinary canonical fact between them. C1 integration is its own
Git boundary rather than a document publication.

The MVP promises process-crash safety, not general power-loss durability or multi-file atomicity.
Ordinary documents use temporary-file atomic replacement. Only acknowledgement of a newly received
Inbox turn and the C1 integration ref require a strong durability boundary. Git audit commits run
in the background and at explicit checkpoints rather than gating every document publication.

Root availability is a disposable runtime projection. A valid open workspace project Attention is
the durable reason a project is excluded from scheduling; `disabled` is never stored as another
project or workflow state. The API has no universal operation ID or durable operation-receipt
entity; idempotency comes from domain identity and current canonical state.

Domain idempotency comes from the authority that owns each effect:

- inbox `handled` state prevents a message from being applied twice
- a qualified Goal Input path and digest prove that one HOPI tool accepted an Inbox turn for that
  Goal
- a qualified Work identity in the Git integration trailer proves integration
- canonical Inbox Attention references and `notifiedAt` govern speaking-Assistant acknowledgement
- Work references to Evidence and its qualified `producerRun` mark a responsibility-pass
  result as consumed
- current lifecycle, stage, contract revision, dependencies, and semantic guards reject obsolete
  repetition

Cross-document validation includes unique IDs, legal stages, valid references, acyclic
dependencies, at most one nonterminal Planning Work, no nonterminal dependency on cancelled
Work, current contract revisions, valid single Attention targets, evidence for completed Work, at
most one open workspace project Attention per project, no second Work result consuming the same
qualified `producerRun`, and a valid legacy `completionAttentionId` only while Goal lifecycle is
`done`.
A home project link's expected `projectId` must match the linked `project.yml` whenever that file is
valid and readable.
A Goal Input must match one durable Inbox source by qualified Home/event identity and digest. One
turn may have Inputs in more than one explicitly tool-targeted Goal. A pass failure that needs
Attention creates Goal-local targeted Attention covering the failing Work and does not publish a
Work gate, so it prevents immediate redispatch. Project-target Attention is reserved for an invalid
or unwritable project root; it is one Assistant-home publication and claims no project recovery
update.

Implementation mechanics belong to [the publish protocol ADR](./mvp_publish_protocol.md).

The runtime baseline is Bun `>=1.3.11 <2`. `packageManager` records the reproducible baseline, but
HOPI does not reject a compatible patch or minor release merely because it is newer. Startup checks
the supported range and the test suite proves the capabilities HOPI actually uses. The Coordinator
instance lock is one long-lived exclusive transaction in a Bun SQLite file under runtime storage.
SQLite is used only as a cross-platform OS locking primitive: it stores no product or workflow fact,
is never read as authority, and is disposable after the process exits. The transaction and its OS
lock are released automatically on crash without libc-specific FFI or an external `flock`
executable.

The supported Coordinator hosts are macOS, Linux, and WSL. WSL is the Windows deployment boundary;
a native `win32` process is rejected at startup because the Project contracts rely on POSIX
executable bits, signals, shell adapters, and Git worktree behavior. The UI may still run in a
Windows browser against a WSL Coordinator. Native Windows support is deferred instead of adding a
second adapter and process-control protocol to the MVP.

Before reconciliation, dispatch, integration, or notification delivery, Coordinator validates the
Assistant home and linked projects. An invalid project creates or reuses workspace project
Attention and stays out of scheduling; an invalid Assistant home fails closed to the external
supervisor. After a process crash, a pass result whose Work gate is absent is unconsumed: Evidence
is preserved, targeted Attention remains blocking, and any later attempt uses a new Run. HOPI does
not reconstruct the old transition or guess missing intent.

### Semantic guard

When a responsibility pass returns, Coordinator enters the global publication queue, rereads
current truth, and requires:

- its Run result has not already been applied
- Goal lifecycle is `active`
- Work is nonterminal and still at the pass's expected stage
- Work and result use the current `contractRevision`
- required dependencies and integration preconditions still hold
- no open targeted Attention covers the project, Goal, or Work
- the complete protected authority selection still has the same paths and content, except for the
  writes in the result being validated

If the guard fails, the result cannot advance state. Source and diagnostics remain useful inside
the Run Attempt. A result that is already stale at publication writes neither canonical Evidence
nor Planning. Canonical Evidence can remain unconsumed only when its supporting write became
durable before a process stop prevented the Work gate.
A Work reference to Evidence with the same qualified `producerRun` is the durable
consumed-result marker. Ordinary outcomes reference it from the owning Work gate; an `attention`
result preserves it beside the Attention without claiming Work progress. Unreferenced Evidence is provenance only and does not suppress a
rerun. The append-only referenced Evidence list is ordered oldest to newest, so a retry reads its
final reference first and expands backward only as needed. This existing order is the repair
context. The Run manifest may render that same order and label its final item for model salience;
this is a disposable projection, not a separate replay ledger or latest-failure pointer.

### Cross-root operations

Assistant home and project Git are not one atomic store. HOPI uses a simple idempotent sequence:

1. The pending Assistant turn is already durable before the configured model runs.
2. Each mutating HOPI tool names and validates its own target. Material Goal or Work decisions use
   operation-specific single-gate publications and publish Goal Input for source `(homeId, eventId)`
   as the accepted authority receipt. Dedicated operational retry and defer tools instead audit
   their exact canonical control effect without adopting the current Inbox body as Goal authority.
   Goal creation atomically establishes the Goal, its Input receipt, and the caller-authored first
   Planning or Assistant-dispatched Engineering Work. Existing-Goal direct admission atomically
   publishes its Input, supporting references, and Work gate; legacy completion state is cleared
   compatibly when present.
3. After all optional tool calls and the final Assistant reply, publish the Assistant-home reply and
   disposition and mark the turn handled.

From the first Goal effect in one Assistant turn until that turn is handled or fails, Coordinator
holds a process-local dispatch barrier for every Goal touched by the turn. It may persist each tool
effect immediately, but it cannot admit Planner, Generator, or Reviewer against an intermediate
combination of those effects. A turn may touch several Goals and therefore add several scoped
barriers; unrelated Goals remain schedulable. Settlement releases all of them and wakes ordinary
reconciliation. This is an execution fence over one already-durable Inbox turn, not another
canonical status or a transaction spanning Assistant home and Project Git.

Known product controls use the same sequence without a model call. Coordinator temporarily excludes
their newly admitted pending receipt from speaking dispatch until the request publishes its handled
acknowledgement. The exclusion is process-local and covers the whole receive/effect/acknowledge
sequence; it adds no canonical status. A failure or process replacement releases the exclusion, so
the still-pending receipt follows the ordinary Assistant recovery path instead of being lost.

The tool target owns destination choice for that call; when an operation accepts material authority,
the qualified Goal Input path and digest are its project-effects receipt. One turn may intentionally
create receipts in multiple Goals. Operational controls cannot create those receipts merely because
they ran during the turn. None of these is a generic operation receipt or cross-root transaction
entity.

After a process crash, a pending turn resumes in the configured Assistant conversation. A material
tool whose Goal Input is missing rereads current canonical state and safely completes or reports the
interrupted effect; a matching Input proves that Goal already accepted the source instruction.
Operational controls reread their exact Work fields and targeted Attention instead. Domain IDs,
lifecycle guards, expected content hashes, and existing Planning Work make repeats idempotent. A
vanished target, conflicting Goal identity, digest mismatch, or missing original turn creates
targeted Attention rather than a guessed repair. An unavailable unrelated project does not affect
the other tool calls in the turn.

Project-target Attention is created in one Assistant-home publication when the project root is
invalid, unwritable, or a Coordinator integrity failure leaves no safe Goal-local writer. It has no
second project phase and claims no Work recovery update.

An answer to event-target Workspace Attention is handled as its own ordinary conversation turn.
Assistant uses the answer as evidence, then resolves the exact Attention only after the condition is
verified clear. Clearing that guard makes the original pending turn eligible again with the answer
visible in durable conversation history; no answer parser or hidden continuation object is required.

An internal Reflection event is a wake-up, not fresh evidence. Open targeted Attention blocks its
target; publishing its resolution removes that scheduling gate immediately and may admit another
Run. A later request cannot reconstruct the removed gate. Publishing an operator request instead
records ownership on each still-open reference without resolving it, so the same Attention remains
the scheduling blocker until the reported condition clears. Assistant receives these consequences
as environment and tool semantics rather than a prescribed call sequence.

Only the explicit Reply action copies `replyTo` and exact Attention references into a user Inbox
turn. Ordinary page context carries Project and Goal identity only; it does not attach every open
blocker. A reply may leave an Attention open when its evidence does not clear the condition.
Unrelated Attention is never settled as a page-scoped batch. Planner and Coordinator do not infer
closure from prose or from a Goal revision because an environmental or external blocker may survive it.

The Work control boundary removes a split command. Explicitly retrying a Work requests one new
invocation in the existing lineage; it does not claim that the invocation succeeded. For every open
Attention targeted exactly at that Work, the same publication resets the Work attempt boundary and
records a durable pending retry. A pending retry temporarily stops that exact Attention from blocking
dispatch or returning to Assistant, while the Attention remains unresolved and auditable. The next
invocation result owns the state transition: an executor-reported success resolves the pending
Attention, while any failed invocation clears the pending marker and appends its current diagnostic
to the same Attention. An agent-produced Attention during that invocation is failure evidence for
the pending retry rather than a second blocker identity. Failure never fabricates resolution or a
duplicate Attention. Repeating the command while the retry is pending is idempotent.

Retry reserves its exact Run ID in the same publication as the Work reset. Coordinator must use that
ID when it admits the invocation. A restart compares that Run's durable Attempt application and the
current Work stage: an applied or stage-advancing result completes the pending retry, while an
interrupted, unapplied, or failed result returns the same Attention to Assistant ownership. A
reserved Run with no Attempt may still be admitted. This closes the process-crash window without a
second binding state, retry counter, or failure-kind workflow.

This retry contract is independent of failure kind. The Work executor only reports `succeeded` or
`failed` plus its ordinary diagnostic; `retry` contains no Git-, test-, sandbox-, or vendor-specific
recovery policy. Assistant chooses a different control action, repair Work, or exact operator request
after a failed invocation. Retry does not copy the current Inbox event into Goal Input or set
`resolutionInput`. Cancellation remains a material decision and retains its accepted Input. Neither
operation closes Goal, Project, or another Work's Attention.

Consequently, retry is valid only when the current Work already contains the complete instruction and
an external or operational condition changed. It reuses the same contract and responsibility session;
it is not a channel for corrections, reviewer-like findings, or new requirements from the current
Inbox turn. Assistant persists such information in Goal design and requests Planning first, using a
new contract revision when the accepted outcome or execution contract materially changes. This keeps
one retry concept while preventing a nominal retry from silently dropping the very information meant
to repair the Work.

A changed Goal design document is canonical context, so its durable publication immediately
interrupts same-Goal responsibility Runs. The immutable publication guard remains the final race
boundary, but it should not be the normal mechanism for discovering that an obsolete Run consumed
minutes after its authority changed. A no-op design write causes no interruption.

Assistant derives the next ordinary operation from canonical target and Work state: Control retries
or cancels Work, design plus Planning changes authority, and Resolve Attention clears only a verified
condition. Creating Planning never resolves Attention, retries Engineering Work, or resets
Engineering Work. If an accepted instruction makes a blocker obsolete, Assistant resolves that exact
Attention as a separate explicit effect. An empty Planner proposal means only that Planning changed
nothing.

Retry authorizes another invocation in the same Work lineage; it is not a worktree mutation and is
not proof that a deterministic environment defect was repaired. The tool reports the request as
pending, and speaking Assistant may describe a worktree as synchronized only after the pending retry
resolves from a later state or Attempt.
An internal Reflection handoff that identifies an unchanged branch defect must request Planning or
another represented effect instead of using retry as a fictional repair. Direct operator retry keeps
the atomic settlement shortcut above because the operator instruction itself is accepted authority
to try the same lineage again.

`notBefore` only defers dispatch. Setting it never makes Work terminal, cancels it, or resolves its
Attention. Work cancellation is reserved for an explicit decision to abandon that execution route
and is not an operational or worktree-sync recovery command. It durably cancels the dependent
closure and then interrupts its live Runs, but it does not change the Goal contract or request
Planning. After every Work control operation, the control API reads canonical state again and
returns the Work's `stage`, `notBefore`, terminal fact, and failed readiness predicates; Assistant
must base its claim on that returned state rather than infer an effect from the requested command.

Project-target Workspace Attention cannot be closed by a model assertion. Explicit repair such as
Repo rebind first validates the Repo, release ref, managed root, and Project identity, then resolves
the Assistant-home Attention. A crash between those roots leaves the project conservatively blocked;
repeating the same repair is idempotent.

An open Project Attention also bounds read projection failure. If that Project package cannot be
opened, Workspace state still returns its linked Project, Repo bindings, settings, and Attention with
no fabricated Goal rows. Other Projects remain readable. A successful repair reloads runtime from the
validated canonical package before Goal rows return.

## Fixed Workflow Profile

The MVP ships one code-owned profile at
`packages/backend/profiles/software-delivery.yml`. Projects cannot override it.

```yaml
version: 1
id: software-delivery-v1

dispatch:
  - when: { kind: planning, stage: plan }
    pass: planner
    on: { success: done }

  - when: { kind: engineering, stage: generate }
    pass: generator
    on: { success: review }

  - when: { kind: engineering, stage: review }
    pass: reviewer
    on: { success: done, reject: generate }

concurrency:
  planner: 3
  generator: 3
  reviewer: 3
```

The profile supports only exact kind-stage matching, one responsibility pass per dispatch rule,
explicit success/reject transitions, Assistant-managed Attention handoff, and per-pass concurrency.
Reviewer `success -> done` is publishable only after the built-in deterministic
integration postcondition succeeds; integration behavior is Coordinator code, not profile syntax.
Concurrency remains three independent profile fields because the responsibilities may need different
resource limits later. Each limit is global to one Coordinator Home across every linked Project and
Goal; it is not multiplied per Goal or Project, and one responsibility does not consume another's
reserved capacity. The current `3 / 3 / 3` values permit bounded multi-Goal progress without adding
dynamic resource scheduling.
The profile has no hooks, expression language, inheritance, project variables, arbitrary actions,
or workflow editor.

### Home agent model settings

The fixed profile decides which responsibility runs; Home agent settings decide which configured
transport and model execute each role. Projects do not own or inherit model settings. Assistant,
Planner, Generator, and Reviewer each resolve from one Home-wide role entry, falling back only to
Assistant-home `defaults` when that role has no explicit entry.

The Home settings surface exposes Assistant, Planner, Generator, and Reviewer in one panel. Saving
a workflow role writes or removes only that role's existing `runtime/agent-adapters.json.roles`
override; it does not copy the choice into Projects or Work. Removing an override restores the Home
default. Compatible advanced adapter fields remain intact when only the model or reasoning effort
changes. UI and API settings address one of these four roles; models cannot change execution
configuration through HOPI tools. There is no Project-scoped or Assistant-only settings path.

The workspace Assistant and disposable Reflection use the same explicit Home `assistant`
configuration. It may select Codex, Claude, or OpenCode; when absent, it inherits compatible Home
defaults. The speaking Assistant's resumable session belongs to Home rather than any Project;
Reflection remains a fresh snapshot assessment. Responsibility sessions instead belong to one
`Work + responsibility` pair. Saving Assistant settings affects the next speaking or Reflection
invocation and invalidates an incompatible speaking session.
Saving a workflow role affects only responsibility Runs dispatched afterward; an already-started Run
keeps its resolved immutable command. Agent settings do not change the workflow profile, capacities,
retry policy, Work stage, or Goal revision.

Pass result values are:

- `success`: this responsibility's own output and proof are complete; apply the profile transition
  after validation and any built-in postcondition. It does not mean a later responsibility has
  already accepted the Work.
- `reject`: Reviewer returns engineering Work to `generate` with findings
- `attention`: keep the current stage and publish one or more internal Assistant-management
  requests without consuming an attempt
- `fail`: the current responsibility cannot complete this Work contract; preserve its Evidence and
  current stage, then create or reuse one ordinary Work Attention for Assistant recovery

`blocked` is not a Work field. Open targeted Attention is the one derived readiness blocker.
Reviewer `reject` returns the Work to Generator with the observed findings. There is no
Coordinator-owned semantic retry budget: `attempts` is retained history, not a readiness predicate.
Design ambiguity, missing information, or external authority returns `attention`. Coordinator
validates staged Attention documents rather than parsing pass prose for control.

Role judgment, application, and execution are separate facts:

- `RoleOutcome` is the responsibility's unchanged `success | reject | attention | fail` judgment.
- `ApplicationResult` is Coordinator's `published | invalid | stale` decision about the staged effect.
- `RuntimeFailure` is a provider, process, filesystem, worktree, or other execution-boundary failure.

Coordinator never rewrites `invalid` or `RuntimeFailure` into a semantic `fail`. Invalid proposals
publish no Evidence or control state and expose the exact validator result to the same responsibility
session. Runtime failure publishes no semantic Evidence and opens one strategy-free Work Attention
containing only the observed execution fact. That Attention pauses automatic dispatch so speaking
Assistant can inspect current state and choose whether to retry, change the environment, revise the
plan, cancel, or request operator authority. Coordinator does not choose among those paths.

Semantic invalidation is expected concurrency control, not pass failure or Project failure. A stale
guard detected before a gate, during publication, or immediately before C1 produces the same
`stale` application: retain the complete result in the Attempt, publish no canonical Evidence, do
not advance Work, and let current canonical state determine the next reconciliation. It never
creates Planning or Project Attention merely because Goal lifecycle, revision, Work ownership,
dependency truth, or another
guard changed while the Run was active.

When a durable mutation changes the immutable authority staged for a live Run, Coordinator interrupts
that exact Run as soon as the mutation commits. This avoids knowingly spending tokens on obsolete
work; the content-hash stale guard remains the correctness boundary for races, crashes, and mutations
from paths that cannot signal the live process. Authority changes do not interrupt unrelated Runs.

A pass that needs Assistant management returns `attention` with one or more staged targeted
Attentions. Coordinator publishes Evidence plus the complete set atomically, does not publish a Work
gate or increment attempts, and starts a new Attempt in the same responsibility session only after
speaking Assistant resolves the requests. Speaking may answer from
current authority, update design, request Planning, or ask the operator. Responsibilities never
handoff directly to one another.

The Run contract renders the exact owning Work target
`project:<projectId>/goal:<goalId>/work:<workId>` in the targeted Attention frontmatter for every
responsibility, including Planner. The responsibility chooses whether Attention is needed, its
stable local ID, and its Markdown request; it does not infer target syntax from document paths or
historical examples. Coordinator rejects any other target before publication and reports the exact
expected value.

A targeted Attention proposal is valid only with `result: attention`. `success`, `reject`, or `fail`
combined with targeted Attention is an invalid application and publishes neither the proposal nor
semantic Evidence. A responsibility observes its execution environment and decides whether an
unavailable capability prevents its owned outcome. It records the fact and required authority in
targeted Attention when it needs Assistant management.

Valid results by responsibility pass:

| Pass      | Results  |
| --------- | -------- |
| Planner   | `success | attention | fail`  |
| Generator | `success | attention | fail`  |
| Reviewer  | `success | reject | attention | fail` |

## Fixed Responsibility Passes

`RoleRunner` is one generic execution adapter. The profile supplies a responsibility prompt,
allowed tools, writable surfaces, and evidence expectations for each pass. Planner, Generator,
and Reviewer are replaceable responsibility passes, not separate durable agent classes.

Every responsibility Run receives an immutable context bundle staged from the current managed
root: applicable `AGENTS.md`, Goal contract, design, owning Work, relevant project documents, and
the Work/Evidence closure reachable through the owning Work's `dependsOn` edges. A Run-local
read-only artifact manifest resolves every portable `artifact:<runId>/<name>` cited by that staged
Evidence to an immutable stored file and a current-Run copy. The prompt names the copy for execution,
so a repair never has to discover or request access to a previous Run directory. The immutable
artifact remains provenance; the copy is only a disposable input projection. Dependency history
outside that DAG closure remains omitted;
the model never has to query historical Run streams merely to recover an accepted predecessor
result. Goal-local image assets explicitly cited by the owning Work are staged with that bundle and
supplied through the transport's image-input mechanism. This bundle, not the task
branch's possibly older copy of `.hopi`, is authority
for the Run. The task worktree supplies isolated source and tools. Coordinator rejects the result
if the canonical snapshot is stale at publication time. Snapshot identity covers both the selected
file set and each file's content: a newly added selected Input or design document is a semantic
change, not an invisible file outside a hash list. Engineering context does not copy unselected
Inputs, other Work history, or unrelated Evidence merely because they share the Goal directory;
Planner owns interpretation of that broader history.

Planner requires the same integration-target snapshot because it defines new ordering and scope.
Engineering results instead guard Goal, design, owning Work, permanent dependencies, relevant
Attention, and other selected authority. An unrelated C1 may advance the Project release while Generator
or Reviewer runs without making that semantic context stale; task isolation and deterministic C1
rebuild or conflict handling own the later source reconciliation.

Generator repair context and Assistant state report the current candidate integration preflight for
every Project Repo of a nonterminal Engineering Work.
That observation is produced by the same isolated-index three-way source merge used by C1 and includes
the Repo-local release head, task head, merge base, and whether the candidate is currently ready or
conflicted. It is current environment state, not a second gate or a model instruction. Owning Work
Evidence remains the immutable result of its producing Run and is labelled as historical when staged;
it is never rewritten to resemble current Git state. This keeps one definition of candidate mergeability
across execution context and publication without advancing Work, refs, or managed worktrees during
context staging.

A newly published Planning Work also does not retroactively stale an already-running Engineering
pass or block a new one. Same-revision Planning and Engineering hold independent Work leases. If
Planning changes Goal design, the owning Work, dependencies, Attention, or another selected
authority file before an Engineering result publishes, the precise content guards still reject
that result. The mere existence of Planning Work is not a semantic change.

RoleRunner normalizes Codex, Claude, OpenCode, or process output into one runtime event shape.
Coordinator appends those events to the owning Run directory and exposes them through the selected
Work's Attempt history. The UI polls only while the modal is open, follows the live tail by default,
and lets the operator inspect older Attempts. Before normalization, RoleRunner also appends every raw
stdout/stderr line to the Run's `transcript.log`; normalized summaries may be bounded for display but
the diagnostic source is not discarded. These streams are diagnostics: a transcript never advances
Work and cannot replace Evidence or a canonical gate.

Vendor-native task tracking is normalized at this boundary. A Codex todo snapshot is already
complete. Claude `TaskCreate`, `TaskUpdate`, and `TaskList` operations are reduced into the same
complete plan snapshot; their ordinary tool rows are suppressed to avoid presenting one internal
plan change twice. The reducer cache belongs to the exact vendor Session and Work contract revision,
not to Work state, and is cleared whenever that Session is rebuilt or replaced. Raw task operations
remain in `transcript.log`.

Full raw output remains on disk, while process memory retains only bounded diagnostic tails needed
for an exit summary or Preview startup response. Responsibility and Assistant runners keep the most
recent unclassified stderr lines rather than every line from a long process. Preview likewise keeps
a bounded recent startup-log tail and the active surfaces while continuing to append the complete
stream to `preview.log`. A verbose child therefore cannot make Coordinator memory proportional to
its lifetime output, and truncating the in-memory tail never truncates durable diagnostics.

Responsibility Run scratch and operating-system temporary storage have different lifetimes. The
stable responsibility workspace remains the explicit `HOPI_RUN_SCRATCH` for resumable files and
evidence candidates. Each vendor process invocation instead receives one private, short POSIX temp
directory through `TMPDIR`, `TMP`, `TEMP`, and `BUN_TMPDIR`. The short name is independent of
Project, Goal, and Work titles so tools can create Unix-domain sockets without exceeding host path
limits. It is disposable process infrastructure: Coordinator removes it only after the complete
process group has drained, and a later Attempt never treats it as retained Session state.

Raw `stderr` is not itself a product error. A vendor adapter may recognize a narrowly identified,
non-fatal vendor diagnostic and keep it only in `transcript.log`; such a line does not enter the
default Activity stream or become the fallback summary for an otherwise unexplained process exit.
This classification changes presentation, not truth: the original line remains available for
debugging, while terminal vendor errors and all unclassified `stderr` retain their existing error
semantics. The same adapter classification applies to responsibility Runs and Assistant turns.
The same boundary applies to structured stdout telemetry that carries no operator-meaningful
content. Normalization never manufactures a status row merely by humanizing an event type. Codex
thread/turn lifecycle envelopes, Claude initialization and successful terminal envelopes, OpenCode
step boundaries, and provider heartbeats such as Claude `task_progress` remain raw transcript
diagnostics. Model-authored summaries, plan snapshots, tool events, retries, and terminal errors keep
their normal semantics.

Durable JSONL streams recover only at their append boundary. Before a restarted Coordinator appends
to an existing stream, it discards the prior unterminated tail, matching the reader rule that an
unterminated final record was never durable. Readers also accept legacy crash padding only when a
line starts with one or more NUL bytes followed by a complete valid JSON record; the padding is
ignored and the record is retained. NUL bytes inside a record, malformed terminated JSON, and schema
violations remain corruption errors. Recovery therefore keeps all complete history without turning
the event log into a best-effort parser.

One provider-neutral responsibility session belongs to each
`Project + Goal + Work + responsibility + Work contractRevision` tuple. It contains both the saved
vendor conversation identity and one writable responsibility workspace. An Attempt is one process
invocation and remains a separate immutable diagnostic record; a later Attempt for the same tuple
resumes the conversation and workspace after interruption, Pause/Resume, Attention resolution,
operational retry, or a Generator/Reviewer feedback loop. A different Work, responsibility, or
material Work revision never inherits either. The first invocation receives the complete current
assignment. A resumed invocation receives every complete top-level assignment section that changed
since the Session last accepted an invocation; unchanged sections remain authoritative in the saved
conversation. If no accepted assignment snapshot exists, recovery sends the complete assignment.
After Reviewer or deterministic integration rejection returns a Work to Generator, the same
Generator Session receives the complete current assignment rather than a delta. The rejection and
current authority supersede every prior completion claim, while the retained conversation and
workspace remain useful implementation context. Generator must reassess the complete Work and reread
its referenced design authority before claiming success. Current facts always supersede remembered
conversation without replaying an unchanged contract during ordinary recovery.

Every built-in vendor adapter keeps its native automatic context compaction enabled for Planner,
Generator, and Reviewer, including a disposable first invocation and every resumed responsibility
Session. Compaction preserves the vendor Session identity and responsibility workspace. The Agent is
not prompted to request or reason about it, and HOPI does not estimate tokens, produce a parallel
summary, or add a lifecycle transition. Vendor-specific triggers and compact records remain at the
adapter and raw-transcript boundary.

The vendor process working directory belongs to the responsibility Session rather than to an
Attempt. Generator runs in the primary stable task worktree. Planner and Reviewer run in their
revision-scoped responsibility workspaces, keeping Planner proposal output and Reviewer execution
away from writable source. All named Repo roots remain available through the Repo manifest; a
multi-Repo responsibility uses the primary root only as its default source identity. Speaking
Assistant continues to use its stable Project root. No resumable vendor process uses an immutable
`runs/<runId>` record as its working directory.

Each Attempt still owns an independent Run directory for authority snapshots, proposal, result,
events, transcript, and promoted artifacts. Agents address those current-Run resources through
stable environment names such as `$HOPI_CONTEXT_FILE`, `$HOPI_AUTHORITY_ROOT`,
`$HOPI_PROPOSAL_ROOT`, `$HOPI_OUTCOME_FILE`, `$HOPI_REPOS_FILE`, and `$HOPI_RUN_DIR`; semantic
prompts do not embed their changing absolute paths. Stable contract and role sections precede
current Evidence and repair observations, so a necessary Run-local change does not invalidate the
reusable prompt prefix. Independent Run storage therefore remains an audit boundary, not a model
conversation or cache boundary.

Vendor conversation reuse additionally requires an exact execution compatibility identity covering
transport, model, reasoning variant, the effective bounded or unrestricted execution boundary, the
stable process working directory that defines the vendor Session namespace, and other adapter fields
that can change what the resumed process may understand or execute. Legacy or mismatched identities
are discarded before invocation. A narrowly recognized unresolved
infrastructure failure from a tool result, such as required sandbox initialization or execution
permission failure, also invalidates the vendor conversation after that invocation; the
responsibility workspace and canonical Attempt record remain. Ordinary command failures, failing
tests, model findings, and source defects do not invalidate a Session.

The responsibility workspace is runtime state, not authority. It retains partial media, logs, and
other files that an interrupted process would otherwise lose; the next Attempt receives its exact
path instead of searching neighboring Run directories. A model's remembered measurements never
substitute for files or logs. Only files explicitly declared by a completed result are promoted to
durable Attempt artifacts and cited by canonical Evidence. Old-revision workspaces remain diagnostic
until normal runtime cleanup, while terminal Work deletes its disposable responsibility workspaces.

RoleRunner persists a reported vendor session ID as soon as it appears in the raw stream. If the
configured transport is incompatible or the vendor explicitly rejects that session, it clears only
the vendor identity and rebuilds once inside the same Attempt from the current assignment; retained
workspace files remain available. Process transports do not resume a vendor conversation but use the
same revision-scoped workspace. OS processes and in-flight tool calls are never reattached; recovery
continues against retained files and starts a new Attempt log.

Session rejection is a transport control-plane fact, not text classification over model content.
RoleRunner accepts it only from a structured terminal vendor error or an explicit raw process error
channel. Assistant prose, command output, test failures, and documents carried inside a successful
stdout event cannot invalidate the Session merely because they contain words such as `session`,
`missing`, or `invalid`. This keeps one completed responsibility result authoritative and prevents a
second model pass from clearing or replacing its proposal.

The same narrow adapter boundary retains structured tool and execution diagnostics independently
from model prose. A nonzero process exit, missing terminal result, or explicit provider failure is an
operational failure. A successful, schema-valid responsibility result remains the model's judgment;
RoleRunner does not reinterpret it from individual tool events or infer a mandatory implementation
or verification strategy.

Every HOPI-launched Codex process uses HOPI's explicit model, reasoning, sandbox, and provider
configuration without loading the operator's global Codex configuration. Provider access is selected
when each process starts. The default bounded mode uses the adapter's workspace and declared-root
policy. A Project-local UI switch may opt newly started responsibility Runs and speaking Assistant
turns with that Project context into the ordinary HOPI OS user's filesystem, subprocess, and network
capabilities.
The adapter also explicitly selects a ChatGPT-authenticated provider with WebSocket support disabled,
so Codex uses HTTPS streaming directly instead of attempting WebSocket and falling back. Authentication
remains available, but unrelated personal MCP servers, plugins, defaults, and transport preferences
cannot delay or fail delivery. The speaking Assistant may load provider skills, while HOPI injects
semantic ownership and durable-delivery rules as developer instructions before it chooses any skill
or tool. Reflection suppresses automatic skills and host execution features. Responsibility Agents
keep the execution capabilities available inside their accepted Work; Project source instructions
and capabilities explicitly assigned by HOPI remain available. Other vendors provide the equivalent
authority ordering at their adapter boundary.

Goal reference images are passed only through a transport with an explicit image-input contract.
If a selected responsibility transport cannot accept them, RoleRunner fails visibly before the
model call instead of silently dropping accepted multimodal input. Speaking Assistant and
Reflection use the same Home-configured adapter, while Reflection never consumes the speaking or a
responsibility session. HOPI never infers cross-vendor resume from a synthetic session ID.

Attempt presentation preserves any explicit recorded result, application, and summary, including a
stale reason. Canonical Evidence may fill fields missing from a legacy or interrupted presentation,
but Evidence consumption must not overwrite the recorded Attempt application; provenance and Run
diagnostics answer different questions.

The Work-detail UI derives a compact breakdown from those immutable Attempt records and keeps
Reviewer `reject`, responsibility/process `fail`, and `interrupted` distinct. This is observability,
not another retry counter or lifecycle model. Work frontmatter `attempts` remains the sole canonical
recovery count, while the total Run count and outcome breakdown explain how execution time was spent.
HOPI does not infer a Goal-level loop from Run count, similar summaries, or unchanged source, and does
not stop normal model judgment with an arbitrary repetition threshold. A proven deterministic retry
defect is repaired at its owning dispatch or recovery boundary.

The same read boundary exposes a Goal/Work execution-cost projection. It groups Runs by
responsibility and reports elapsed time, model messages, tool calls, observed tool wall time, and
transport-reported input, cached-input, output, reasoning-output, turn, and monetary fields when the
selected vendor actually emits them. Time outside paired tool intervals is labeled model/overhead
remainder rather than exact inference time. Missing vendor facts remain unavailable, and HOPI never
applies a current price table or current Home role model to historical Runs. This projection is derived
from Attempt manifests, normalized events, and raw transcripts; it creates no budget, lifecycle,
retry, or scheduling authority.

Planner, Generator, and Reviewer receive the same resolved execution envelope that configures their
provider process. It reports the actual bounded or unrestricted mode, readable and writable roots,
network access, and scratch/cache locations. Agents may install tools, use system compilers and
caches, and start short-lived local services only to the extent that envelope permits. These
processes are Run-scoped
diagnostics, not Project Preview
and not canonical state. RoleRunner owns the child process group and terminates surviving descendants
when the Run completes, fails, is interrupted, or the Coordinator stops. Termination is one idempotent
bounded operation per Run: an OS denial falls back to the process-group leader, remains a visible
operational cleanup failure when descendant cleanup cannot be guaranteed, and never escapes as an
unobserved rejection that can terminate Coordinator. Each Run receives the
current revision-scoped responsibility workspace through the compatible `$HOPI_RUN_SCRATCH` name.
Reusable package and tool caches are redirected to the Assistant-home cache as an optimization, not
as a permission boundary. Coordinator promotes only explicitly declared proof files into the Run
artifact store. It does
not delete responsibility workspace files at an Attempt boundary.

The Project full-access preference is local runtime state, persisted outside canonical Project
documents and resolved anew for every invocation. The UI keeps a localStorage mirror, but autonomous
scheduling never depends on a mounted browser route. Codex, Claude, and OpenCode receive the same
resolved boolean. OpenCode always runs with an isolated generated configuration: bounded mode allows
ordinary tools while limiting external-directory access to the declared execution roots, and
unrestricted mode allows provider-native host access.

### Planner

Every responsibility Run receives one disposable Run prompt with four ranked parts: one primary
task, supporting authority, the execution boundary, and the result contract. Planner's primary task
is the Goal contract plus its current Planning Work and accepted Input bodies not already represented
verbatim by that contract. Generator and
Reviewer receive the owning Engineering Work as their only expanded task contract; they receive the
Goal title, revision, and canonical path as supporting provenance rather than a second competing
body, while current Goal-local design documents remain readable staged authority. Reviewer and a
recovery Generator also receive the latest owning-Work Evidence when present. Planner therefore
makes each Engineering Work complete for outcome, scope, dependencies, and measurable
acceptance, but cites canonical design paths instead of copying durable design contracts. It repeats
only a boundary whose omission would make execution or review materially ambiguous.

The four parts are data boundaries, not a workflow tutorial. The primary task states the owned
outcome. Supporting authority names current documents and observations. The execution boundary is
the resolved capability envelope plus immutable and writable roots. The result contract contains
only the structured publication protocol. Responsibility text identifies ownership and available
effects; it does not teach the model how to investigate, plan, implement, review, retry, or phrase
evidence.

Information belongs at its narrowest owner:

- actual shell, network, filesystem, source roots, scratch, cache, and browser capabilities belong
  to the execution envelope or context manifest;
- operation arguments and durable consequences belong to the matching tool schema and result;
- document shape and publication ownership belong to deterministic proposal validation;
- safety, external-side-effect authority, immutable state, and terminal result shape remain explicit
  red lines;
- strategy, sequencing, proof selection, and semantic judgment remain unconstrained.

Continuation supplies only changed current assignment sections. Recovery states only that no valid
terminal result was captured and repeats the terminal protocol. Neither surface adds failure-specific
reasoning advice.

The contract is minimal as well as complete. Every owned path, acceptance criterion, and proof
obligation must protect the requested outcome, an accepted compatibility promise, a material safety
boundary, durable persistence, or a credible regression. Planner distinguishes acceptance of the
current deliverable from completeness of a reusable validator or policy surface. It does not turn a
one-time content rewrite into a general parser, mutation corpus, schema migration, or infrastructure
project unless the Goal explicitly requests that reusable enforcement or the existing system already
treats it as the durable boundary. When reusable enforcement is required, Planner states its finite
accepted input grammar and material invariants instead of demanding correctness for unbounded
hypothetical forms.

Exact paths are defined once and reused by name inside the prompt. Content hashes remain in the
audit manifest and semantic guards, not in model prose. The immutable authority snapshot remains
separate on disk for exact reads; the prompt does not degrade into an unranked manifest that makes
the model rediscover its task.

Planner reads the Goal contract, current design, current Planning Work, Engineering Work, Inputs
accepted by that Planning Work, latest relevant Evidence, project docs, open Attention, and one
immutable snapshot of the current Assistant-home preference document. The preference is a default,
not Goal authority: current instructions and Project/Goal documents override it. Planner materializes
only relevant defaults into design or Engineering Work so Generator and Reviewer receive an explicit
delivery contract; those roles do not receive the Home preference document directly.

Planner may inspect source, tools, and external facts as deeply as needed to avoid planning from a
false feasibility assumption. Research depth is model judgment, not a fixed lightweight phase. Its
durable output still distinguishes decisions from observations: stable contracts and choices belong
in design, while a machine-local login, installed version, currently visible model, transient service
response, or one-Run measurement remains Run evidence or a Work verification requirement unless it
is generalized into a lasting product constraint.

The whole Goal package remains the semantic freshness guard, but the preference snapshot does not.
A later preference write neither invalidates an admitted Planner nor triggers Planning by itself; if
it should affect current delivery, speaking Assistant makes that effect explicit through the normal
design and Planning tools. Historical Planning, resolved Attention, unrelated Inputs, and superseded
Evidence are not staged merely because they exist. Guard coverage and model context are deliberately
separate concerns.

The staged authority is a compact responsibility view, not a claim that omitted canonical history
does not exist. An active owning Engineering Work receives its latest Evidence. Each transitive
terminal Engineering dependency receives its latest Generator/Reviewer pair, while another terminal
dependency kind receives its latest Evidence. An older Evidence explicitly cited by that Work body
is also retained. Other older `evidenceRefs` entries are not dangling and Planner never repairs them.
The complete history remains canonical; only the disposable Run projection and its semantic guard
omit superseded history. Terminal Engineering Work is immutable and remains absent from the sparse
proposal even when Planner uses its latest Evidence for completion assessment.

Each accepted Goal instruction is published atomically with its Input and the Planning Work that owns
it. The Planning Work body contains an `Accepted Inputs` section with canonical Input paths. Reusing
an existing nonterminal Planning Work appends the new path instead of creating a second planning
surface. Updating that Work invalidates any already-running Planner snapshot, so the fresh Run sees
the exact instruction without searching Input history.

Initial Planning Work is a short control envelope that tells Planner to clarify the current Goal and
accepted Inputs; it never copies the Goal objective into a second canonical document. Reusing a
nonterminal Planning Work replaces its concise Objective with the latest planning trigger and appends
new accepted Input paths, so the current assignment does not retain a stale trigger. Empty optional
Goal sections are omitted rather than filled with placeholder prose. Verbatim Input remains distinct
from the normalized Goal contract: the former preserves operator provenance, while the latter is
accepted authority. A new-contract Planning operation therefore supplies an explicit normalized
`contractChange`; HOPI links the verbatim Input to Planning and appends only that semantic change
under `Accepted Goal Change <event>`. It never promotes the raw Inbox body implicitly. Legacy
`Accepted Inbox Instruction <event>` sections remain readable, and the Run prompt does not repeat an
Input body already represented verbatim by one of those legacy sections. A latest resolved Attention
and its resolution Input remain staged for exact
provenance, but that resolution Input is not promoted into the expanded Planning Inputs unless the
Planning Work itself accepted it. Even then, its description is evidence of the condition before
settlement, not a current blocker: Planner rereads the current Attention and Work state and never
recreates a resolved Assistant-owned Attention solely because its accepted Input requested retention.
When settlement requested a final reassessment and every substantive Work is terminal with no
current targeted Attention, Planner assesses the Goal directly instead of handing the historical
control problem back to Assistant.

If Assistant adopted reference images with that instruction, the same publication installs the
Goal-local immutable assets and records their exact paths and purposes in both
`design/references.md` and the owning Planning Work. Planner therefore sees the images before it can
run; adoption cannot race Planning dispatch. Accepted reference-image input may enter Goal authority
only through these Goal-local asset paths. Assistant-home attachment paths and machine-local
absolute image paths are invalid in Goal, design, or Work prose; a useful reference must be adopted
before Planning rather than left as a non-portable path. Project-relative source image paths and
ordinary remote URLs retain their normal meaning.

It first reads root `AGENTS.md`; when missing, it silently scans the Repo and includes a concise
bootstrap file as a supporting write in the same Planning publication. This is not an initialization
task or separate gate, and an existing file is not automatically replaced. Planner then resolves
material ambiguity with the grill-me protocol: inspect code and authority before asking, traverse
dependent decisions in order, group only currently independent material questions, and include a
recommendation, alternatives, trade-offs, and downstream impact for each. It updates the relevant
`design/**` document plus `design/decisions.md` with established decisions, then proposes the
smallest independently schedulable engineering Work set, complete
acceptance criteria, all known ordering edges, and current contract revisions. It proposes targeted
Attention when an answer may materially change that output or when it cannot safely infer operator
authority; it does not ask merely to satisfy a fixed interview ritual. Design documents record
durable decisions and contracts, not the current runner's transient environment or a one-Run
feasibility observation.

Independently testable code is not automatically independent Work. Planner keeps a prerequisite and
its only consumer together when they share the same primary source surface and the prerequisite has
no separately useful operator outcome. A helper-only extraction that exists solely to enable one
panel rewrite therefore receives one Generator, Reviewer, and C1 cycle rather than a ceremonial
dependency edge. Planner splits Work only for real ordering, isolation, or independently valuable
delivery. When two resulting Work units can each start from the current integrated release, have
independently useful outcomes, and do not require one another's publication, write overlapping
source, or contend for the same exclusive external resource, Planner leaves both dependency-free so
capacity may run them concurrently. Shared read-only context, broad semantic relation, or an
anticipated integration order does not create `dependsOn`. Planner does not split a cohesive Work
merely to fill available capacity.

When Planner rewrites an existing nonterminal Engineering Work, its dependency set is monotonic:
every existing `dependsOn` edge remains and newly discovered predecessors are added alongside it.
Transitive coverage by a new predecessor does not erase historical ordering. If an accepted current
Input explicitly narrows or relaxes delivery, Planner does remove superseded objective, acceptance,
and proof clauses from the nonterminal Work instead of carrying an obsolete contract into review;
stable identity, dependency history, Evidence references, and still-authoritative safety or
persistence requirements remain. Terminal Work remains immutable.

Work cohesion is judged by proof boundary, not only by product label or shared user story. A Work is
normally cohesive when its outcome follows one canonical fact chain and can be assessed with one
primary verification strategy. Planner splits at a stable contract boundary when otherwise
independent proof strategies would form one flat cross-product of acceptance concerns, such as a
persisted loader/schema boundary followed by a UI projection. It does not split a helper or
prerequisite whose only useful outcome is still its consumer.

When one fact is repeated across artifacts, Planner records its single owner and one-way derivation
in design, then makes Work acceptance prove that chain. Different facts may have different owners;
this rule never forces a single large document. At deterministic persistence boundaries Planner
prefers a closed accepted representation or another finite verification oracle over an unbounded
negative requirement such as an ever-growing list of forbidden field aliases. These deterministic
contracts constrain persistence and execution edges, not the model's free-form reasoning or prose.

A proof file produced inside a Generator Run can bind content available in that Run, such as source
and test digests, but cannot name the checkpoint commit Coordinator creates only after the Run
settles. Coordinator Evidence owns that post-Run commit identity. Planner therefore never requires a
Run-produced artifact to predict it or duplicates the same binding across both owners.

The Project's Repo bindings are the complete source workspace for every Engineering responsibility.
HOPI does not ask Planner or Assistant to predict a smaller set before implementation begins. A Repo
that is only inspected or exercised may produce no source delta; checkpointing and C1 treat its
unchanged task branch as a no-op. This keeps environment membership deterministic while leaving the
Agent to judge what the Work actually requires.

Planner decides which adopted references matter to which Engineering Work. For every related Work,
it writes the exact Goal-relative image path and intended use or limitation into the Work Markdown.
It does not add an attachment field to Work and does not propagate unrelated Goal images merely
because they exist.

Every newly proposed Engineering Work starts at `stage: generate`; only Generator, Reviewer, and C1
advance it. Planning Work remains `plan` while clarification is required. After a complete Planner
proposal validates, Coordinator derives the Planning Work `done` gate from the current canonical
document. These are fixed profile facts, not details Planner must rediscover from history.

The Run prompt includes the compact frontmatter field shape for the new Engineering Work and
Attention documents Planner is allowed to create. These are the existing canonical document
schemas, not a plan DSL: identifiers, Markdown bodies, decomposition, dependencies, criteria, and
whether any document is needed remain model judgments. Planner reads current documents from its
immutable authority but never searches another Goal or historical Run merely to infer fixed control
fields. Coordinator owns deterministic proposal schema and DAG validation. Planner performs semantic
and proportionate content checks, but does not build an ad hoc validator that duplicates Coordinator;
validation diagnostics, if any, drive the next Attempt.

The accepted `goal.md` is immutable input to Planner. Planner records clarified implementation
decisions in `design/**` and Work acceptance criteria, never edits the Goal contract, and always
uses exactly its current `contractRevision`. Only an operator instruction accepted through an
Assistant HOPI tool may propose a Goal contract change and its revision guard.

Planner never creates or rewrites Planning Work. Success means the entire semantic proposal was
published before Coordinator changes the owning Planning Work to `done`. A clarification question
uses the ordinary Attention-producing path, targets the owning Planning Work, leaves it at `plan`,
and consumes no failed attempt.

Planner proposes only `design/**`, Engineering Work, targeted Attention, project
repository context, and a missing root `AGENTS.md`. It never creates or rewrites Planning Work or
`evidence/**`, and never appends `evidenceRefs`. Every responsibility returns only its Run-local
outcome; the interactive adapter persists it as `result.json`, while an opaque process adapter may
write that file directly. Coordinator alone derives immutable Evidence from the validated result,
preserves the current Planning Work, appends the Evidence reference, and publishes the owning gate.
Evidence from an earlier failed Planner Run is retry input, not a template for new Planner output.

Planner reads existing documents only from the immutable authority root and copies into the sparse
proposal only a document it intends to replace. It does not mirror unchanged Goal-package files;
their absence means unchanged, never deleted.

A stable Work branch is the cumulative implementation lineage for that Work ID. Planner may revise
its current objective and add dependencies while preserving that delta, because Coordinator will
synchronize it with the release before dispatch. If the accepted plan explicitly rejects reuse of
the old checkpoint or source delta, Planner does not rewrite the same Work into a nominally fresh
responsibility and does not stage an Assistant worktree-repair request. It creates a distinct
Engineering Work and may cancel obsolete nonterminal Engineering Work in the same proposal, or
narrows an existing Work to a bounded consumer or certification responsibility when its historical
identity must remain in the graph. Cancellation preserves Work and Attempt history and never
rewrites historical dependency edges.

Both writable outputs have explicit empty-file semantics. `proposal/` starts with no descendant
files, so a responsibility creates every proposed path and its parents rather than trying to update
an authority file in place. Run-local `result.json` starts as a zero-byte missing-result marker.
Interactive vendor responsibilities return one validated terminal outcome. The adapter captures the
provider's final assistant message independently from its event stream, then Coordinator validates
and persists that outcome as `result.json`, so persistence does not depend on the model remembering a
file write. A provider-native output schema may be used only when it constrains that terminal message
without constraining intermediate agent turns. Opaque process adapters retain the direct file
contract. Coordinator never fabricates success from ordinary final prose.

Interactive progress and terminal outcome are distinct output surfaces. Provider-requested progress
updates are optional, non-authoritative transcript prose: they describe current work but cannot claim
a Run result and never use the terminal result schema. The responsibility emits that JSON object
exactly once as its final response after execution settles. This separation lets provider-native
communication remain readable without leaking the machine outcome protocol into Activity.

If an interactive vendor exits cleanly without a valid outcome, the runner resumes the same Session
once inside the same Run with a narrow completion instruction. That recovery retains workspace and
conversation knowledge, does not repeat Repo preparation, and does not create another Attempt. A
second missing or invalid outcome is an operational failure and invalidates the stuck Session before
any later recovery. The Run log records an observed interactive-mode or permission cause instead of
reducing it to an empty-file symptom.
New Attention proposals use the fixed parseable `createdAt` placeholder from the Run contract;
Coordinator replaces it with publication time. A responsibility-proposed Attention ID is a readable
identity suggestion, not persistence authority. If that ID is already occupied by canonical
Attention history omitted from the sparse context, Coordinator preserves the proposal's target and
body and allocates the first free numeric-suffixed ID before publication. This collision handling is
deterministic, consumes no retry, and does not expose resolved Attention history merely to reserve
names.

The Planner process starts in its Run root because `context.md`, `repos.json`, `result.json`, and the
sparse overlay are siblings there. A canonical proposal path is written exactly once beneath the
`proposal/` child, for example `proposal/.hopi/docs/...`; Planner never treats the proposal directory
itself as cwd and then adds a second `proposal/` prefix. Engineering processes start at the assigned
Repo's `projectPath` inside their task worktree. Git checkpointing and integration still own the
complete task worktree, but C1 deterministically rejects a task commit that changes a path outside
that Repo's selected Project scope. This is one fixed path convention, not role-configurable
behavior.

Planner never consumes an unconsumed or stale responsibility result, reconstructs Evidence from Run
directories, or advances Engineering Work to `review` or `done`. Runtime files remain diagnostics;
the next responsibility Run owns a fresh result. Planner may preserve Engineering Work, reset it to
`generate` when the accepted plan materially changes, or mark obsolete nonterminal Work `cancelled`.
Coordinator expands each proposed cancellation to every nonterminal dependent, validates the whole
closure against current authority, and publishes it atomically with the accepted proposal. Terminal
Work is immutable, and new or retained nonterminal Work may not depend on cancelled Work. Assistant
Work cancellation uses the same closure primitive, interrupts every affected live Run after the
durable gate, and does not create Planning.

Planner owns requirement and design clarification after Assistant requests Planning. Assistant
does not ask a second set of delivery questions for an already-accepted Goal instruction.

Planner also owns final Goal assessment. When no nonterminal Engineering Work remains, it either
plans additional Work, requests required authority, or returns `success` with no remaining
nonterminal Engineering Work. This reuses the same Planner responsibility and adds no completion role,
completion document, or special pass.

Planner may return `success`, `attention`, or `fail`. Success means its complete sparse proposal and
Run result are ready for Coordinator validation. When the existing nonterminal Engineering DAG is
already the complete valid plan, that proposal may be empty: Coordinator records Planner Evidence
and finishes the owning Planning Work without rewriting the DAG. Attention means one exact
Assistant-management request is staged. Fail means the Run could not produce a valid proposal
without such a request;
Coordinator publishes its Evidence and creates one Work Attention so speaking Assistant can diagnose,
retry, revise, or ask the operator rather than blindly launching the same Planner. A successful
proposal either leaves nonterminal Engineering Work to execute or, during final Planning, completes
the Goal. `success` with no nonterminal Engineering Work is itself Planner's semantic completion
judgment; Coordinator verifies the release evidence and publishes the Goal transition without
inventing another model decision.

### Generator

Generator edits only the stable task worktree. Its current assignment inlines the owning Work
objective and acceptance criteria, plus the latest referenced Evidence as the reason for a retry when
present. It reads the Work contract, design, current target state, and findings from the staged
canonical context bundle; changes source and normal project docs; runs proportionate checks; and produces
Evidence. It returns `success`, `attention`, or `fail`: attention means Assistant management is
required, while fail means this Run did not complete valid implementation proof. A published fail
keeps the Engineering Work, does not consume a Reviewer-repair attempt, and creates Work Attention
instead of redispatching Generator unchanged or creating unrelated Planning. Speaking
Assistant decides whether the exact recovery is retry, Planning, cancellation, or operator action.
Generator success is deliberately local to implementation and Generator-owned proof. It advances
the Work to the independent Reviewer; Reviewer acceptance is therefore never a prerequisite for a
Generator `success`, even when the Work acceptance criteria require independent review.

A started long-running command remains active until it completes, fails, or is explicitly
cancelled. The responsibility transport presents each shell invocation as one blocking operation,
so delayed output cannot create a second model turn that starts an equivalent validation while the
first is still running. A responsibility gives any command that may outlive the shell tool's default
wait an explicit timeout sufficient for that command; it never splits or restarts valid work merely
to fit a transport timeout. If a transport instead returns a live command session, the responsibility
waits on that same session. The Codex responsibility adapter disables its asynchronous unified exec
facility; other vendor adapters must provide the same observable command boundary. Independent
responsibility Runs remain concurrent under the ordinary scheduler capacities. This is an adapter
execution property, not another durable Run state, command classifier, lock, or scheduler concept.

The current assignment presents one bounded repair view after the stable Work authority: changed
files relative to the release base and any candidate-inspection diagnostics. These are workspace
facts, not another checklist or completion state. It does not repeat the previous Generator's
claimed summary or selected command outcomes. Latest Reviewer artifacts are copied into the current
Run and mapped beside the findings. Generator may use its resumed code map to avoid repeating healthy
discovery, but it must use the current view and current paths rather than remembered Run locations.

Reviewer rejection is a semantic re-grounding boundary, not a Session boundary. The resumed
Generator receives the complete current assignment with an explicit statement that the rejection
invalidates its earlier completion judgment. It retains useful source discovery and partial edits,
but repairs the owning invariant and reassesses all acceptance criteria instead of treating the
latest findings as an exhaustive patch list. HOPI adds no rejection counter, fresh-Session rule, or
second repair protocol.

Generator treats a Reviewer reproducer as evidence that an accepted invariant is false, not as the
scope of the repair. It fixes the owning invariant, checks adjacent representations and representative
variants, and derives persisted projections from their canonical owner instead of adding pairwise
exceptions. Before claiming success it replays the latest exact reproducer. When that reproducer is
stable and the Project's existing test or validator stack can express it, Generator persists it as a
regression at the nearest owning boundary; otherwise its result explains why an ephemeral proof is
stronger. HOPI adds no checklist artifact or new structured repair protocol.

A repair Run still owns the complete Work, not only the latest rejection. After the final relevant
change, Generator reassesses every acceptance criterion materially affected by that change. When
the Work changes an operator-facing runtime or interaction path, it exercises the candidate's
primary path directly from the task worktree when the existing entrypoint permits it; focused tests
alone are enough only when they are stronger for the accepted behavior. This remains proportionate
model judgment rather than a mandatory browser checklist.

An interactive vendor Generator cannot publish `success` without completing at least one execution
capability invocation in that Run. HOPI does not prescribe a command, test framework, or checklist;
the Work and Project still determine proportionate proof. This is only the minimum execution
boundary that distinguishes an exercised candidate from a read/edit-only claim. If no execution
completes, or the required execution capability remains unavailable, the Run is operationally
failed and its vendor Session is discarded rather than carrying verification avoidance into the
next repair. Process adapters remain responsible for their own opaque execution contract.

Responsibility invocations are non-interactive even when their vendor also offers an interactive
product. The adapter disables the vendor approval layer for Codex, Claude, and OpenCode; the resolved
HOPI sandbox is the deterministic execution boundary, and an operation outside it fails without an
approval prompt. Vendor plan-entry, plan-exit approval, and direct user-question tools are also
unavailable in these invocations: HOPI Planner owns planning, and a responsibility that genuinely
needs authority returns targeted Attention. Internal reasoning, task lists, source discovery, and
proportionate execution remain available. This prevents a Generator or Reviewer from ending a clean
process while waiting for an operator who cannot answer on that channel.

When the Work body explicitly cites a Goal image asset, Generator receives both its staged local
path and the actual image input. It must apply the documented purpose rather than infer that every
visual detail is a requirement.

The assigned task worktree's Git index, HEAD, branch, and shared Git directory are HOPI-managed;
Generator edits its source files while Coordinator snapshots safe changes after the Run. This
restriction does not apply globally to Git. When accepted Work requires branch or PR delivery,
Generator may clone into `$HOPI_RUN_SCRATCH` and freely stage, commit, switch, rebase, and push there.
Remote mutation must stay within the accepted Work or operator authority; merge, deployment,
production-data mutation, or another unrequested external effect still requires explicit authority.

A responsibility Run resolves ordinary project paths from the complete Project Repo mapping in its
`HOPI_REPOS_FILE`, and reads integration truth only through the immutable context bundle. It never
searches sibling, historical, or other Work runtime directories for source. Independent reads and
checks should be batched where practical; repeated
discovery and progress narration are not evidence. The Run does not receive the Preview-adapter
`HOPI_PROJECT_ROOT` variable: exporting the managed integration root there could make a task script
bypass its stable worktree. Project Preview alone owns that variable.

### Reviewer

Reviewer independently checks acceptance criteria, diff, tests, and material runtime behavior.
It normally reads without editing source. Implementation rejection records findings and returns
the same Work to `generate`; invalid design returns `attention` for Assistant management. `success`
means the complete owning Work, including every required external effect and final acceptance
criterion, is finished. It never means that only the current candidate, phase, checkpoint, or
prerequisite gate is acceptable. If an accepted intermediate checkpoint must be preserved while a
user, Assistant, durable runner, or other resource performs remaining required work, Reviewer
returns targeted `attention`, records the accepted proof in its Evidence, and leaves the same Work
at `review`. This is the existing Attention pause, not a new phase or Work state. Reviewer success
keeps the durable stage at `review` only while Coordinator immediately attempts deterministic
integration under the same Work lease.

Before every Reviewer Run, Coordinator discards and rematerializes the HOPI-managed task checkout
from its stable task-branch checkpoint, even when `git status` reports clean. Git clean status does
not prove a stable materialization under line-ending conversion or other worktree-local changes.
The Work's committed delta from its Project-qualified release remains present, and the rebuilt files are materialized
from that exact checkpoint under HOPI's fixed Git configuration. This makes review proof
describe exactly the candidate C1 can integrate. The task checkout is disposable and the selected user checkout is untouched. A Reviewer
that writes source produces an invalid Run: Coordinator discards that Run's checkout delta and
retries Reviewer without returning Work to Generator or consuming a business recovery attempt.

Reviewer receives the same Work-selected image references as Generator, allowing visual criteria to
be checked against the original reference rather than a prose-only summary.

Reviewer attributes only the stable task branch's cumulative delta to the owning Work. Its diff base
is `git merge-base refs/heads/hopi/project/<projectId>/release HEAD`, not the current release tip: independent integrations may
move that tip after Work admission, and release-only commits or canonical `.hopi` changes are not
task changes. C1 alone owns applying the accepted task delta to the current release target.

Reviewer chooses the strongest proportionate proof for each acceptance criterion. When Work exists
because the operator reported a runtime path, crash, interaction, or visual behavior, Reviewer must
exercise that exact path through the point after the reported failure; unit or shell-level tests alone
are insufficient unless Reviewer explains why existing evidence is strictly stronger. This is an
evidence obligation, not a fixed browser workflow. Reviewer may use a Run-scoped local service and
browser harness when material. It does not own Project Preview, integration, or a persistent daemon. A
missing operator-controlled browser permission may justify targeted Attention; inability to bind a
port solely because HOPI omitted the required Run capability does not.

The Run environment exposes `HOPI_BROWSER_HARNESS_COMMAND` only when a host Browser Harness
executable and a supported local browser are installed, along with a Run-owned artifact directory
and `HOPI_BROWSER_TARGETS_FILE`. The command is a Home-owned adapter over the host Harness rather
than a direct executable path. It exposes two browser targets:

- `managed` is the default target. It uses one persistent HOPI-owned browser profile per Assistant
  Home and a dedicated DevTools endpoint. Browser Harness connections may be recreated without an
  operator permission prompt, while cookies and browser storage retained by that profile survive
  Runs and Coordinator restarts.
- `operator` attaches to the operator's running browser and therefore sees that browser's live login
  state. Its Harness daemon is Home-scoped and reused rather than restarted by ordinary Runs. Chrome
  may require operator authorization whenever that browser attachment is genuinely recreated.

These targets describe available environments, not a workflow rule or permission boundary. A role
chooses the environment whose observable properties fit its accepted task. Existing commands that
do not name a target use `managed`; `--target operator` selects the current operator browser. HOPI
does not copy, mutate, or concurrently open the operator's profile directory. The adapter owns only
the managed browser process and profile; Browser Harness continues to own its connection daemons.
The speaking Assistant receives the same adapter when its native execution envelope permits
subprocess effects; read-only Reflection does not.
The Harness command's absence is an environment fact rather than a fictitious tool path;
project-native browser tooling, package installation, network access, local ports, and Run scratch
remain available under the ordinary execution envelope.

Changing, creating, or repairing a browser-facing `scripts/hopi/preview` always makes that client
boundary material. Reviewer starts the candidate adapter independently and uses an available real
browser client to prove the user-visible state promised by accepted design. The adapter's own probe,
an HTTP success status, an application-shell response, loaded static assets, or a ready marker cannot
independently prove that state. The design supplies the observable product outcome; HOPI does not
replace it with a generic console-error rule, DOM selector list, or prescribed browser product.

Reviewer decides the proof plan before installing optional tools. It reuses the Project's documented
entrypoint and existing test/browser stack, does not install competing harnesses after decisive proof
already exists, and does not rerun an unchanged passing check. Helper-only changes normally stop at
focused tests; an operator-reported visual or interaction path receives one direct runtime exercise.

Review is bounded by the accepted contract and material risk. A defect in the requested deliverable,
an accepted input form, an explicit reusable enforcement boundary, or a material integrity/safety
invariant can reject. A malformed hypothetical variant outside the stated finite grammar cannot
expand a one-time deliverable into validator-completeness Work; Reviewer records such a limitation
without rejection when it is useful. Presentation preferences are not silently promoted into parser
requirements. If broad reusable validation is genuinely required but its accepted grammar is absent
or contradictory, Reviewer returns Attention for missing authority instead of inventing an unlimited
standard.

Reviewer orders cheap, high-risk canonical/recomputation probes before expensive broad or browser
proof when both are material. After finding a decisive implementation defect, it performs a bounded
low-cost sweep of the same invariant and other already-visible independent risks so one rejection
batches the defects currently knowable from that candidate. It stops before unrelated exhaustive
exploration. Every reproducible rejection records the violated invariant, exact command/input or
deterministic inspection steps, and observed failure in the ordinary Evidence summary. A later review
replays that reproducer first, then proves the invariant rather than only the literal example and
reuses still-valid prior evidence.

Reviewer may return `success`, `reject`, `attention`, or `fail`: reject identifies an implementation
defect against accepted criteria, attention identifies an invalid design or missing authority, and
fail means the Run could not produce a valid review and therefore creates Work Attention rather than
rerunning Reviewer unchanged or automatically returning the Goal to Planning. Every Run exposes one
writable artifact output directory. Files placed there are retained automatically; a role may also
list existing Project-relative proof paths in its result. Coordinator verifies every retained file
before publication. A Project-relative source path remains portable as-is; a Run-local file is
copied into the owning Run's durable `artifacts/` directory and replaced with
`artifact:<runId>/<artifactName>`. Proposal paths are control output discovered independently from
the proposal root and are never copied into Evidence artifacts. Missing or unreadable declared proof
produces an invalid application rather than a dangling Evidence reference or semantic failure.

Goal-scoped Assistant state projects these referenced artifacts with bounded Evidence context and a
read-only URL addressed through the owning Evidence entry. The HTTP resolver revalidates canonical
identity on every request, resolves preserved Run artifacts or a unique managed Project-relative
file, and serves content inline with conservative media types. It never accepts an absolute local
path from either the model or browser.

A Reviewer `reject` or deterministic pre-C1 integration rejection increments `attempts`. After
either returns Work to `generate`, Generator repairs the same task branch and Reviewer checks it
again.

### Coordinator integration

Coordinator integration is deterministic kernel behavior, not a responsibility pass. After
Reviewer success, Coordinator verifies the current target, constructs and checks one integration
commit `C1`, and rechecks the semantic guard. If another independent C1 advanced the target after
Reviewer staging, Coordinator rebuilds against that target; a clean merge completes without
replanning or incrementing recovery. C1 contains the source and ordinary project-document
changes, immutable integration Evidence, and the owning Work already at `done` with its Evidence
references. Qualified Work and producer Run trailers make the integration commit derivable without
copying its hash into Work.

The target is the HOPI-owned `hopi/project/<projectId>/release` branch, and C1's tree snapshots the
complete validated managed integration root plus the accepted task changes. No selected checkout,
index, or uncommitted file participates in C1 construction or managed materialization.

For a multi-Repo responsibility, `context.md` labels the primary Repo release only as the canonical
authority snapshot. `repos.json` supplies the common Project release ref and each Project Repo's
own release head. Commit identities are meaningful only inside that Repo's Git object database;
Agents are not expected to resolve the primary commit from a secondary Repo.

The guarded ref move to C1 is the one irreversible integration boundary and is independent of
`publish(bundle)`; success is reported only after Git confirms ref durability. A conflict, failed
check, or ref-update error verified to have left the old target may record Evidence and increment
`attempts`; rebuilding on a clean target advance does not. If an uncertain update leaves the ref at C1, source
is treated as integrated and the project blocks rather than publishing Work failure or retrying.
After the boundary, source is never integrated again, rolled back, or counted as Work recovery. Any
ref, commit, Work, Evidence, or managed-worktree inconsistency creates workspace project
Attention and keeps the project out of scheduling. Coordinator never repairs individual paths or
resets the managed root or mutates a selected checkout. Since ordinary
canonical publications may be newer than the last Git checkpoint, ownership alone does not make
the managed root disposable. There is no metadata follow-up commit, integration-pending state, or
merge stage. Mechanical guarantees belong to the publish ADR.

Within one managed worktree, Coordinator runs index-inspecting Git commands sequentially: commands
such as `write-tree` and `status` may both refresh and lock the same index. This is part of the one
C1 critical section, not a new resource lock, retry state, or reduction in parallel model Runs.
The temporary-index three-way merge enables Git's trivial merge rules before inspecting unmerged
entries, so an unchanged target and a task-side deletion integrate without false conflict.

## Worktrees and Parallelism

Each Repo binding has a stable managed integration worktree materializing its Project-qualified release. The
primary Git root remains the base for canonical `.hopi` publication; Project `AGENTS.md`, entrypoint
scripts, and Preview resolve beneath its portable `projectPath`. Integration and task roots live
under `<repo-parent>/.hopi-worktrees/<repo-name>/projects/<projectId>/`, distinct from the selected checkout.

An engineering Work deterministically maps to one stable task branch and worktree in each Project
Repo. Retries reuse those branches. Task worktrees live at
`.hopi-worktrees/<repo-name>/projects/<projectId>/work/<goalId>/<workId>` beside their Repo and start
from that binding's current release. A responsibility receives one logical
workspace containing all Project roots; no Repo subtask or extra responsibility is created. Checkout
directories are disposable and may be rebuilt from their stable branches after migration.

Immediately before Generator or Reviewer dispatch, Coordinator compares each stable task branch
with that binding's current release. If release is already an ancestor, no Git mutation occurs.
If the clean task branch is behind or divergent, Coordinator fast-forwards it or merges release into
it with hooks and signing disabled, preserving the task delta and then verifying a clean checkout and
release ancestry. A failed merge is aborted back to the exact prior task HEAD and creates or reuses a
Work-target Attention with the bounded conflict diagnostic; no responsibility Run starts, unrelated
Engineering Work remains eligible, and no unrelated Planning is created. A dirty Generator
checkout is preserved behind the same Work Attention when synchronization is required, because
silently resetting or merging uncheckpointed source would guess ownership. If a successful release
merge itself exposes a dirty checkout, Coordinator likewise preserves the synchronized branch and
source behind that Work Attention. Speaking Assistant requests Planning only when the represented
Goal contract or DAG must change; the synchronization condition itself does not escalate to Project
Attention, cancel Work, or create Planning automatically.

This synchronization is the implementation of dependency handoff and ordinary independent release
advance. It adds no base-commit field, sync status, repair Work, or Assistant-side Git capability.
When a plan requires an empty delta rather than preservation, only a new Work identity creates the
new branch from current release.

Planner treats that current Coordinator capability as execution authority. A historical Attempt
whose dispatch predates synchronization proves the old failure and may identify a retained source
delta, but it cannot prove that a new dispatch will repeat it. Planner may request Assistant
worktree repair only from a current Coordinator synchronization diagnostic that aborted before the
responsibility pass; otherwise it plans the semantic continuation under the synchronization rule.

HOPI materializes managed integration and task worktrees with `core.autocrlf=false` for the checkout
operation, regardless of the operator's global Git preference. This does not change the user Repo
configuration or checkout. It preserves committed blob line endings in HOPI-owned roots so an
executable script that passed review cannot become `bash\r` merely because a later Work gets a fresh
checkout.

### Repo preparation

`scripts/hopi/prepare` is an optional reviewed Repo capability rather than Project membership,
adapter routing, or lifecycle state. When present, it is foreground, non-interactive, idempotent,
prepares only its own checkout, and may populate ignored dependencies and caches without modifying
tracked or non-ignored source.

Every Engineering Run receives a runtime-only `HOPI_REPOS_FILE` containing all Project task roots,
plus the Home-owned persistent `HOPI_CACHE_DIR`. Generator and Reviewer use the accepted Work,
design, source, and actual candidate delta to decide which Repo setup and verification commands are
material. Coordinator does not execute Repo preparation before either responsibility, does not
require no-op adapters in unrelated Repos, and does not convert setup availability into a hidden
Work gate. A missing entrypoint is simply an environment fact; an Agent may create one when the
accepted outcome actually needs that durable capability.

Project Preview is deliberately Project-level. Before startup, Coordinator invokes every managed
integration Repo's `scripts/hopi/prepare` in stable manifest order with the complete integration-root
manifest and the Home cache. Each invocation receives its Repo identity and runs in its own checkout;
missing, non-executable, failing, timing-out, or source-mutating preparation prevents Preview from
claiming readiness. Each process is a bounded process-group leader so descendants are terminated
before failure is reported. Only after all Repo preparation succeeds does the primary Repo's
`scripts/hopi/preview` start.
The fixed responsibility prompt exposes the adapter's exact ready signal,
`HOPI_PREVIEW_SURFACES=<json-array>`, whenever an Engineering Work may create, repair, or review the
script; `HOPI_PREVIEW_URL=<reachable-url>` remains the single-surface shorthand, while a merely
human-readable bare URL is not enough for HOPI to leave `starting`. There is no
initialized flag, prepare revision, setup Action, or preparation Kanban state.

The public Project Preview API always starts the current managed integration release. Every Preview
session records the exact release head of every Project Repo, and a Start request never reuses a
session whose recorded heads differ from the managed integration roots. It therefore cannot prove a
pre-C1 task candidate. Engineering Work contains only acceptance criteria that Generator and
Reviewer can prove by executing the candidate script directly with that Run's Repo manifest.

When the Project exposes `scripts/hopi/preview`, a Planning Run admitted with no nonterminal
Engineering Work receives the formal release Preview session as immutable environment context.
Final Planner success is valid only while the session is `running`, its recorded Repo heads equal
the Run's release heads, and the Planner retains direct evidence from the formal operator-facing
surfaces as a current-Run artifact. Candidate Preview Evidence, an older artifact, a ready marker,
`running`, or HTTP reachability cannot support Goal completion. The Planner judges whether the
evidence directly exposes and exercises the user-visible outcome introduced by the accepted Goal.
A healthy application state that does not demonstrate that outcome proves the Preview generally,
not the Goal. Planner either completes from the demonstrated outcome or plans the smallest repair.

A Project without a Preview capability does not gain a synthetic Preview requirement: its completion
evidence remains the exact managed release/C1 projection and any other accepted external proof. This
keeps the invariant capability-based rather than turning Preview into a mandatory UI concept for
backend-only or documentation-only Projects. Final Planning remains the semantic completion pass;
there is no post-C1 role, candidate-Preview mode, or automatic completion heuristic.
The fixed API paths are `POST /api/projects/:projectId/preview/start`,
`GET /api/projects/:projectId/preview`, and `POST /api/projects/:projectId/preview/stop`; Planner
does not discover variants from Project source.

If setup or verification is wrong, the relevant Agent-run checks and Reviewer expose the defect
against the accepted Work rather than a universal Coordinator preflight. Process launch, provider
quota, interruption, and malformed Run
protocol failures are operational Run failures: they remain in Attempt diagnostics, publish no
responsibility Evidence, and do not increment Work `attempts`.

The first observed operational failure creates or reuses ordinary Work-target Attention containing
only the execution fact. Reconciler reconstructs this condition from Attempt history after restart;
it has no hidden retry threshold, backoff policy, counter, or Work field. The Attention ID and body
do not encode a failure kind. An explicit Work retry marks only blockers targeted at that Work as
pending; the later invocation result decides whether they resolve or return to Assistant ownership.

Planner reads every linked Repo's current managed source and existing Repo-local `AGENTS.md`, while
the primary root `AGENTS.md` remains the single automatically bootstrapped Project entrypoint. It
maintains `.hopi/docs/repos.md` as natural-language topology, responsibility, command, and shared
contract context when missing or materially stale. Engineering responsibilities receive the roots
listed by their owning Work. Planner and Reviewer processes start from their Run directory and see
those roots read-only; Generator alone receives write access to its assigned task worktrees.
Managed integration roots are never Agent-writable. Reviewer checks and Generator checkpointing
cover every assigned root as one logical result.

All responsibilities may write their Run root, `$HOPI_RUN_SCRATCH`, and `$HOPI_CACHE_DIR`, use the
network, and run ordinary tools. Planner writes durable decisions only to Proposal. Reviewer directs
generated output and caches to its owned roots and leaves the candidate snapshot immutable.

Coordinator recovery treats unexpected managed-integration source as system-owned projection drift:
it archives the observed bytes and patches outside the worktree, rematerializes the recorded release,
and validates the result before scheduling. Primary canonical `.hopi` documents and the allowed
Planner `AGENTS.md` bootstrap remain authoritative and are not cleaned as source drift. Selected
user checkouts are never cleaned or rewritten by this recovery path.

User-authored code enters a Project release only through an explicit ordinary Assistant Input naming a
committed branch or commit. Planner first reuses any Work already handling the same change and
otherwise plans normal Engineering Work; Generator and Reviewer inspect and integrate it through
the existing path. HOPI never reads or imports uncommitted user-checkout content, and there is no
sync watcher, import Action, or special Work kind.

After every Generator Run, Coordinator commits any safe source changes on the task branch before it
applies the pass outcome. Task branch HEAD is a durable savepoint and derived Git state rather than
duplicated Work front matter. It carries no success, retry, or stage semantics: partial changes from
`fail` or `attention` remain isolated and recoverable, while only a validated
Work gate can advance the workflow. Planning has no task worktree and a read-only Reviewer does not
create an empty commit.

After checkpointing and publishing a Generator `success`, Reviewer receives the same complete
Project workspace with clean task branches. It independently selects proportionate setup and proof
from the accepted Work and actual delta. Coordinator does not run a second command policy before
Reviewer and does not return Work to Generator merely because an unrelated Repo lacks an adapter.

Checkpointing must not require a linked Repo to track or unignore `.hopi`. HOPI first rejects any
diff to canonical files that are already tracked in the task branch, then stages the repository as
a whole without an explicit root pathspec; Git therefore skips ignored, untracked `.hopi` runtime
context normally. Canonical documents never enter a source checkpoint, while ordinary source
additions, edits, and deletions remain complete.

Generator violations such as tracked canonical `.hopi` changes normalize to pass failure. Failure
of Coordinator-owned Git metadata, branch, or commit mechanics is a Project/runtime fault: it does
not consume a Work attempt or become a Goal-local Attention proposed by the responsibility. Existing
Project validation, diagnostics, and Background Reflection own repair or escalation. Data-rescue
patches and Git crash mechanics are implementation details, not workflow stages.

A Project Attention is an Agent-managed recovery guard, not a second health-check state machine.
After inspecting current state and applying the repair it judges sufficient, Assistant may resolve
the exact Project Attention. Resolution makes the Project eligible again and wakes Coordinator; it
does not pre-validate Git or C1 a second time. If that judgment is wrong, the next existing
Coordinator, publication, or C1 boundary that observes the fault fails closed and creates a fresh
Project Attention. Assistant may claim that the guard was removed only after the resolution tool
itself succeeds.

Safe deterministic repair is attempted at the failing boundary or startup validation before a
Project Attention is created. Once the durable guard exists, Coordinator neither polls the reported
condition nor resolves the Attention from a generic Project health check. A generic check cannot
prove that every possible reported fault was repaired, and automatic resolution would race the
Assistant and repeat work behind the operator's back.

The guard prevents new responsibility admission; it does not retroactively erase a Run that was
already admitted when the fault was observed. That Run may remain `working` while its result and
lease settle. Once admitted Runs drain, the stable blocked projection is `waiting` with
`project_ineligible`. Consumers and tests must distinguish this short transition from the stable
Project-blocked state rather than introduce another lifecycle state.

Likewise, a responsibility process that never returns a valid result is not evidence that the Work
failed. Nonzero transport exit, provider quota, interrupted process, invalid result protocol, and a
Reviewer write violation finish the diagnostic Attempt as operationally unapplied while leaving the
canonical Work unchanged. Only an explicit valid responsibility result may publish Evidence and
consume semantic recovery.

Concurrency rules:

- Planner, Generator, and Reviewer each use their own profile-defined global capacity across all
  Projects and Goals in the Coordinator Home
- one writing pass at a time per task worktree
- read-only work may run in parallel
- independent writers require separate Work and worktrees
- independent same-Goal Generator Runs may execute in parallel within profile capacity; Coordinator
  may admit them on successive reconciliation ticks
- same-revision Planning and Engineering use independent Work leases and may run concurrently;
  changed selected authority makes the losing result stale
- a material contract revision interrupts already admitted Runs for that Goal after the revision is
  durable and keeps older Work ineligible by revision
- a same-revision request that changes an existing Planning Work interrupts only that Work's active
  Planner after publication
- causal publication needs, possible writer overlap, and exclusive external-resource contention are
  serialized with `dependsOn`
- deterministic source integration is idempotent by the qualified project/Goal/Work trailer

Independent tasks may finish concurrently. Final publication and integration enter the global
publication queue. Tests and conflict analysis run before entering it.

## Global Assistant

The Assistant execution contract is defined in [the Assistant design](./mvp_assistant.md). It is one
persistent configured Assistant conversation with ordinary replies and optional HOPI tool calls, not a
responsibility pass or staged-diff producer.

Conversation is the default control surface. The selected Project or Goal is context only. Common
buttons may continue to call the same deterministic controllers directly; the MVP explicitly
provides **Pause** on active Goals and **Resume** on paused Goals. Cancel, reopen, priority, timing,
design editing, and Planning may be requested in conversation, where Assistant chooses whether to call
the matching HOPI tool.

Lifecycle control has no separate worker or queue. On each ordinary reconciliation scan, a Goal
whose lifecycle is not `active` loses all of its Run leases before any further decision. The
interrupt is Goal-scoped, so pausing one Goal does not stop independent work in the same Project.
An interrupt also invalidates dispatch admission that began before the interrupt but is still
preparing canonical context or a workspace: that older reconciliation may not install a new Run
lease afterward. Coordinator shutdown uses the same project-wide boundary. This is an in-memory
execution guard, not another durable lifecycle or queue.
The existing semantic publication guard remains the final protection for a result that races the
interrupt. Resume creates a new Attempt but reuses each unfinished Work responsibility's compatible
session; Pause never turns hidden process memory into canonical state.

Assistant never edits source or canonical files directly. Its local MCP server is an adapter over
existing controllers and the global publisher. Reply prose, tool-result summaries, and raw vendor
events are never parsed for control state. When one accepted Input already defines one cohesive,
independently verifiable delivery within the current Goal contract, Assistant may publish exactly
one new Engineering Work through that adapter. The Work may depend on existing Engineering Work
and span several linked Repos. Planner still owns delivery decomposition, material Goal revisions,
durable design decisions, existing-Work rewrites, and every multi-Work publication.

The direct-Work tool has a singular schema and records immutable `assistantDispatch` provenance.
One Inbox Input has one such allowance across the Home; a matching repeat returns the existing Work,
while a different or second direct admission fails before publication. Goal-scoped speaking barriers
keep Generator admission behind the final Assistant reply. Direct Work follows the ordinary
Generator, Reviewer, and C1 profile and does not change final Planner assessment.

The MCP tool descriptions and JSON schemas injected into the Assistant turn are the only authority
for tool arguments. Assistant calls those tools directly and never searches Project files,
`.hopi/runtime`, transcripts, or HOPI source to guess a schema. It reads an exact canonical or
diagnostic path returned by `hopi_read_state` only when that file's body is actually needed; broad
runtime search is neither discovery nor evidence. Resolved Evidence artifacts distinguish an
internal `inspectionPath` from the browser-facing `operatorUrl`; only the latter belongs in an
operator reply.

An Inbox turn is eligible when it is pending, not already active in the one Home conversation, and
not covered by open event-target Attention. Public user turns have priority over internal Reflection
turns; each source class runs in receipt order. Project Attention blocks a tool targeting that
Project, not unrelated conversation or direct answers. A terminal Assistant or tool failure leaves
the turn pending under targeted Attention immediately. Vendor-local transient retry belongs to the
single configured invocation; Coordinator does not repeat that invocation. An explicitly missing,
incompatible, or context-exhausted cached conversation cannot make progress by resuming. Coordinator
clears it and rebuilds once from bounded durable conversation history. A failure from that fresh
conversation follows the ordinary targeted-Attention path; provider allocation, transport, and
application failures do not trigger a rebuild.

An internal Reflection-sourced turn owns its semantic judgment. It may act, transfer selected open
Attention, notify, or finish silently. Coordinator validates every requested effect but does not
infer an omitted action, append a correction pass, or require a fixed Attention disposition. Open
Attention remains canonical and continues blocking its target independently of that conversational
turn. A terminal failure while speaking an internal Reflection handoff is retained in that turn's
runtime record and terminates the internal Inbox event without creating event-target Attention. The
handoff is an advisory projection of already-canonical state, so recursively blocking it cannot
preserve additional user intent. Public user turns keep the ordinary targeted-Attention failure path.

Messages remain writable while passes run. A material instruction ensures Planning Work, advances
that Work and the Goal to the new `contractRevision`, and leaves existing nonterminal Engineering
Work on the revision that authorized it. Once the Goal revision is durable, Coordinator interrupts
the Goal's admitted Runs. The ordinary revision readiness predicate then keeps old routes
ineligible until Planner retains them at the current revision or cancels them. The immutable-context
publication guard remains the correctness boundary if a result races that interrupt. Before
completing an interrupted Generator Attempt, Coordinator makes one safe task-branch checkpoint of
partial source; it publishes no Evidence and advances no Work.

### State read and Reflection

The bounded HOPI state read is a current-state index, not a dump of the durable archive. It returns
Projects, Goals, scoped design, every Engineering Work, nonterminal Planning Work, open Attention,
the latest finished Planning outcome per Goal, derived Kanban facts, and an explicit list of active
Runs. Historical Planning, resolved Attention, and Evidence bodies remain canonical documents but
are not inlined by default. Home and Project reads omit Goal bodies and detailed runtime paths while
retaining the identities, readiness, latest outcomes, open Attention, and active Runs needed to
choose an exact Goal. A Goal read expands its current runtime diagnostics; Goal-scoped
`includeEvidence` additionally expands bounded Evidence bodies and artifacts only when the answer
requires the deliverable itself. Scope is the only detail control, so this remains one state model
without pagination or a query DSL.

For each Work visible in an exact Goal read, the state read returns a small runtime diagnostic descriptor: current
projection, active responsibility when present, latest Attempt summary, last event time, stale
observation, stable worktree path, and paths to `attempt.json`, `events.jsonl`, `transcript.log`,
`context.md`, `prompt.md`, and `result.json` when those files exist. It does not inline transcripts or
treat path existence as canonical truth. This gives the Assistant a direct route from a blocked card
to the full local diagnostic record without creating a second log database.

For the speaking thread only, the state result ends with the current durable Inbox event as an
attention anchor. The kernel does not classify that prose or compare it with an expected action;
repeating the event after the larger snapshot simply prevents an older turn from becoming the most
recent apparent instruction. The Reflection read path has no such operator anchor.

Coordinator derives one stable semantic digest from control-relevant state. A changed digest records
one pending assessment after the current snapshot is published, but does not alone start Reflection.
The digest includes Goal
lifecycle/revision/completion, Work stage/attempt/dependency/timing facts, Attention changes, runtime
Attempt terminal/interrupted facts, project availability, and C1 integration. It excludes raw event
growth. A running Attempt whose last activity exceeds the code-owned stale threshold contributes a
time-derived digest change so a silent hang is still assessed. The MVP threshold is ten minutes:
long enough for one high-reasoning edit or build without producing a false Reflection, while still
surfacing a genuinely silent responsibility without waiting for an operator report.

Reflection starts immediately for an Assistant-owned Attention, unavailable Project, or stale running
Attempt. All other changed snapshots wait for an idle reconciliation tick that both begins and ends
with no active responsibility Run. An old scan that overlaps a Run completion is therefore not a
settled boundary; the next tick must reconcile the newly published result first. This is one progress
predicate rather than a stage allowlist: if HOPI can still take a known automatic step, the model does
not inspect that intermediate state. A deferred digest is not marked assessed, so the same snapshot
may be assessed later if automatic progress reaches a settled boundary without another canonical
change.

Reflection runs outside the global publication mutex and responsibility capacities. There is at most
one active Reflection per Home; later changes coalesce to the latest eligible digest. The first startup
snapshot establishes a baseline instead of producing a notification storm unless it already contains
an immediate signal; an Assistant-owned Attention, unavailable Project, or stale running Attempt must
survive process restart and is assessed without waiting for a later digest. Reflection receives only
the code-derived trigger and a compact semantic delta. It does not receive a second full current-state
projection or public conversation history: both duplicate facts owned by canonical state or the
speaking thread. Work deltas contain control fields and one bounded latest-Run outcome, never archive
paths, full Evidence lists, or unrelated Goal state. Reflection may call scoped `hopi_read_state` and
follow an exact diagnostic path only after identifying a concrete candidate.

Reflection has only read plus one `handoff_to_main` capability. When all immediate signals belong to
one Project or Goal, that exact scope becomes the Reflection read context, so omitted IDs and a
Goal-only read resolve against the candidate named by the environment instead of expanding Home
state. The context locates evidence; it grants no mutation authority. A no-op result is silent, including
when Assistant-owned Attention remains open. Only an explicit handoff durably creates one internal
Inbox turn. Coordinator validates the selected scope and may attach canonical references from that
scope, but it does not select another scope or synthesize a brief. The speaking thread then
revalidates current state and owns every action and optional operator notification.

For a handoff carrying exact targeted Attention, the speaking turn may resolve it after concrete
repair, stage its exact `request_user` transfer, or leave it Assistant-owned and open while repair is
unavailable or still running. Coordinator accepts that result without a forced follow-up turn.
Existing reference, request, artifact, and mutation validation remains authoritative; a prose claim
or authorization cannot substitute for the state change represented by Attention.

One eligible pending Reflection-sourced Inbox turn suppresses another Reflection assessment until
that turn is handled. An internal turn blocked by event-target Attention is no longer eligible: it
remains pending for revalidation after resolution, but cannot suppress assessment of the Assistant-owned
blocker or newer Goal state. This does not rerun the blocked turn; it allows a new digest to hand off
the exact Attention that requires speaking-Assistant management. Canonical Attention references and
`notifiedAt` prevent recursive notification. An Attention-blocked public user turn is likewise
Reflection-eligible because no executable internal assessment currently owns that state.

The bounded-handoff guard counts only an unhandled failure chain. Once the speaking Assistant handles
the preceding handoff, that handling is convergence and the next semantic handoff starts a fresh
chain. A predecessor that remains pending because of event-target Attention extends the chain. This
keeps the loop ceiling local to the failing delivery path instead of penalizing unrelated Goal
Attention or normal speaking-thread effects.

Receiving a public user turn aborts an active Reflection-sourced speaking turn but not the independent
read-only Reflection process. Source priority selects public input next. Reflection may finish its
immutable snapshot, but Coordinator publishes its prepared brief only when the semantic digest is
still current; otherwise the result is discarded and the newest eligible digest is assessed later.
This avoids cancellation churn without letting stale thought act or delay speech. One digest is
otherwise assessed once. Reflection model transport failures retain one exponential backoff across
semantic changes, which continue to coalesce without resetting the retry delay. After repeated
failure, HOPI probes only at the capped interval until a successful Reflection clears the backoff.
Consecutive internal handoffs are also bounded so a feedback loop cannot consume unbounded calls.

## Reconciler and Scheduling

Before Reconciler starts, Coordinator fully validates the Assistant home and every linked project.
It validates each Repo binding's Project-qualified release ref, stable managed integration worktree,
and Project package. Missing or inconsistent managed projection truth creates workspace Project
Attention. Selected checkout state is outside reconciliation and remains untouched.
Invalid Assistant-home truth still fails closed to supervisor intervention.
Reconciliation, dispatch, integration, and Preview never race this startup scan or proceed from
missing original intent.

Each cycle:

1. validates the built-in profile and canonical packages
2. marks stale runtime Attempts interrupted and clears leases without reattaching children; later
   Attempts may resume their Work responsibility sessions
3. advances the oldest eligible Assistant conversation turn
4. ensures final Planning assessment when no nonterminal Work remains
5. evaluates `ready(work)` and dispatches responsibility passes within capacity
6. after Reviewer success, performs deterministic integration while Work remains at `review`
7. publishes validated outcomes and wakes dependents after upstream `done`
8. evaluates completion and routes Assistant-owned Attention through Reflection
9. observes the latest semantic digest and starts or coalesces non-blocking Reflection

`ready(work)` is one conjunction:

- Goal lifecycle is `active`
- Work kind and stage match one profile rule
- Work `contractRevision` is current
- every `dependsOn` Work is `done`
- `notBefore` is null or elapsed
- no open targeted Attention covers its project, Goal, or Work
- no active Run already owns it and pass/worktree capacity is available

The UI may show every failed predicate, but readiness is not another state machine.

For an active Goal with no nonterminal Work, Coordinator ensures Planning Work. Final Planner
`success` with no nonterminal Engineering Work is the semantic completion judgment; Coordinator
checks structural and release evidence and publishes the Goal transition in the same application.
The deterministic Reconciler never interprets success criteria itself.

There is no `orphaned` projection or second orphan-detection budget. A Goal with nonterminal Work
must be held by a visible failed readiness predicate. An invalid or otherwise unexplained hold
creates targeted Attention immediately instead of inventing another status.

Scheduling is global across projects. Goal priority orders ready Work across Goals; stable
topological order breaks ties within one Goal.

## Failure and Delivery

Work recovery has one authority: [Recovery history](./mvp_document_model.md#recovery-history).
`attempts` records reviewed repair history but does not limit scheduling. C1 only distinguishes
failure before and inconsistency after its durable ref. Neither adds another Goal or Work lifecycle
state.

### Notification

Open targeted Attention appears as **Waiting for Assistant** until the speaking Assistant has
delivered a user-facing question. An unresolved Attention with `notifiedAt` set appears as **Needs
you**. Both are projections of the same Attention document, not additional state. Raw Attention is
handled through Reflection and the speaking Assistant rather than exposed directly inside
conversation and Goal views. Goal completion appears from the Goal transition and final Planning
Evidence; legacy targetless completion Attention remains readable.
An eligible Reflection handoff binds exact canonical Goal-local or workspace Attention references
in ordinary Inbox context. The speaking turn either returns an empty final response and remains
hidden, returns a non-empty informational final response, or first calls `request_user` with exact
current Attention references and then returns the exact public question. Coordinator publishes the
complete public reply before acknowledging every still-current linked Attention. Only a staged
request sets `operatorRequest`; informational delivery leaves ownership with Assistant. Targeted
Attention may remain open after the speaking turn. Completion resolves in its acknowledgement
publication. A crash between
roots leaves a complete public reply and an unacknowledged Attention; ordinary Inbox recovery
finishes the acknowledgement. HOPI never records delivery before the message exists.

Completion delivery is an Assistant judgment over current Goal authority, Attention, Evidence, and
conversation. A Goal-scoped Evidence read exposes resolved artifacts and their browser-facing
`operatorUrl`; an internal inspection path is never a user link. The notification boundary validates
turn ownership and Attention settlement, but does not prescribe particular prose, links, or a second
Evidence read. A useful completion response may link a deliverable, identify an external result such
as a PR, or state the completed outcome directly according to the facts the Assistant has.

The same canonical reference is the UI navigation identity. Opening a **Needs you** projection loads
conversation history until it finds the handled public Assistant turn carrying that reference, then
focuses the turn for an ordinary contextual reply. This is a read projection over Inbox history, not
another field on Attention or a duplicated notification record.

The optional provider-neutral webhook configured by `HOPI_ATTENTION_WEBHOOK_URL` has one job: mirror
handled public Reflection replies. It scans those Inbox events, uses the canonical Home/event
identity as its idempotency key, and records `webhookDeliveredAt` after acknowledgement. Persistent
transport failure retries with bounded in-memory backoff. It never scans or delivers raw Attention,
never controls `notifiedAt`, and cannot create recursive Attention about delivery.

An external process supervisor is required to restart or alert on Coordinator death or an
unwritable Assistant-home publication root, because HOPI cannot persist Attention in that root.
This is a deployment capability, not a product state machine.

## Goal Completion

Planner owns the semantic completion assessment; Coordinator alone declares the lifecycle
transition.

When a Goal has no nonterminal Engineering Work, Reconciler ensures Planning Work. Planner reads the
Goal criteria, current design, Work Evidence, Git facts, and project documentation:

- if more delivery is required, it creates the smallest additional Engineering Work; after the
  proposal validates, Coordinator marks Planning Work `done`
- if operator authority or missing external information is required, it publishes targeted
  Attention and leaves Planning Work at `plan`
- if proof is sufficient, it returns `success` without creating additional Engineering Work;
  Coordinator retains the Planner Evidence, marks Planning Work `done`, and changes Goal lifecycle
  to `done` atomically

Coordinator then verifies only structural conditions:

- Goal remains `active`
- no nonterminal Planning or Engineering Work remains
- target history contains exactly one reachable commit whose qualified Work trailer equals each
  done Engineering Work identity exactly, and that commit's tree contains the Work at `done`; Work
  IDs that are prefixes of other Work IDs never match
- no open targeted Attention covers the Goal or its Work

The final Planning Evidence is the completion record. Completion creates no Attention, approval
field, dedicated role, or second lifecycle gate. Reflection observes the ordinary Goal transition
and its final Planning Evidence. Reopen increments revision when required and creates Planning Work;
historical Evidence remains immutable.

Manual completion confirmation is not required.

## Preview Capability (P2)

Preview is a Project capability, not a Goal lifecycle, Work stage, or responsibility pass. After the
shared reviewed `scripts/hopi/prepare` succeeds, a reviewed executable at `scripts/hopi/preview` owns
only project-specific startup and shutdown behavior. The UI asks Coordinator to run these adapters
directly, so ordinary Start and Stop operations do not invoke a model.

The combined contract is one-click from a clean managed integration worktree. `prepare` may use a
shared package cache or project-native installation commands; `preview` makes every declared
operator-facing surface reachable before advertising them together. A clear missing-dependency error is useful diagnosis, not successful
Preview behavior; requiring the operator to enter the managed worktree and install dependencies
violates the Project contract.

For a browser-facing Project, each advertised surface is a named operator-usable entry into
the release, not merely a transport-ready HTML shell. A Project may expose one or several surfaces;
surface identity is unrelated to Goal and Repo identity. Any host context, service, fixture, proxy, or
other runtime support required by the accepted user-visible state belongs to the Project adapter
contract. If that state cannot be produced in the provided environment, the adapter fails with
diagnosis instead of advertising a blank, fatally unmounted, or otherwise unusable page.

The first version always runs the Project's current integration target. It does not select a task
worktree, combine unintegrated Work, or construct a speculative Goal checkout. Coordinator owns the
disposable process, logs, surfaces, and health facts under runtime storage; none is canonical
workflow truth. Preview does not imply cross-Repo delivery support.

A running Preview is a lease on the release materialized when it started, not a hot-reload contract.
After C1 has durably advanced the Project-qualified release and verified the managed integration projection,
Coordinator immediately stops any running or starting Preview for that Project, clears its active surfaces,
and records runtime reason `release_updated`. Recovery that observes the C1 ref already advanced
performs the same idempotent invalidation. Planning, task-worktree changes, canonical document-only
publication, and failed or rejected C1 do not invalidate Preview. HOPI does not automatically restart:
the next explicit Start launches the current release. Preview teardown is strictly after the durable
C1 boundary and cannot roll back or reclassify a successful integration if process cleanup fails.

An open Project-target Attention blocks Preview Start because the managed integration target has not
been proven safe. Stop remains a direct runtime operation.

The executable runs as a foreground child with the managed integration root as its working
directory. Coordinator supplies `HOPI_PROJECT_ROOT` and a disposable
`HOPI_PREVIEW_RUNTIME_DIR`, stops it with `SIGTERM` (then bounded `SIGKILL`), and captures both
streams in runtime storage. Exactly one line
`HOPI_PREVIEW_SURFACES=<json-array>` is the current ready signal. Each array entry contains one
unique `id`, operator-facing `label`, and HTTP(S) `url`; the adapter emits the complete declaration
only after every surface is ready. The existing `HOPI_PREVIEW_URL=<url>` signal remains a valid
single-surface shorthand. Coordinator independently probes every declared surface in parallel and
keeps the session at `starting` until the complete declaration and all successful probes exist,
adapter exit occurs, or one bounded startup timeout expires. The
public Start request admits that operation and returns the current session immediately; it never
holds an HTTP connection across Repo preparation or adapter startup. Existing Project-state polling
observes `starting -> running|failed`. Only transport readiness produces `running`; exit, timeout,
an invalid declaration, or a failed probe records the named surface, captured logs, and ordinary
Assistant repair prompt on the same
disposable session, so a lost Start response cannot lose the diagnosis or leave the UI with only a
transport error. These are adapter I/O conventions, not generic responsibility-Run environment,
canonical Project configuration, or workflow state. Ordinary Start does not rerun semantic browser
review: the reviewed adapter and integration boundary own that evidence.

One Project has one serialized Preview operation. Concurrent Start calls share the same launch;
Stop during preparation prevents the adapter from launching, and a later Start waits for that
preparation to settle before beginning a new operation. Every unexpected preparation, filesystem,
spawn, stream, or cleanup exception closes `starting` as `failed`, preserves available diagnostics,
and permits a fresh Start instead of retaining a rejected promise.

Graceful Coordinator shutdown stops every owned Preview child. A hard kill cannot be made portable
by storing a PID: PID reuse, detached descendants, and cross-platform process semantics would create
another unreliable state machine. Production deployment therefore runs Coordinator in a supervisor
or container whose process group or cgroup is terminated with the parent. A hard-kill orphan
observed on the next Start is treated as an ordinary startup conflict and routed through Preview
repair. The MVP adds no durable Preview lease, PID document, or orphan scanner.

On Start, Coordinator first checks for the reviewed adapter. If it is missing, preparation fails, or
startup fails, the current UI observes the failed session, shows the condition, and asks whether
Assistant should establish or repair Preview. A
positive answer submits an ordinary durable message with the adapter path and available failure
logs plus immutable Project context and, when invoked from a Goal page, that optional Goal context.
Context locates relevant current authority but does not force the viewed Goal to receive the repair.
The message contains only the current failure facts and the target Project capability. It does not
prescribe Planning, Engineering, reuse, reopening, or creation. Assistant judges the appropriate
ordinary Goal and Work effect from current documents and its existing capabilities. Coordinator
does not synthesize a Work because Goal ownership and a complete acceptance contract are semantic
choices. There is no Preview setup Action, deduplication field, setup state, or
Reconciler-created Work.
