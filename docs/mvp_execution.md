# HOPI MVP Execution

Status: forward execution authority
Last updated: 2026-07-30

> [Project Owner And Attention](./mvp_project_owner.md) supersedes semantic
> Coordinator/Wake and targeted-Attention recovery rules.
> [Project Runtime Capabilities](./mvp_project_runtime.md) supersedes per-Repo Prepare, formal
> Planner Preview, canned Preview repair, and Attention-gated Preview rules.
>
> Any separate background assessment Agent, Attention ownership/transfer, structured decision prompt, or
> prescriptive recovery flow below is historical context and does not define active behavior.

This document owns semantic guards, the fixed responsibility workflow, scheduling, worktrees,
recovery, completion assessment, and notification for
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
  Goal-package snapshot and one validated Assistant-home workspace snapshot only while their
  publication generations are unchanged; ordinary Assistant, API, control, and recovery reads
  remain fresh. Restart begins from an empty cache and validates storage again. This is a read
  optimization, never a durable version, workflow fact, or substitute for publication validation.
- Snapshot hashing consumes each immutable byte view directly instead of first duplicating every
  file buffer. Publication still returns the same SHA-256 identity and copied authority snapshot;
  the optimization only removes a second transient allocation from high-frequency validation.
- Startup notification recovery consumes one validated Assistant-home snapshot for the complete
  historical scan instead of re-snapshotting Home per event. One invalid historical reference does
  not prevent independent acknowledgements; unresolved recovery failures retry with bounded
  process-local backoff rather than on every reconciliation tick.

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
- canonical Inbox Attention references govern speaking-Assistant presentation and replies
- Work references to Evidence and its qualified `producerRun` mark a responsibility-pass
  result as consumed
- current lifecycle, stage, contract revision, dependencies, and semantic guards reject obsolete
  repetition

Cross-document validation includes unique IDs, legal stages, valid references, acyclic
dependencies, at most one nonterminal Planning Work, no nonterminal dependency on cancelled
Work, current contract revisions, valid single Attention targets, evidence for completed Work, at
most one open workspace project Attention per project, and no second Work result consuming the same
qualified `producerRun`.
A home project link's expected `projectId` must match the linked `project.yml` whenever that file is
valid and readable.
A Goal Input must match one durable Inbox source by qualified Home/event identity and digest. One
turn may have Inputs in more than one explicitly tool-targeted Goal. An Agent may explicitly return
targeted Attention for a condition it cannot resolve; Coordinator validates and publishes that
proposal without inventing a recovery strategy. A failed pass instead remains Attempt history and
pauses automatic redispatch only while the exact Work authority is unchanged. Project-target
Attention is reserved for an invalid or unwritable project root; it is one Assistant-home
publication and claims no project recovery update.

Implementation mechanics belong to [the publish protocol ADR](./mvp_publish_protocol.md).

The runtime baseline is Bun `>=1.3.11 <2`. `packageManager` records the reproducible baseline, but
HOPI does not reject a supported patch or minor release merely because it is newer. Startup checks
the supported range and the test suite proves the capabilities HOPI actually uses. The Coordinator
instance lock is one long-lived exclusive transaction in a Bun SQLite file under runtime storage.
SQLite is used only as a cross-platform OS locking primitive: it stores no product or workflow fact,
is never read as authority, and is disposable after the process exits. The transaction and its OS
lock are released automatically on crash without libc-specific FFI or an external `flock`
executable.

The lock prevents a second writer; it is not a liveness signal. Coordinator startup records the
current process identity beside the lock so the local service command can stop that exact instance,
wait for its OS lock to disappear, and then start one replacement. Ordinary startup never kills or
steals from an existing owner. A lightweight health endpoint reports process identity, runtime
readiness, and the latest Coordinator tick without reading Project state.

One rejected background operation must not terminate the HTTP process. Every detached Coordinator,
Assistant, Wake, delivery, and responsibility continuation ends at an explicit runtime error
boundary. The boundary records the failure, leaves canonical state unchanged, and retries the
Coordinator with bounded backoff. Existing Project validation paths may still make only the affected
Project ineligible. Integrity failures remain visible; they are isolated rather than converted into
process failure or an unobserved Promise rejection.

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
consumed-result marker. A proposal containing targeted Attention preserves Evidence beside those
Attention documents without claiming Work progress. Unreferenced Evidence is provenance only and
does not suppress a rerun. The append-only referenced Evidence list is ordered oldest to newest and
is explicit current Work context; the staged authority may expose that bounded file index without
interpreting Evidence prose.

### Cross-root operations

Assistant home and project Git are not one atomic store. HOPI uses a simple idempotent sequence:

1. The pending Assistant turn is already durable before the configured model runs.
2. Each mutating HOPI tool names and validates its own target. Material Goal or Work decisions use
   operation-specific single-gate publications and publish Goal Input for source `(homeId, eventId)`
   as the accepted authority receipt. Dedicated operational retry and defer tools instead audit
   their exact canonical control effect without adopting the current Inbox body as Goal authority.
   Goal creation atomically establishes the Goal, its Input receipt, and the caller-authored first
   Planning or Assistant-dispatched Engineering Work. Existing-Goal direct admission atomically
   publishes its Input, supporting references, and Work gate.
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

An internal Wake event is not fresh evidence. Attention gives Assistant durable
context but does not create another scheduling state. The unchanged settled Attempt, Work, Goal, and
Project facts determine whether another Run is admitted. Assistant receives these consequences as
environment and tool semantics rather than a prescribed call sequence.

A pass that publishes targeted Attention settles the unchanged owning Work like any other failed
outcome: Coordinator must not immediately create another Attempt for that Work. The durable Attempt
records the targeted `attention` application and preserves the same scheduling consequence until
Assistant explicitly continues the Work or changes its contract. Attention presentation itself
remains outside Work readiness, so there is still only one recovery gate: the settled Attempt.

Only the explicit Reply action copies `replyTo` and exact Attention references into a user Inbox
turn. Ordinary page context carries Project and Goal identity only; it does not attach every open
blocker. The canonical reference identifies the Attention while its owning Project selects the
persistent Assistant conversation; a Workspace-stored Project Attention must not fall back to the
Home conversation. `replyTo` names the exact handled public request event. It is reply provenance,
not evidence that the condition is resolved. A reply may leave an Attention open when its
evidence does not clear the condition. Unrelated Attention is never settled as a page-scoped batch.
Planner and Coordinator do not infer closure from prose or from a Goal revision because an
environmental or external blocker may survive it.

Continuing a Work ensures that one current-responsibility invocation exists in the existing lineage;
it does not claim that the invocation succeeded or mutate Attention. An unchanged active or queued
Attempt makes the operation idempotently return that Run ID. A source-traced message or changed
`notBefore` interrupts the active Attempt and creates one successor in the same responsibility
lineage. The Inbox event is not copied into Goal Input and `resolutionInput` is unchanged.

A changed Goal design document is canonical context, so its durable publication immediately
interrupts same-Goal responsibility Runs. The immutable publication guard remains the final race
boundary, but it should not be the normal mechanism for discovering that an obsolete Run consumed
minutes after its authority changed. A no-op design write causes no interruption.

Assistant derives the next ordinary operation from canonical target and Work state: Control continues
or cancels Work, design plus Planning changes authority, and Resolve Attention clears only a verified
condition. Creating Planning never resolves Attention, retries Engineering Work, or resets
Engineering Work. If an accepted instruction makes a blocker obsolete, Assistant resolves that exact
Attention as a separate explicit effect. An empty Planner proposal means only that Planning changed
nothing.

`continue` durably queues at most one current-responsibility Attempt for a Work. It may record
source-traced guidance and set `notBefore`; it is not proof that an environment defect was repaired.
The tool reports the actual Attempt ID and whether it was newly queued, already queued, or already
running. Speaking Assistant describes success only after a later state or Attempt proves it.

`notBefore` only gates dispatch. Setting it never makes Work terminal, cancels it, or resolves its
Attention. Work cancellation is reserved for an explicit decision to abandon that execution route
and is not an operational or worktree-sync recovery command. It durably cancels the dependent
closure and then interrupts its live Runs, but it does not change the Goal contract or request
Planning. After every Work control operation, the control API reads canonical state again and
returns the Work's `stage`, `notBefore`, terminal fact, and queued Attempt identity.

Project-target Workspace Attention cannot be closed by a model assertion. Explicit repair such as
Repo rebind first validates the Repo, release ref, managed root, and Project identity, then resolves
the Assistant-home Attention. A crash between those roots leaves the project conservatively blocked;
repeating the same repair is idempotent.

An open Project Attention also bounds read projection failure. If that Project package cannot be
opened, Workspace state still returns its linked Project, Repo bindings, settings, and Attention with
no fabricated Goal rows. Other Projects remain readable. A successful repair reloads runtime from the
validated canonical package before Goal rows return.

## Fixed Delivery Workflow

The MVP owns one workflow directly in Coordinator code. Projects cannot override it:

```text
planning / plan        -> Planner   -> done
engineering / generate -> Generator -> review
engineering / review   -> Reviewer  -> done | generate
```

The workflow uses exact kind-stage matching, one responsibility per runnable stage,
explicit success/reject transitions, Assistant-managed Attention handoff, and per-responsibility
concurrency.
Reviewer `success -> done` is publishable only after the built-in deterministic
integration postcondition succeeds. The `planner: 3`, `generator: 5`, and `reviewer: 3` capacities
are code-owned constants because no supported deployment or Project can configure them. Each limit
is global to one Coordinator Home across every linked Project and Goal; it is not multiplied per Goal
or Project, and one responsibility does not consume another's reserved capacity. The unequal values
permit bounded multi-Goal progress without adding dynamic resource scheduling.

There is no second YAML declaration, workflow expression language, inheritance, Project variable,
arbitrary action, or workflow editor. Adding a supported configuration surface must begin with a
real deployment-level need; a file that can only repeat the code-owned workflow is not an extension
point.

### Home agent model settings

The fixed workflow decides which responsibility runs; Home agent settings decide which configured
transport and model execute each role. Projects do not own or inherit model settings. Assistant,
Planner, Generator, and Reviewer each resolve from one Home-wide role entry, falling back only to
Assistant-home `defaults` when that role has no explicit entry.

The Home settings surface exposes Assistant, Planner, Generator, and Reviewer in one panel. Saving
a workflow role writes or removes only that role's existing `runtime/agent-adapters.json.roles`
override; it does not copy the choice into Projects or Work. Removing an override restores the Home
default. Transport-supported advanced adapter fields remain intact when only the model or reasoning effort
changes. UI and API settings address one of these four roles; models cannot change execution
configuration through HOPI tools. There is no Project-scoped or Assistant-only settings path.

Built-in transports are portable command capabilities (`codex`, `claude`, or `opencode`), resolved
from the current Coordinator environment when an invocation starts. An explicit binary path is an
exact advanced override and must be executable. Custom executable names are never guessed or
rewritten.

The workspace Assistant uses the explicit Home `assistant` configuration. It may select Codex,
Claude, or OpenCode; when absent, it inherits Home defaults. The speaking Assistant's resumable
session belongs to Home rather than any Project; Wake only publishes an internal turn into that
conversation. Responsibility sessions instead belong to one `Work + responsibility` pair. Saving
Assistant settings affects the next speaking or supervision invocation and invalidates a nonmatching
speaking session.
Saving a workflow role affects only responsibility Runs dispatched afterward; an already-started Run
keeps its resolved immutable command. Agent settings do not change the workflow, capacities,
retry policy, Work stage, or Goal revision.

Pass result values are:

- `success`: this responsibility's own output and proof are complete; apply the workflow transition
  after validation and any built-in postcondition. It does not mean a later responsibility has
  already accepted the Work.
- `reject`: Reviewer returns engineering Work to `generate` with findings
- `fail`: the current responsibility cannot complete this Work contract; preserve its Evidence and
  current stage, and settle the Attempt against the exact Work hash

Attention is an actual staged document effect, not a second result label. When a valid proposal
contains targeted Attention, Coordinator publishes that set atomically and leaves the owning Work
unchanged regardless of the accompanying unsuccessful result.

`blocked` is not a Work field. An unchanged settled unsuccessful Attempt is a derived readiness
blocker.
Reviewer `reject` returns the Work to Generator with the observed findings. There is no
Coordinator-owned semantic retry budget; immutable Attempt history records every repair pass.
Design ambiguity, missing information, or external authority is represented by staged targeted
Attention documents. Coordinator validates those documents rather than parsing pass prose or
requiring a second matching control label.

Role judgment, application, and execution are separate facts:

- `RoleOutcome` is the responsibility's unchanged `success | reject | attention | fail` judgment.
- `ApplicationResult` is Coordinator's `published | invalid | stale` decision about the staged effect.
- `RuntimeFailure` is a provider, process, filesystem, worktree, or other execution-boundary failure.

Coordinator never rewrites `invalid` or `RuntimeFailure` into a semantic `fail`. Invalid proposals
publish no Evidence or control state and expose the exact validator result to the same responsibility
session. Runtime failure publishes no semantic Evidence or Attention. Its settled Attempt pauses
automatic dispatch against the unchanged Work so Wake can route the facts and speaking Assistant can inspect
current state and choose whether to retry, change the environment, revise the plan, cancel, or
request operator authority. Coordinator does not choose among those paths.

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

A pass that needs Assistant management stages one or more targeted Attentions. Coordinator publishes
Evidence plus the complete set atomically, does not publish a Work
gate, and starts a new Attempt in the same responsibility session only after
speaking Assistant resolves the requests. Speaking may answer from
current authority, update design, request Planning, or ask the operator. Responsibilities never
handoff directly to one another.

The Run contract renders the exact owning Work target
`project:<projectId>/goal:<goalId>/work:<workId>` in the targeted Attention frontmatter for every
responsibility, including Planner. The responsibility chooses whether Attention is needed, its
stable local ID, and its Markdown request; it does not infer target syntax from document paths or
historical examples. Coordinator rejects any other target before publication and reports the exact
expected value.

The concrete targeted Attention proposal determines this effect; its terminal result label does not
add a second authorization check. An `attention` label with no valid proposal creates no synthetic
Attention and follows the ordinary failed-Work path. A responsibility observes its execution
environment and decides whether an unavailable capability prevents its owned outcome. It records the
fact and required authority in targeted Attention when it needs Assistant management.

Valid results by responsibility pass:

| Pass      | Results  |
| --------- | -------- |
| Planner   | `success | attention | fail`  |
| Generator | `success | attention | fail`  |
| Reviewer  | `success | reject | attention | fail` |

## Fixed Responsibility Passes

`RoleRunner` is one generic execution adapter. The workflow supplies a responsibility prompt,
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
Engineering results instead guard Goal, design, owning Work, its current dependencies, relevant
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
and lets the operator inspect older Attempts. Before normalization, RoleRunner also appends every
stdout/stderr line to the Run's `transcript.log`; normalized summaries may be bounded for display but
the diagnostic source is not discarded. Event and execution-identity writes are part of the Attempt
boundary: persistence failure fails the pass instead of silently presenting an incomplete trace. The
one exception is deterministic secret redaction: exact
values inherited through secret-like environment names are replaced before transcript, normalized
event, error-summary, or public-reply persistence. This boundary applies to every built-in role and
does not otherwise classify or rewrite process output. These streams are diagnostics: a transcript
never advances Work and cannot replace Evidence or a canonical gate.

The durable Attempt manifest is the sole runtime authority for whether that Run is active. One
Attempt begins before Project preparation and keeps the same Run ID through preparation, model
execution, publication, and cleanup. Task-worktree synchronization uses the same reserved Run ID
and records an operational Attempt if it fails before context staging. Attempt events distinguish
those runtime boundaries without adding Work stages. One Work may have at most one nonterminal
Attempt, so concurrent ticks, ordinary scheduling, and explicit retry all converge on the same
identity. After the manifest becomes terminal the Work is publicly non-running; a later
responsibility or retry receives a new Run ID.

Coordinator reconciliation is edge-triggered. Startup, canonical publication, Assistant effects,
Run completion, Preview events, topology changes, and Project availability changes coalesce into
one wake. Project startup and recovery validation therefore update eligibility and diagnostics but
do not create a second Assistant Inbox event. When time alone can change readiness, Coordinator
arms one timer for the earliest `notBefore` or delivery retry deadline. An idle Coordinator does
not repeatedly scan every Project, Goal, and Attempt.

Vendor-native task tracking is normalized at this boundary. A Codex todo snapshot is already
complete. Claude `TaskCreate`, `TaskUpdate`, and `TaskList` operations are reduced into the same
complete plan snapshot; their ordinary tool rows are suppressed to avoid presenting one internal
plan change twice. The reducer cache belongs to the exact vendor Session and Work contract revision,
not to Work state, and is cleared whenever that Session is rebuilt or replaced. Raw task operations
remain in `transcript.log`.

Full diagnostic output remains on disk after the same secret redaction, while process memory retains
only bounded diagnostic tails needed
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
This classification changes presentation, not truth: the diagnostic line remains available for
debugging, while terminal vendor errors and all unclassified `stderr` retain their existing error
semantics. When a vendor mirrors a completed command's structured output line-for-line on process
`stderr`, the adapter emits the structured command result once and suppresses only those exact
mirrored lines from normalized Activity. A bounded per-process cache performs this presentation
deduplication; the diagnostic lines remain losslessly recorded in `transcript.log` after secret
redaction. The same adapter
classification applies to responsibility Runs and Assistant turns.
The same boundary applies to structured stdout telemetry that carries no operator-meaningful
content. Normalization never manufactures a status row merely by humanizing an event type. Codex
thread/turn lifecycle envelopes, Claude initialization and successful terminal envelopes, OpenCode
step boundaries, and provider heartbeats such as Claude `task_progress` remain raw transcript
diagnostics. Model-authored summaries, plan snapshots, tool events, retries, and terminal errors keep
their normal semantics.

Durable JSONL streams recover only at their append boundary. Before a restarted Coordinator appends
to an existing stream, it discards the prior unterminated tail, matching the reader rule that an
unterminated final record was never durable. NUL bytes, malformed terminated JSON, and schema
violations remain corruption errors. Recovery therefore keeps all complete history without turning
the event log into a best-effort parser.

One provider-neutral responsibility session belongs to each
`Project + Goal + Work + responsibility + Work assignment fingerprint` tuple. The fingerprint is the
canonical Work document without append-only `evidenceRefs`; it still includes the Work body, stage,
dependencies, scheduling, kind, and contract revision. It contains both the saved vendor conversation
identity and one writable responsibility workspace. An Attempt is one process invocation and remains
a separate immutable diagnostic record; a later Attempt for the same tuple resumes the conversation
and workspace after interruption, Pause/Resume, Attention resolution, operational retry, or a
Generator/Reviewer feedback loop. Appending Evidence history does not fork a Session. A Planner
change to executable Work authority does, even when the Goal contract revision itself stays current.
A different Work, responsibility, or material Work assignment never inherits either. The first
invocation receives the complete current assignment. A resumed invocation receives every complete
top-level assignment section that changed since the Session last accepted an invocation; unchanged
sections remain authoritative in the saved conversation. If no accepted assignment snapshot exists,
recovery sends the complete assignment.
After Reviewer or deterministic integration rejection returns a Work to Generator, the same
Generator Session receives the complete current assignment rather than a delta. The rejection and
current authority supersede every prior completion claim, while the retained conversation and
workspace remain useful implementation context. Generator must reassess the complete Work and reread
its referenced design authority before claiming success. It reconciles the repaired candidate and
its evidence against every accepted criterion rather than treating the latest findings as the new
scope. Current facts always supersede remembered conversation without replaying an unchanged
contract during ordinary recovery.

Every built-in vendor adapter keeps its native automatic context compaction enabled for Planner,
Generator, and Reviewer, including a disposable first invocation and every resumed responsibility
Session. Compaction preserves the vendor Session identity and responsibility workspace. The Agent is
not prompted to request or reason about it, and HOPI does not estimate tokens, produce a parallel
summary, or add a lifecycle transition. HOPI records a provider compaction boundary as
non-presentable runtime status while retaining its raw transport event. Vendor-specific triggers and
compact records otherwise remain at the adapter and raw-transcript boundary.

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
prompts and staged context do not embed their changing physical paths. For a resumable
responsibility Session, these names resolve through one stable `current` view inside the
responsibility workspace. Before invocation, Coordinator atomically points that view at the new
immutable Run directory. The Agent therefore keeps one valid environment across Attempts while every
write still lands directly in the owning Run's proposal, result, transcript, or artifact directory.
Replacing the view never changes an older Run directory. Stable contract and role sections precede
current Evidence and repair observations, so a
necessary Run-local change does not invalidate the reusable prompt prefix. Independent Run storage
therefore remains an audit boundary, not a model conversation or cache boundary.

Vendor conversation reuse additionally requires an exact execution identity covering
transport, model, reasoning variant, the effective bounded or unrestricted execution boundary, the
stable process working directory that defines the vendor Session namespace, and other adapter fields
that can change what the resumed process may understand or execute. Mismatched identities are
discarded before invocation. A narrowly recognized unresolved
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
configured transport no longer matches or the vendor explicitly rejects that session, it clears only
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
when each process starts. Its shell environment explicitly inherits the environment passed to that
Codex process rather than a provider default subset or a cached interactive-shell snapshot. The same
adapter rule applies to Planner, Generator, Reviewer, and Assistant. A credential missing from the
HOPI process remains missing from those responsibility environments, and a credential present there
is not role-dependent. The sole Preview exception is an explicitly admitted session-only file
reference; it is not inherited by responsibility processes or retained by the HOPI manager.
Project Assistant, responsibility Runs, and Preview also receive the same Home-level
`HOPI_CACHE_DIR`; this names shared reusable runtime data rather than Work or conversation state.
The default bounded mode uses the adapter's workspace and declared-root policy. A Project-local UI
switch may opt newly started responsibility Runs and speaking Assistant turns with that Project
context into the ordinary HOPI OS user's filesystem, subprocess, and network capabilities.
The adapter also explicitly selects a ChatGPT-authenticated provider with WebSocket support disabled,
so Codex uses HTTPS streaming directly instead of attempting WebSocket and falling back. Authentication
remains available, but unrelated personal MCP servers, plugins, defaults, and transport preferences
cannot delay or fail delivery. The speaking Assistant may load provider skills, while HOPI injects
the same compact semantic-ownership and durable-delivery contract at each provider's system or
developer-instruction boundary before it chooses any skill or tool. That contract defines ownership
and environment consequences rather than message keywords or a tool-selection procedure. Wake has no
model execution surface. Responsibility Agents keep the execution
capabilities available inside their accepted Work; Project source instructions and capabilities
explicitly assigned by HOPI remain available. Other vendors provide the equivalent authority
ordering at their adapter boundary.

Goal reference images are passed only through a transport with an explicit image-input contract.
If a selected responsibility transport cannot accept them, RoleRunner fails visibly before the
model call instead of silently dropping accepted multimodal input. A supervision fork uses the same
Home-configured adapter and scoped speaking session. HOPI never infers cross-vendor resume from a
synthetic session ID.

Attempt presentation preserves every recorded result, application, and summary, including a stale
reason. Evidence consumption never overwrites the recorded Attempt application; provenance and Run
diagnostics answer different questions.

The Work-detail UI derives a compact breakdown from those immutable Attempt records and keeps
Reviewer `reject`, responsibility/process `fail`, and `interrupted` distinct. This is observability,
not another retry counter or lifecycle model. Work has no recovery count; the Attempt log and outcome
breakdown explain how execution time was spent. HOPI does not infer a Goal-level loop from Run count,
similar summaries, or unchanged source, and does not stop normal model judgment with an arbitrary
repetition threshold. A proven deterministic retry defect is repaired at its owning dispatch or
recovery boundary.

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
current revision-scoped responsibility workspace through the stable `$HOPI_RUN_SCRATCH` name.
Reusable package and tool caches are redirected to the Assistant-home cache as an optimization, not
as a permission boundary. Coordinator promotes only explicitly declared proof entries into the Run
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
Every canonical Source label is rooted explicitly at `$HOPI_AUTHORITY_ROOT`; an identically named
file in a task worktree is source history, not current authority.

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

Continuation supplies only changed current assignment sections. A missing or invalid terminal
result settles the current Attempt as an operational failure; HOPI does not start a second model
invocation with corrective advice.

The contract is minimal as well as complete. Every owned path, acceptance criterion, and proof
obligation must protect the requested outcome, an accepted contract promise, a material safety
boundary, durable persistence, or a credible regression. Planner distinguishes acceptance of the
current deliverable from completeness of a reusable validator or policy surface. It does not turn a
one-time content rewrite into a general parser, mutation corpus, schema framework, or infrastructure
project unless the Goal explicitly requests that reusable enforcement or the existing system already
treats it as the durable boundary. When reusable enforcement is required, Planner states its finite
accepted input grammar and material invariants instead of demanding correctness for unbounded
hypothetical forms.

Exact paths are defined once and reused by name inside the prompt. Content hashes remain in the
audit manifest and semantic guards, not in model prose. The immutable authority snapshot remains
separate on disk for exact reads; the prompt does not degrade into an unranked manifest that makes
the model rediscover its task.

Planner reads the Goal contract, current design, current Planning Work, Engineering Work, Inputs
named by explicit Work `contextRefs`, referenced Evidence, project docs, open Attention, and one
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
does not exist. It selects canonical paths from Work `contextRefs`, dependency edges, and
`evidenceRefs`; it never searches Work or Evidence prose to discover hidden references. Terminal
Engineering Work is immutable and remains absent from the sparse proposal even when Planner uses its
Evidence for completion assessment.

Each accepted Goal instruction is published atomically with its Input and the Work that owns it.
That Work records the Input path in `contextRefs`. Reusing an existing nonterminal Planning Work
merges the new explicit references instead of creating a second planning surface. Generator and
Reviewer receive the same selected Input without a Markdown heading convention. Empty optional Goal
sections are omitted rather than filled with placeholder prose. A new-contract Planning operation
supplies an explicit normalized `contractChange`; replacing the whole current Planning assignment is
the declared tool effect, not a heading rewrite. A latest resolved Attention and its resolution Input
remain staged for exact provenance only when named by current structured authority.
When settlement requested a final reassessment and every substantive Work is terminal with no
current targeted Attention, Planner assesses the Goal directly instead of handing the historical
control problem back to Assistant.

If Assistant adopted reference images with that instruction, the same publication installs the
Goal-local immutable assets and records their exact paths and purposes in the owning Work
`contextRefs`. Planner therefore sees the images before it can
run; adoption cannot race Planning dispatch. Accepted reference-image input may enter Goal authority
only through these Goal-local asset paths. Assistant-home attachment paths and machine-local
absolute image paths are invalid in Goal, design, or Work prose; a useful reference must be adopted
before Planning rather than left as a non-portable path. Project-relative source image paths and
ordinary remote URLs retain their normal meaning.

It first reads root `AGENTS.md`; when missing, it silently scans the Repo and includes a concise
bootstrap file as a supporting write in the same Planning publication. This is not an initialization
task or separate gate, and an existing file is not automatically replaced. Planner resolves only
material ambiguity that prevents the current Goal boundary from being represented. It updates the relevant
`design/**` document plus `design/decisions.md` with established decisions, then proposes only the
Engineering Work needed to reach the current Goal boundary, with measurable acceptance and real
ordering edges. Current authority may shrink or replace earlier nonterminal Work. Deferred rollout,
certification, governance, and hypothetical future variants stay outside current completion unless
the Goal explicitly includes them. It proposes targeted Attention only when the current boundary
cannot advance without missing authority; it does not preserve an obsolete requirement merely
because an earlier plan mentioned it. Design documents record durable decisions and contracts, not
the current runner's transient environment or a one-Run feasibility observation.

Work cohesion is judged by proof boundary, not product label, shared user story, or runtime process.
A Work is cohesive when one durable candidate follows one canonical fact chain and Reviewer can
assess it through one primary verification strategy. Planner splits at a stable contract or artifact
boundary when accepted concerns require independent proof, even when the ordered Work serves one
product or runtime flow. A validated prerequisite is a durable outcome for its dependents even when
it is not directly operator-facing.

Independently testable code alone is not a Work boundary. A helper or refactor whose only useful
effect remains inside its consumer receives the same Generator, Reviewer, and C1 cycle. Sparse means
omitting such ceremonial Work, not merging distinct terminal proof boundaries. Planner does not
split a cohesive Work merely to fill available capacity.

When two resulting Work units can each start from the current integrated release and do not require
one another's publication, write overlapping source, or contend for the same exclusive external
resource, Planner leaves both dependency-free so capacity may run them concurrently. Shared
read-only context, broad semantic relation, or an anticipated integration order does not create
`dependsOn`.

When Planner rewrites existing nonterminal Engineering Work, it owns the current `dependsOn` graph:
it may add, remove, or redirect edges as one atomic proposal when its semantic plan changes.
Coordinator validates only graph integrity, not historical monotonicity. If an accepted current
Input narrows or relaxes delivery, Planner likewise removes superseded objective, acceptance, and
proof clauses instead of carrying an obsolete contract into review. Stable identity, append-only
Evidence references, and still-authoritative safety or persistence requirements remain. Terminal
Work remains immutable, including its accepted dependency edges.

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
document. These are fixed workflow facts, not details Planner must rediscover from history.

The Run's proposal-capabilities file contains the compact frontmatter field shape and path identity
relationship for every new Engineering Work and Attention document Planner may create. A document
path is `{directory}/{id}.md`; the frontmatter `id` and filename stem are the same canonical identity.
The execution boundary states that unlisted paths or field values are rejected at publication, so the
deterministic contract does not need to be inferred from another Goal, a historical Run, or HOPI
source code. These are the existing canonical document schemas, not a plan DSL: identifiers, Markdown
bodies, decomposition, dependencies, criteria, and whether any document is needed remain model
judgments. Coordinator owns deterministic proposal schema and DAG validation. Planner performs
semantic and proportionate content checks, but does not build an ad hoc validator that duplicates
Coordinator. A rejection diagnostic names the offending field and accepted value set so Assistant
can repair or retry without reverse-engineering the parser.

The accepted `goal.md` is immutable input to Planner. Planner records clarified implementation
decisions in `design/**` and Work acceptance criteria, never edits the Goal contract, and always
uses exactly its current `contractRevision`. Only an operator instruction accepted through an
Assistant HOPI tool may propose a Goal contract change and its revision guard.

Planner resolves ambiguity from current authority with its own judgment. When the accepted outcome
truly requires operator authority, it may stage a targeted Attention; `decisionPrompt` defines only
the validated presentation shape, not a mandatory questioning workflow. Clarification strategy,
question grouping, assumptions, and what belongs in `design/**` remain model judgment.

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
its current objective and dependency edges while preserving that delta, because Coordinator will
synchronize it with the release before dispatch. If the accepted plan explicitly rejects reuse of
the old checkpoint or source delta, Planner does not rewrite the same Work into a nominally fresh
responsibility and does not stage an Assistant worktree-repair request. It creates a distinct
Engineering Work and may cancel obsolete nonterminal Engineering Work in the same proposal, or
narrows an existing Work to a bounded consumer or certification responsibility when its historical
identity must remain in the graph. Cancellation preserves Work and Attempt history; terminal Work
and its accepted dependency edges remain immutable.

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

The Planner process starts in its stable responsibility workspace. Its `current` view exposes
`context.md`, `repos.json`, `result.json`, and the sparse overlay from exactly one current Run. A
canonical proposal path is written exactly once beneath `$HOPI_PROPOSAL_ROOT`, for example
`.hopi/docs/...`; the physical `runs/<runId>` location is not part of the model environment.
Engineering processes start at the assigned Repo's `projectPath` inside their task worktree. Git
checkpointing and integration still own the complete task worktree, but C1 deterministically rejects
a task commit that changes a path outside that Repo's selected Project scope. This is one fixed path
convention, not role-configurable behavior.

Planner never consumes an unconsumed or stale responsibility result, reconstructs Evidence from Run
directories, or advances Engineering Work to `review` or `done`. Runtime files remain diagnostics;
the next responsibility Run owns a fresh result. Planner may preserve Engineering Work, reset it to
`generate` when the accepted plan materially changes, or mark obsolete nonterminal Work `cancelled`.
The same proposal may atomically revise that Work and rewire current nonterminal dependency edges so
retained Work no longer depends on a cancelled route. Coordinator preserves the Planner's accepted
terminal snapshot and validates the resulting graph rather than expanding or rewriting Planner
intent. New or retained nonterminal Work may not depend on cancelled Work. Direct Assistant Work
cancellation still cascades through current dependents, interrupts every affected live Run after the
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
without such a request. Coordinator publishes its Evidence and settles the failed Attempt against the
unchanged Work, so Wake can route the facts and speaking Assistant can diagnose, retry, revise, or ask the operator
rather than blindly launching the same Planner. A successful
proposal either leaves nonterminal Engineering Work to execute or, during final Planning, completes
the Goal. `success` with no nonterminal Engineering Work is itself Planner's semantic completion
judgment; Coordinator verifies the release evidence and publishes the Goal transition without
inventing another model decision. A Goal-package document named by the Planner's result must exist
in either the immutable current authority or this Run's sparse proposal. A reference to a document
written into another Run, a stale Session path, or no persisted document is an invalid application;
it cannot serve as Evidence or make an empty current proposal complete the Goal.

### Generator

Generator edits only the stable task worktree. It reads the Work contract and staged canonical
context, uses the available environment, and returns `success` or `fail`. A valid targeted Attention
proposal is the separate durable request for Assistant management. A published fail keeps the
Engineering Work and pauses unchanged redispatch through its settled Attempt. Speaking Assistant
decides the next action from current facts.
Generator success is deliberately local to implementation and Generator-owned proof. It advances
the Work to the independent Reviewer; Reviewer acceptance is therefore never a prerequisite for a
Generator `success`, even when the Work acceptance criteria require independent review. That local
success still covers the complete accepted implementation outcome: every contract-required source
change, durable artifact, generated dataset, report, or other deliverable that can be produced
within Generator authority must already exist in the assigned writable roots. A smaller sample,
checkpoint, or demonstration is evidence about the implementation, not a substitute for a larger
accepted deliverable.

A started long-running command remains active until it completes, fails, is explicitly cancelled, or
reaches its selected timeout. A live command Session is the same shell invocation, not another model
turn, Work, or responsibility Run. Codex unified exec therefore remains available so an Agent can
observe, interact with, and terminate one long-running invocation without detaching it or starting
equivalent work in parallel. Independent responsibility Runs remain concurrent under the ordinary
scheduler capacities. This is an adapter execution property, not another durable Run state, command
classifier, lock, or scheduler concept.
HOPI observes descendant process groups while the responsibility invocation is alive and terminates
the observed tree when that invocation settles or is interrupted. A descendant that deliberately
escapes before it can be observed is not an independent Work Attempt, has no durable result owner,
and is never treated as responsibility progress.

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
Project Preview service database effects are the narrow exception: connection selection belongs to
Project configuration, so responsibilities do not classify or isolate its database and do not block
Preview on another approval. Assistant may issue an informational data-change warning afterward.

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
means the received candidate satisfies the current owning Work contract. Reviewer does not extend
that contract with future rollout, certification, governance, or hypothetical requirements. If the
current accepted Work itself requires operator authority or an external action outside both
responsibility boundaries, Reviewer returns targeted `attention`. Reviewer success keeps the durable
stage at `review` only while Coordinator immediately attempts deterministic integration under the
same Work lease.

Reviewer verifies the candidate as received. It may execute independent reproduction, recomputation,
or inspection and retain those results as review evidence, but it does not create a missing
contract-required Project deliverable or become the only Run that materializes one. Missing,
incomplete, or defective deliverables within Generator authority are implementation defects and
therefore `reject`. Attention is reserved for missing authority, an operator decision, invalid
accepted design, or a required external action that neither Generator nor Reviewer can perform.

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

Before starting a responsibility sandbox that exposes this command, the host ensures the default
managed browser has a healthy DevTools endpoint. The bounded Agent therefore attaches through a
ready Home-owned capability instead of trying to launch Chrome from inside its sandbox. A failed
host preflight is an operational Run failure, not application evidence and not a reason to replace
browser verification with transport checks.

The adapter is a Python-stdin runner rather than a Playwright-compatible CLI. A role invokes it with
the helper program on standard input, for example:

```sh
"$HOPI_BROWSER_HARNESS_COMMAND" --target managed <<'PY'
goto_url(...)
wait_for_load()
print(page_info())
PY
```

Helpers such as `js(...)` and `capture_screenshot(...)` provide semantic and rendered evidence
without reverse-engineering the installed Harness.

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
subprocess effects; Wake performs no model invocation.
The Harness command's absence is an environment fact rather than a fictitious tool path;
project-native browser tooling, package installation, network access, local ports, and Run scratch
remain available under the ordinary execution envelope.

Project Preview behavior, invocation, evidence, and failure routing are owned exclusively by
`mvp_project_runtime.md`. Reviewer uses the evidence appropriate to the accepted Work and available
environment; this document adds no Preview-specific proof rule.

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
fail means the Run could not produce a valid review and therefore pauses unchanged automatic
redispatch without creating Attention or returning the Goal to Planning. Every Run exposes one
writable artifact output directory. Entries placed there are retained automatically; a role may also
list an existing Project-relative or Run-local filesystem entry in its result. An artifact is one
retained filesystem subtree, not specifically a regular file. Coordinator snapshots a readable file
or directory on a best-effort basis without requiring the Agent to pre-package a directory. A
Project-relative source entry remains portable as-is; a Run-local entry is copied into the owning
Run's durable `artifacts/` directory and replaced with
`artifact:<runId>/<artifactName>`. Proposal paths are control output discovered independently from
the proposal root and are never copied into Evidence artifacts. A missing or unreadable reference is
reported in current and later Run context as unavailable supporting material. It does not override
the Agent's semantic result, but it remains visible to Reviewer and Assistant when they judge whether
the absent proof matters. Multiple declarations that resolve to the same retained subtree produce
one stable Evidence reference.

Goal-scoped Assistant state projects these referenced artifacts with bounded Evidence context and a
read-only URL addressed through the owning Evidence entry. The HTTP resolver revalidates canonical
identity on every request and resolves preserved Run artifacts or a unique managed Project-relative
entry. Files are served inline with conservative media types; a directory opens as a bounded inert
index while responsibility context receives a read-only directory projection. The resolver never
accepts an absolute local path from either the model or browser.

A Reviewer `reject` or deterministic pre-C1 integration rejection is retained in Attempt history.
Either returns Work to `generate`, where Generator repairs the same task branch and Reviewer checks
it again. Each published Reviewer `reject` is also an immediate, recoverable Project Assistant wake
condition. The next Generator does not wait for that Assistant turn; wake events coalesce while the
Assistant is active, and the Assistant receives current Attempt history and live-Run state for
supervision rather than becoming another review gate. The active responsibility Attempt remains the
only owner of that Work's execution and Evidence. Concurrent Assistant shell effects are outside
that Attempt even when they persist on the host or a remote system. They gain no managed task
lineage, Evidence, independent review, retry, recovery, or supervision and cannot substitute for its
result. Unrestricted execution access changes available capability, not responsibility ownership.

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
authority snapshot. `repos.json` is a `candidate` projection: its paths are the complete task
workspace and its heads are the commits checked out at those exact paths. The context separately
names the common Project release ref and each Repo's base release head. Project Preview receives a
`release` projection whose paths and heads both identify the managed integration roots. Commit
identities are meaningful only inside that Repo's Git object database; Agents are not expected to
resolve the primary commit from a secondary Repo.

The guarded ref move to C1 is the one irreversible integration boundary and is independent of
`publish(bundle)`; success is reported only after Git confirms ref durability. A conflict, failed
check, or ref-update error verified to have left the old target may record Evidence and a rejected
Attempt; rebuilding on a clean target advance does not. If an uncertain update leaves the ref at C1, source
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
directories are disposable and may be rebuilt from their stable branches when missing.

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

HOPI materializes managed integration and task worktrees with `core.autocrlf=false` and an empty
`core.hooksPath` for the checkout operation, regardless of the operator's global Git preference.
This does not change the user Repo configuration or checkout. It preserves committed blob line
endings in HOPI-owned roots and prevents user-checkout hooks from adding side effects or blocking a
Coordinator-owned source projection. Reviewed Repo preparation remains the explicit
`scripts/hopi/prepare` capability.

### Repo preparation

`scripts/hopi/prepare` is an optional reviewed Repo capability rather than Project membership,
adapter routing, or lifecycle state. When present, it is foreground, non-interactive, idempotent,
prepares only its own checkout, and may populate ignored dependencies and caches without modifying
tracked or non-ignored source.

Every Engineering Run receives a runtime-only `HOPI_REPOS_FILE` containing a self-consistent
`candidate` projection of all Project task roots, plus the Home-owned persistent `HOPI_CACHE_DIR`.
The projection head for each Repo is the commit checked out at the supplied path; it is never copied
from an older release while the path names a newer candidate. Generator and Reviewer use the
accepted Work, design, source, and actual candidate delta to decide which Repo setup and
verification commands are material.

When the primary Repo exposes `scripts/hopi/prepare`, Coordinator runs it once against that candidate
projection and records the result as Run context before the responsibility starts. Preparation
failure remains an environment fact available to the responsibility; it is not a hidden Work gate
and does not prevent the responsibility from using the supplied environment. HOPI does not require
no-op adapters in unrelated Repos. A missing entrypoint is simply an environment fact; an Agent may
create one when the accepted outcome actually needs that durable capability.

A task worktree is a disposable source projection. Reviewer clean materialization and later recovery
may replace it completely, including ignored and uncommitted runtime data. `HOPI_CACHE_DIR` is the
existing shared persistence boundary for reusable or long-running runtime data across Assistant,
Generator, Reviewer, retries, and worktree replacement. This distinction is an execution fact, not a
new artifact class or workflow state; accepted deliverables still enter source or Evidence through
the existing publication boundaries.

Project Preview is a Project runtime capability governed exclusively by
`mvp_project_runtime.md`. This execution design deliberately does not duplicate its adapter,
surface, input, lifecycle, completion-evidence, or failure-routing contract.

If setup or verification is wrong, the relevant Agent-run checks and Reviewer expose the defect
against the accepted Work rather than a universal Coordinator preflight. Process launch, provider
quota, interruption, and malformed Run
protocol failures are operational Run failures: they remain in Attempt diagnostics, publish no
responsibility Evidence, and do not mutate Work.

An observed operational failure remains an Attempt fact. Reconciler reconstructs from its settled
Work hash whether unchanged authority should remain paused after restart; it creates no Attention,
retry threshold, backoff policy, counter, or Work field. Wake routes the fact and Assistant decides whether
another invocation is useful.

Planner reads every linked Repo's current managed source and existing Repo-local `AGENTS.md`, while
the primary root `AGENTS.md` remains the single automatically bootstrapped Project entrypoint. It
maintains `.hopi/docs/repos.md` as natural-language topology, responsibility, command, and shared
contract context when missing or materially stale. A valid project-context update is durable Planner
output even when the same pass publishes targeted Attention, and is committed atomically with that
Attention so the next pass sees the learned environment. Engineering responsibilities receive the
roots listed by their owning Work. Planner and Reviewer processes start from their Run directory and
see those roots read-only; Generator alone receives write access to its assigned task worktrees.
Managed integration roots are never Agent-writable. Reviewer checks and Generator checkpointing cover
every assigned root as one logical result.

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
Project validation, diagnostics, and Assistant supervision own repair or escalation. Data-rescue
patches and Git crash mechanics are implementation details, not workflow stages.

Safe deterministic repair is attempted at the failing boundary before the failure settles. The
settled Attempt and Project event wake the Assistant, which may inspect, repair, continue, communicate,
or preserve unfinished responsibility as Project Attention. Coordinator does not synthesize
Attention or choose a recovery path.

Project Attention is the Assistant's todo, not Project eligibility or a scheduling predicate.
Creating, updating, or resolving it does not admit, stop, or continue Work. The exact execution fact
continues to own readiness: for example, a checkpoint failure leaves the Work stopped by
`failed_attempt` until an explicit queued continuation or material Work change. A separately invalid Project
runtime may still fail closed at its deterministic boundary, but its repair and validation are
independent from Attention lifecycle.

Likewise, a responsibility process that never returns a valid result is not evidence that the Work
failed. Nonzero transport exit, provider quota, interrupted process, invalid result protocol, and a
Reviewer write violation finish the diagnostic Attempt as operationally unapplied while leaving the
canonical Work unchanged. Only an explicit valid responsibility result may publish Evidence and
consume semantic recovery.

Concurrency rules:

- Planner, Generator, and Reviewer each use their own code-owned global capacity across all
  Projects and Goals in the Coordinator Home
- each dispatch admission carries the complete three-responsibility capacity mask captured by
  Coordinator; Project reconciliation has no permissive default for a missing mask
- queued and running Attempts are both projected with their stable Run identity and lifecycle
  timestamps; a queued Attempt reports `capacity` only when the corresponding global pass capacity
  is observably full
- one writing pass at a time per task worktree
- read-only work may run in parallel
- independent writers require separate Work and worktrees
- independent same-Goal Generator Runs may execute in parallel within Generator capacity; Coordinator
  admits one Work per Goal in a tick, then immediately reconciles again to fill remaining capacity
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
interrupt. Resume creates a new Attempt but reuses each unfinished Work responsibility's matching
session; Pause never turns hidden process memory into canonical state.

Assistant never edits source or canonical files directly. Its local MCP server is an adapter over
existing controllers and the global publisher. Reply prose, tool-result summaries, and raw vendor
events are never parsed for control state. When one accepted Input already defines one cohesive,
independently verifiable delivery within the current Goal contract, Assistant may publish exactly
one new Engineering Work through that adapter. The Work may depend on existing Engineering Work
and span several linked Repos. Planner still owns delivery decomposition, material Goal revisions,
durable design decisions, existing-Work rewrites, and every multi-Work publication.

The runtime receives the active server's exact Assistant-tool URL and a topology-change callback at
construction; it never guesses a localhost port or silently leaves Coordinator on an old Project map.

The direct-Work tool has a singular schema and records immutable `assistantDispatch` provenance.
One Inbox Input has one such allowance across the Home; a matching repeat returns the existing Work,
while a different or second direct admission fails before publication. Goal-scoped speaking barriers
keep Generator admission behind the final Assistant reply. Direct Work follows the ordinary
Generator, Reviewer, and C1 workflow and does not change final Planner assessment.

A Work run requested by the speaking Assistant is therefore only admitted after that turn settles.
The returned scheduled reservation and the resulting queued Work are the durable handoff facts
visible inside the same turn; an active Run cannot appear until the speaking barrier is released.

The MCP tool descriptions and JSON schemas injected into the Assistant turn are the only authority
for tool arguments. Assistant calls those tools directly and never searches Project files,
`.hopi/runtime`, transcripts, or HOPI source to guess a schema. It reads an exact canonical or
diagnostic path returned by `hopi_read_state` only when that file's body is actually needed; broad
runtime search is neither discovery nor evidence. Resolved Evidence artifacts distinguish an
internal `inspectionPath` from the browser-facing `operatorUrl`; only the latter belongs in an
operator reply.

An Inbox turn is eligible when it is pending and not already active in the one speaking queue.
Public user turns have priority over internal wake turns; each source class runs in receipt order.
Project Attention does not block unrelated conversation or direct answers. Vendor-local transient
retry belongs to the configured invocation; Coordinator does not repeat that invocation. A missing,
invalid, or context-exhausted cached conversation is rebuilt once from bounded durable conversation
history. Provider allocation, transport, and application failures do not masquerade as session
invalidity.

An internal state turn supplies current environment facts and exact Attention references to the
same Project Assistant. The Assistant owns the semantic judgment and may reply, use tools, present
Attention to the operator, or conclude no domain change is needed. Coordinator validates only actual
tool effects and durable turn settlement; it does not require a prescribed successor state.

Messages remain writable while passes run. A material instruction ensures Planning Work, advances
that Work and the Goal to the new `contractRevision`, and leaves existing nonterminal Engineering
Work on the revision that authorized it. Once the Goal revision is durable, Coordinator interrupts
the Goal's admitted Runs. The ordinary revision readiness predicate then keeps old routes
ineligible until Planner retains them at the current revision or cancels them. The immutable-context
publication guard remains the correctness boundary if a result races that interrupt. Before
completing an interrupted Generator Attempt, Coordinator makes one safe task-branch checkpoint of
partial source; it publishes no Evidence and advances no Work.

### State read and Wake

The bounded HOPI state read is a current-state index, not a dump of the durable archive. It returns
Projects, Goals, scoped design, every Engineering Work, nonterminal Planning Work, open Attention,
the latest finished Planning outcome per Goal, derived Kanban facts, and an explicit list of active
Runs. Historical Planning, resolved Attention, and Evidence bodies remain canonical documents but
are not inlined by default. Home, Project, and Goal scope filter the same compact projection while
retaining the identities, readiness, latest outcomes, open Attention, active Runs, and canonical
paths needed to choose an exact record. A narrower scope does not implicitly expand Goal bodies or
runtime history. Goal-scoped `includeEvidence` additionally expands bounded Evidence bodies and
artifacts only when the answer requires the deliverable itself. This is one state model without
pagination, a query DSL, or scope-dependent detail rules.

The speaking Assistant receives that same compact index for the current conversation scope. Field
bounding removes archive bodies while retaining every current Goal and Work; the prompt never slices
serialized JSON by character position. Consequently a later-sorted failed Work cannot disappear
from a Project event, the embedded JSON remains valid, and every omitted body remains reachable
through the retained canonical path.

For each Work visible in an exact Goal read, the state read returns a small runtime diagnostic descriptor: current
projection, active responsibility when present, latest Attempt summary, last event time, stale
observation, stable worktree path, and paths to `attempt.json`, `events.jsonl`, `transcript.log`,
`context.md`, `prompt.md`, and `result.json` when those files exist. It does not inline transcripts or
treat path existence as canonical truth. This gives the Assistant a direct route from a blocked card
to the full local diagnostic record without creating a second log database.

For the speaking thread only, the state result ends with the current durable Inbox event as an
attention anchor. The kernel does not classify that prose or compare it with an expected action;
repeating the event after the larger snapshot simply prevents an older turn from becoming the most
recent apparent instruction. The Wake read path has no such operator anchor.

Coordinator derives one stable semantic digest from control-relevant state. A changed digest records
one pending Wake after the current snapshot is published, but does not alone enqueue an internal turn.
The digest includes Goal
lifecycle/revision/completion, Work stage/attempt/dependency/timing facts, Attention changes, runtime
Attempt terminal/interrupted facts, project availability, and C1 integration. It excludes raw event
growth. A running Attempt whose last activity exceeds the code-owned stale threshold contributes a
time-derived digest change so a silent hang is still assessed. The MVP threshold is ten minutes:
long enough for one high-reasoning edit or build without producing a false Wake, while still
surfacing a genuinely silent responsibility without waiting for an operator report.

Wake starts immediately for an Assistant-owned Attention, unavailable Project, or stale running
Attempt. All other changed snapshots wait for an idle reconciliation tick that both begins and ends
with no active responsibility Run. An old scan that overlaps a Run completion is therefore not a
settled boundary; the next tick must reconcile the newly published result first. This is one progress
predicate rather than a stage allowlist: if HOPI can still take a known automatic step, the model does
not inspect that intermediate state. A deferred digest is not marked assessed, so the same snapshot
may be assessed later if automatic progress reaches a settled boundary without another canonical
change.

Wake runs outside the global publication mutex and responsibility capacities. There is at most one
active Wake publication per Home; later changes coalesce to the latest eligible digest. The first startup
snapshot establishes a baseline instead of producing a notification storm unless it already contains
an immediate signal; an Assistant-owned Attention, unavailable Project, or stale running Attempt must
survive process restart and is assessed without waiting for a later digest. Wake projects only
the code-derived trigger and a compact semantic delta. It does not receive a second full current-state
projection or public conversation history: both duplicate facts owned by canonical state or the
speaking thread. Work deltas contain control fields and one bounded latest-Run outcome, never archive
paths, full Evidence lists, or unrelated Goal state. The resulting Assistant turn may call scoped
`hopi_read_state` and follow an exact diagnostic path after identifying a concrete candidate.

Wake is a deterministic state observer, not a second model. When a scope becomes eligible it
publishes one internal Inbox event in that same Assistant conversation. The event carries the current
scope digest and the exact open, Assistant-owned Attention references that have no already-durable
successor or future revisit. A scheduled revisit carries its exact Attention reference. The speaking
thread receives the current state separately. Immediately before model execution HOPI compares the
event's observed scope digest with that current state; a mismatch settles the obsolete internal turn
silently without invoking the model. A matching turn owns every judgment and optional operator
notification. Wake reports `started` only after its runtime record and Inbox handoff are durable;
publication failure remains a Coordinator failure and retries through the ordinary wake edge.

The state event describes consequences rather than prescribing an action. Coordinator does not
parse prose, infer intent, or select among Attention and Work capabilities.

One pending wake turn suppresses another wake for the same assessed state. Later state changes
coalesce into the next digest. A failed turn remains pending and retries with bounded backoff; restart
loses only the delay. Public user speech is selected before pending internal turns but does not
interrupt one already running or any independent responsibility Run.

## Reconciler and Scheduling

Before Reconciler starts, Coordinator fully validates the Assistant home and every linked project.
It validates each Repo binding's Project-qualified release ref, stable managed integration worktree,
and Project package. Missing or inconsistent managed projection truth creates workspace Project
Attention. Selected checkout state is outside reconciliation and remains untouched.
Invalid Assistant-home truth still fails closed to supervisor intervention.
Reconciliation, dispatch, integration, and Preview never race this startup scan or proceed from
missing original intent.

Each cycle:

1. validates the code-owned workflow and canonical packages
2. marks stale runtime Attempts interrupted and clears leases without reattaching children; later
   Attempts may resume their Work responsibility sessions
3. advances the oldest eligible Assistant conversation turn
4. ensures final Planning assessment when no nonterminal Work remains
5. evaluates `ready(work)` and dispatches responsibility passes within capacity
6. after Reviewer success, performs deterministic integration while Work remains at `review`
7. publishes validated outcomes and wakes dependents after upstream `done`
8. evaluates completion
9. observes the latest semantic digest and starts or coalesces a non-blocking Wake

`ready(work)` is one conjunction:

- Goal lifecycle is `active`
- Work kind and stage match one workflow rule
- Work `contractRevision` is current
- every `dependsOn` Work is `done`
- `notBefore` is null or elapsed
- no active Run already owns it and pass/worktree capacity is available

The UI may show every failed predicate, but readiness is not another state machine.
API JSON and in-memory query caches are runtime inputs, not TypeScript-guaranteed values. Each UI
surface validates the small structural contract it renders before using it. An incomplete projection
is shown as a retryable read error and is never normalized into empty Work or Attention facts.

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
Attempt records preserve reviewed repair history. C1 only distinguishes failure before and
inconsistency after its durable ref. Neither adds another Goal or Work lifecycle state.

### Notification

Open targeted Attention remains an Agent-facing record until the Project Assistant presents exact
canonical references in a public turn. That handled turn then projects as **Needs you** while any
referenced Attention remains open. Its default wording and optional choices come from the current
Attention documents; their full bodies remain Agent detail. This adds no ownership field to
Attention and does not change Work readiness. Goal completion appears from the Goal transition and
final Planning Evidence as a deterministic **Completed** conversation update. Its visible body is
the exact final Planner summary; the kernel does not extract sections or rewrite it. Useful
deliverable links stay ordinary Markdown links throughout Evidence, Feed, and rendering; completion
has no parallel structured link field. The Evidence remains
the canonical technical record; completion is its human-facing projection, not another notification
document or required Assistant phrase.

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
handled public internal-system replies. It scans those Inbox events, uses the canonical Home/event
identity as its idempotency key, and records `webhookDeliveredAt` after acknowledgement. Persistent
transport failure retries with bounded in-memory backoff. It never scans or delivers raw Attention
and cannot create recursive Attention about delivery.

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

The final Planning Evidence is the completion record. Its result summary is operator-facing because
the same text is projected as the deterministic `Completed` summary; diagnostic proof remains in the
Evidence, artifacts, and Attempt history. Completion creates no Attention, approval field, dedicated
role, or second lifecycle gate. Wake observes the ordinary Goal transition and its final
Planning Evidence. Reopen increments revision when required and creates Planning Work; historical
Evidence remains immutable.

Manual completion confirmation is not required.

## Preview Capability (P2)

See `mvp_project_runtime.md`. It is the sole source of truth for this capability.
