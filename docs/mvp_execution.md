# HOPI MVP Execution

Status: forward execution authority
Last updated: 2026-07-16

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
qualified `producerRun`, and a valid `completionAttentionId` exactly while Goal lifecycle is `done`.
A Goal has at most one open targetless Attention not yet referenced by its Goal.
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

If the guard fails, the result cannot advance state. Source and Evidence are preserved when
useful. Stale contract output goes through Planning; terminal output remains Evidence only.
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
2. Each mutating HOPI tool names and validates its own target. In that project it uses
   operation-specific single-gate publications for the blocking guard and requested effects, then
   publishes Goal Input for source `(homeId, eventId)` as the durable effect receipt. Goal-local
   Attention resolution is one more publication after Input. Goal creation establishes the Goal
   and initial Planning guard before its Input receipt.
3. After all optional tool calls and the final Assistant reply, publish the Assistant-home reply and
   disposition and mark the turn handled.

Known product controls use the same sequence without a model call. Coordinator temporarily excludes
their newly admitted pending receipt from speaking dispatch until the request publishes its handled
acknowledgement. The exclusion is process-local and covers the whole receive/effect/acknowledge
sequence; it adds no canonical status. A failure or process replacement releases the exclusion, so
the still-pending receipt follows the ordinary Assistant recovery path instead of being lost.

The tool target owns destination choice for that call; the qualified Goal Input path and digest are
the project-effects receipt. One turn may create receipts in multiple Goals. Goal-local Attention
resolution may follow as the final unblocking gate. None of these is a generic operation receipt or
cross-root transaction entity.

After a process crash, a pending turn resumes in the configured Assistant conversation. A tool whose Goal Input is
missing rereads current canonical state and safely completes or reports the interrupted effect; a
matching Input proves that Goal already accepted the source instruction. Domain IDs, lifecycle
guards, expected content hashes, and existing Planning Work make repeats idempotent. A vanished
target, conflicting Goal identity, digest mismatch, or missing original turn creates targeted
Attention rather than a guessed repair. An unavailable unrelated project does not affect the other
tool calls in the turn.

Project-target Attention is created in one Assistant-home publication when the project root is
invalid, unwritable, or a Coordinator integrity failure leaves no safe Goal-local writer. It has no
second project phase and claims no Work recovery update.

An answer to event-target Workspace Attention is handled as its own ordinary conversation turn.
Assistant uses the HOPI Attention/control tool when the answer resolves the condition. Clearing that
guard makes the original pending turn eligible again with the answer visible in durable conversation
history; no answer parser or hidden continuation object is required.

Project-target Workspace Attention cannot be closed by a model assertion. Explicit repair such as
Repo rebind first validates the Repo, release ref, managed root, and Project identity, then resolves
the Assistant-home Attention. A crash between those roots leaves the project conservatively blocked;
repeating the same repair is idempotent.

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

retry:
  maxAttempts: 3
  exhausted: create_attention

concurrency:
  planner: 1
  generator: 3
  reviewer: 1
```

The profile supports only exact kind-stage matching, one responsibility pass per dispatch rule,
explicit success/reject transitions, one Assistant-managed Attention handoff, one retry limit, and per-pass
concurrency. Reviewer `success -> done` is publishable only after the built-in deterministic
integration postcondition succeeds; integration behavior is Coordinator code, not profile syntax.
The profile has no hooks, expression language, inheritance, project variables, arbitrary actions,
or workflow editor.

### Project coding defaults

The fixed profile decides which responsibility runs; Project coding defaults decide only which
configured agent transport and model execute that responsibility. A `projects.yml` link may contain
`codingDefaults`. When absent, the Project inherits Assistant-home adapter defaults.

Resolution for Planner, Generator, and Reviewer is:

1. an explicit Home role configuration retains authority for its transport and explicit fields
2. the owning Project override supplies defaults, including missing Codex model or reasoning fields
   when the explicit role uses compatible Codex defaults
3. otherwise Assistant-home `defaults` apply

The workspace Assistant and disposable Reflection use the same explicit Home `assistant`
configuration. It may select Codex, Claude, or OpenCode; when absent, it inherits compatible Home
defaults. Its resumable session belongs to Home rather than any Project. Saving Assistant settings
affects the next speaking or Reflection invocation and invalidates an incompatible vendor session.
Saving Project settings affects only responsibility Runs dispatched afterward; an already-started
Run keeps its resolved immutable command. Neither setting changes the workflow profile, capacities,
retry policy, Work stage, or Goal revision.

Pass result values are:

- `success`: no operator intervention remains; apply the profile transition after validation and
  any built-in postcondition
- `reject`: Reviewer returns engineering Work to `generate` with findings
- `attention`: keep the current stage and publish one internal Assistant-management request without
  consuming an attempt
- `fail`: keep stage and apply bounded recovery

`blocked` is not a Work field. Open targeted Attention is the one derived readiness blocker.
Ordinary failures retry according to recovery facts and budget; design ambiguity, missing
information, or external authority returns `attention`. Coordinator
validates the staged Attention document rather than parsing pass prose for control. Process
interruption, invalid output, and invalid pass-result combinations normalize to `fail`.

Semantic invalidation is expected concurrency control, not pass failure or Project failure. A stale
guard detected before a gate, during publication, or immediately before C1 produces the same
`stale` application: preserve any complete Run Evidence as unconsumed provenance, do not advance
Work, and let current canonical state determine the next reconciliation. It never creates Project
Attention merely because Goal lifecycle, revision, Work ownership, dependency truth, or another
guard changed while the Run was active.

When a durable mutation changes the immutable authority staged for a live Run, Coordinator interrupts
that exact Run as soon as the mutation commits. This avoids knowingly spending tokens on obsolete
work; the content-hash stale guard remains the correctness boundary for races, crashes, and mutations
from paths that cannot signal the live process. Authority changes do not interrupt unrelated Runs.

A pass that needs Assistant management returns `attention` with one staged targeted Attention.
Coordinator publishes Evidence plus Attention, does not publish a Work gate or increment attempts,
and starts a fresh Run only after speaking Assistant resolves the request. Speaking may answer from
current authority, update design, request Planning, or ask the operator. Responsibilities never
handoff directly to one another.

The Run contract renders the exact owning Work target
`project:<projectId>/goal:<goalId>/work:<workId>` in the targeted Attention frontmatter for every
responsibility, including Planner. The responsibility chooses whether Attention is needed, its
stable local ID, and its Markdown request; it does not infer target syntax from document paths or
historical examples. Coordinator rejects any other target before publication and reports the exact
expected value. Planner completion remains the separate `target: null` form.

A targeted Attention proposal is valid only with `result: attention`. `success`, `reject`, or `fail`
combined with targeted Attention is an invalid pass result and normalizes to ordinary `fail` without
publishing the proposed Attention. A responsibility must not classify its own sandbox restrictions,
Git metadata access, unavailable local port, or missing optional tool as operator authority. It
records those facts in the result and raw transcript; bounded recovery and Background Reflection
decide whether repair or eventual user escalation is useful.

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
root: applicable `AGENTS.md`, Goal contract, design, owning Work, referenced Evidence, and relevant
project documents. Goal-local image assets explicitly cited by the owning Work are staged with that
bundle and supplied through the transport's image-input mechanism. This bundle, not the task
branch's possibly older copy of `.hopi`, is authority
for the Run. The task worktree supplies isolated source and tools. Coordinator rejects the result
if the canonical snapshot is stale at publication time. Snapshot identity covers both the selected
file set and each file's content: a newly added selected Input or design document is a semantic
change, not an invisible file outside a hash list. Engineering context does not copy unselected
Inputs, other Work history, or unrelated Evidence merely because they share the Goal directory;
Planner owns interpretation of that broader history.

Planner requires the same integration-target snapshot because it defines new ordering and scope.
Engineering results instead guard Goal, design, owning Work, permanent dependencies, relevant
Attention, and other selected authority. An unrelated C1 may advance `hopi/release` while Generator
or Reviewer runs without making that semantic context stale; task isolation and deterministic C1
rebuild or conflict handling own the later source reconciliation.

A newly published Planning Work also does not retroactively stale an already-running Engineering
pass. It is an admission guard: the Planner Run waits for same-Goal Engineering Runs that were
already admitted to drain, then runs before any new Engineering pass. If Planning changes Goal
design, the owning Work, dependencies, Attention, or another selected authority file before an
Engineering result publishes, the precise content guards still reject that result. The mere
existence of the queued Planning Work is not a semantic change.

RoleRunner normalizes Codex, Claude, OpenCode, or process output into one runtime event shape.
Coordinator appends those events to the owning Run directory and exposes them through the selected
Work's Attempt history. The UI polls only while the modal is open, follows the live tail by default,
and lets the operator inspect older Attempts. Before normalization, RoleRunner also appends every raw
stdout/stderr line to the Run's `transcript.log`; normalized summaries may be bounded for display but
the diagnostic source is not discarded. These streams are diagnostics: a transcript never advances
Work and cannot replace Evidence or a canonical gate.

Goal reference images are passed only through a transport with an explicit image-input contract.
If a selected responsibility transport cannot accept them, RoleRunner fails visibly before the
model call instead of silently dropping accepted multimodal input. Speaking Assistant and
Reflection use the same Home-configured adapter, while only the speaking session is resumable.
HOPI never infers cross-vendor resume from a synthetic session ID.

Attempt presentation preserves any explicit recorded result, application, and summary, including a
stale reason. Canonical Evidence may fill fields missing from a legacy or interrupted presentation,
but Evidence consumption must not overwrite the recorded Attempt application; provenance and Run
diagnostics answer different questions.

Generator and Reviewer may start short-lived local services when implementation or material
verification requires them. Their workspace-write Codex transport includes network execution so
loopback services and dependency-backed checks work in either Engineering responsibility; Planner
does not receive that capability. These processes are Run-scoped diagnostics, not Project Preview
and not canonical state. RoleRunner owns the child process group and terminates surviving descendants
when the Run completes, fails, is interrupted, or the Coordinator stops. Each Run also receives one
disposable writable scratch root; temporary files and tool caches are redirected there so runtime
verification does not depend on writable global temp or user-home directories and does not expand
the task worktree's source surface.

### Planner

Every responsibility Run receives one disposable Run prompt in this order: current assignment,
current canonical facts and source paths, role boundary, success or stop conditions, and writable
paths/result contract. A generic prompt that merely points at an unranked manifest is not the MVP
model. The immutable authority snapshot remains separate on disk for exact reads.

Planner reads the Goal contract, current design, current Planning Work, Engineering Work, Inputs
accepted by that Planning Work, latest relevant Evidence, project docs, preferences, and open
Attention. The whole Goal package remains the semantic freshness guard, but historical Planning,
resolved Attention, unrelated Inputs, and superseded Evidence are not staged merely because they
exist. Guard coverage and model context are deliberately separate concerns.

The staged authority is a compact responsibility view, not a claim that omitted canonical history
does not exist. In particular, an older `evidenceRefs` entry whose Evidence document is not staged is
not dangling and Planner never repairs it. Terminal Engineering Work is immutable and remains absent
from the sparse proposal even when Planner uses its latest Evidence for completion assessment.

Each accepted Goal instruction is published atomically with its Input and the Planning Work that owns
it. The Planning Work body contains an `Accepted Inputs` section with canonical Input paths. Reusing
an existing nonterminal Planning Work appends the new path instead of creating a second planning
surface. Updating that Work invalidates any already-running Planner snapshot, so the fresh Run sees
the exact instruction without searching Input history.

If Assistant adopted reference images with that instruction, the same publication installs the
Goal-local immutable assets and records their exact paths and purposes in both
`design/references.md` and the owning Planning Work. Planner therefore sees the images before it can
run; adoption cannot race Planning dispatch.

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
authority; it does not ask merely to satisfy a fixed interview ritual.

Independently testable code is not automatically independent Work. Planner keeps a prerequisite and
its only consumer together when they share the same primary source surface and the prerequisite has
no separately useful operator outcome. A helper-only extraction that exists solely to enable one
panel rewrite therefore receives one Generator, Reviewer, and C1 cycle rather than a ceremonial
dependency edge. Planner splits Work only for real ordering, isolation, or independently valuable
delivery.

The Work `repos` list is the complete source workspace for that responsibility: include every Repo
the Generator or Reviewer must inspect, execute, or modify to prove the Work. HOPI does not add a
second read-only Repo scope. A Repo that is only exercised may produce no source delta; checkpointing
and C1 already treat its unchanged task branch as a no-op. Omitting a required runtime dependency is
therefore an invalid Work contract, not a reason for an agent to search neighboring runtime folders.

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
fields.

The accepted `goal.md` is immutable input to Planner. Planner records clarified implementation
decisions in `design/**` and Work acceptance criteria, never edits the Goal contract, and always
uses exactly its current `contractRevision`. Only an operator instruction accepted through an
Assistant HOPI tool may propose a Goal contract change and its revision guard.

Planner never creates or rewrites Planning Work. Success means the entire semantic proposal was
published before Coordinator changes the owning Planning Work to `done`. A clarification question
uses the ordinary Attention-producing path, targets the owning Planning Work, leaves it at `plan`,
and consumes no failed attempt.

Planner proposes only `design/**`, Engineering Work, targeted or completion Attention, project
repository context, and a missing root `AGENTS.md`. It never creates or rewrites Planning Work or
`evidence/**`, and never appends `evidenceRefs`. Every responsibility writes only its Run-local
`result.json`; Coordinator alone derives immutable Evidence from that result, preserves the current
Planning Work, appends the Evidence reference, and publishes the owning gate. Evidence from an
earlier failed Planner Run is retry input, not a template for new Planner output.

Planner reads existing documents only from the immutable authority root and copies into the sparse
proposal only a document it intends to replace. It does not mirror unchanged Goal-package files;
their absence means unchanged, never deleted.

Both writable outputs have explicit empty-file semantics. `proposal/` starts with no descendant
files, so a responsibility creates every proposed path and its parents rather than trying to update
an authority file in place. Run-local `result.json` starts as a zero-byte missing-result marker and
must be replaced wholesale with the one required JSON object; the example in the prompt is not
prewritten content. Leaving it empty remains a visible failed Run rather than a fabricated default.
New Attention proposals use the fixed parseable `createdAt` placeholder from the Run contract;
Coordinator replaces it with publication time.

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
the next responsibility Run owns a fresh result. Planner may preserve Engineering Work or reset it
to `generate` only when the accepted plan materially changes.

Planner owns requirement and design clarification after Assistant requests Planning. Assistant
does not ask a second set of delivery questions for an already-accepted Goal instruction.

Planner also owns final Goal assessment. When no nonterminal Engineering Work remains, it either
plans additional Work, requests required authority, or proposes the targetless completion Attention
described under [Goal Completion](#goal-completion). This reuses the same Planner responsibility and
adds no completion role or pass.

Planner may return `success`, `attention`, or `fail`. Success means its complete sparse proposal and
Run result are ready for Coordinator validation. Attention means one exact Assistant-management
request is staged. Fail means the Run could not produce a valid proposal without such a request. A
successful proposal either leaves nonterminal Engineering Work to execute or leaves one open
targetless completion Attention; this prevents an empty final assessment from repeatedly recreating
Planning without replacing Agent judgment with a completion heuristic.

### Generator

Generator edits only the stable task worktree. Its current assignment inlines the owning Work
objective and acceptance criteria, plus the latest referenced Evidence as the reason for a retry when
present. It reads the Work contract, design, current target state, and findings from the staged
canonical context bundle; changes source and normal project docs; runs focused checks; and produces
Evidence. It returns `success`, `attention`, or `fail`: attention means Assistant management is
required, while fail means this Run did not complete valid implementation proof.

When the Work body explicitly cites a Goal image asset, Generator receives both its staged local
path and the actual image input. It must apply the documented purpose rather than infer that every
visual detail is a requirement.

Generator may inspect Git status and diff but never writes the Git index, creates commits, changes
branches, merges, rebases, or resets. Coordinator snapshots safe task-worktree changes after the Run;
an inability to run `git add` inside the model sandbox is therefore expected and is never a blocker.

A responsibility Run resolves ordinary project paths only from the Repo IDs and roots in its
`HOPI_REPOS_FILE`, and reads integration truth only through the immutable context bundle. It never
searches sibling, historical, or other Work runtime directories for missing source. If a Repo needed
to implement or prove the contract is absent from the manifest, Generator returns `attention` instead
of guessing a path. Independent reads and checks should be batched where practical; repeated
discovery and progress narration are not evidence. The Run does not receive the Preview-adapter
`HOPI_PROJECT_ROOT` variable: exporting the managed integration root there could make a task script
bypass its stable worktree. Project Preview alone owns that variable.

### Reviewer

Reviewer independently checks acceptance criteria, diff, tests, and material runtime behavior.
It normally reads without editing source. Implementation rejection records findings and returns
the same Work to `generate`; invalid design returns `attention` for Assistant management. Reviewer success keeps the durable
stage at `review` while Coordinator immediately attempts deterministic integration under the same
Work lease.

Before Reviewer starts, Coordinator rematerializes any dirty HOPI-managed task checkout from its
stable task-branch checkpoint. "Clean" means `git status` is empty at the exact task HEAD; the Work's
committed delta from `hopi/release` remains present. This makes review proof describe exactly the
candidate C1 can integrate. The task checkout is disposable and the delivery checkout is untouched. A Reviewer
that writes source produces an invalid Run: Coordinator discards that Run's checkout delta and
retries Reviewer without returning Work to Generator or consuming a business recovery attempt.

Reviewer receives the same Work-selected image references as Generator, allowing visual criteria to
be checked against the original reference rather than a prose-only summary.

Reviewer attributes only the stable task branch's cumulative delta to the owning Work. Its diff base
is `git merge-base refs/heads/hopi/release HEAD`, not the current release tip: independent integrations may
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

Reviewer decides the proof plan before installing optional tools. It reuses the Project's documented
entrypoint and existing test/browser stack, does not install competing harnesses after decisive proof
already exists, and does not rerun an unchanged passing check. Helper-only changes normally stop at
focused tests; an operator-reported visual or interaction path receives one direct runtime exercise.

Reviewer may return `success`, `reject`, `attention`, or `fail`: reject identifies an implementation
defect against accepted criteria, attention identifies an invalid design or missing authority, and fail means
the Run could not produce a valid review. Every role's result may list Run-local logs, screenshots, or
other proof paths in `artifacts`; omit artifacts when no preserved file adds evidence.

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

The target is the HOPI-owned `hopi/release` branch, and C1's tree snapshots the complete validated
managed integration root plus the accepted task changes. No delivery checkout, delivery branch,
index, or uncommitted file participates in C1 construction or managed materialization.

The guarded ref move to C1 is the one irreversible integration boundary and is independent of
`publish(bundle)`; success is reported only after Git confirms ref durability. A conflict, failed
check, or ref-update error verified to have left the old target may record Evidence and increment
`attempts`; rebuilding on a clean target advance does not. If an uncertain update leaves the ref at C1, source
is treated as integrated and the project blocks rather than publishing Work failure or retrying.
After the boundary, source is never integrated again, rolled back, or counted as Work recovery. Any
ref, commit, Work, Evidence, managed-worktree, or delivery inconsistency creates workspace project
Attention and keeps the project out of scheduling. Coordinator never repairs individual paths or
resets the managed root. It may only fast-forward the recorded clean delivery branch after verifying
Repo identity, current branch, ancestry, and exact result. Since ordinary
canonical publications may be newer than the last Git checkpoint, ownership alone does not make
the managed root disposable. There is no metadata follow-up commit, integration-pending state, or
merge stage. Mechanical guarantees belong to the publish ADR.

Within one managed worktree, Coordinator runs index-inspecting Git commands sequentially: commands
such as `write-tree` and `status` may both refresh and lock the same index. This is part of the one
C1 critical section, not a new resource lock, retry state, or reduction in parallel model Runs.

## Worktrees and Parallelism

Each linked Repo has a stable managed integration worktree materializing its `hopi/release`. The
primary Git root remains the base for canonical `.hopi` publication; Project `AGENTS.md`, entrypoint
scripts, and Preview resolve beneath its portable `projectPath`. Integration and task roots live
under `<repo-parent>/.hopi-worktrees/<repo-name>/`, distinct from the selected checkout.

An engineering Work deterministically maps to one stable task branch and worktree in each Repo named
by its `repos` field. Retries reuse those branches. Task worktrees live at
`.hopi-worktrees/<repo-name>/work/<goalId>/<workId>` beside their Repo and start from its current
`hopi/release`. A responsibility receives one logical
workspace containing all named roots; no Repo subtask or extra responsibility is created. Checkout
directories are disposable and may be rebuilt from their stable branches after migration.

HOPI materializes managed integration and task worktrees with `core.autocrlf=false` for the checkout
operation, regardless of the operator's global Git preference. This does not change the user Repo
configuration or checkout. It preserves committed blob line endings in HOPI-owned roots so an
executable script that passed review cannot become `bash\r` merely because a later Work gets a fresh
checkout.

### Project preparation

Primary `scripts/hopi/prepare` is the Project's one reviewed, executable preparation contract. It is a fixed
convention rather than Project configuration or lifecycle state. The script is foreground,
non-interactive, idempotent, and returns zero only when the current checkout can build, test, and run.
It may populate ignored dependencies and caches but must not modify tracked or non-ignored Project
files. Coordinator invokes it with the primary root as cwd and a runtime-only `HOPI_REPOS_FILE`
mapping stable Repo IDs to the exact task or integration roots that will be consumed before every
Generator, Reviewer, and Preview start. Repeated invocation, rather than a HOPI-maintained lockfile
fingerprint, is the freshness check. When the manifest is present, the script resolves linked Repos
from it and never scans HOPI runtime siblings or earlier Work directories. It may call Repo-native
setup commands through that manifest; HOPI does not add per-Repo preparation configuration.

A missing script is allowed only for bootstrap. Planner records its creation in the first real
Engineering Work that needs an executable environment; it does not create a separate Init Work.
That first Generator starts from the ordinary task checkout, inspects `AGENTS.md` and native manifests,
creates and runs the script, and completes the owning product change. If several Works genuinely need
the bootstrap result, existing `dependsOn` orders them. Planner never writes the executable directly:
it judges adequacy and Work scope, while Generator changes it and Reviewer validates it.

Preparation is best-effort before Generator so a missing or broken script cannot prevent the role
that can repair it. Its path and captured failure log are added to that Run's assignment. Preparation
is strict before Reviewer: missing, non-executable, failing, or source-mutating preparation skips the
model call and returns the same Work to Generator with the exact log. Preview runs the same preparation
contract before primary `scripts/hopi/preview`, leaving Preview responsible only for service startup and its
ready URL. The fixed responsibility prompt exposes the adapter's exact ready signal,
`HOPI_PREVIEW_URL=<reachable-url>`, whenever an Engineering Work may create, repair, or review the
script; a merely human-readable bare URL is not enough for HOPI to leave `starting`. There is no
initialized flag, prepare revision, setup Action, or preparation Kanban state.

The public Project Preview API always starts the current managed integration release. It therefore
cannot prove a pre-C1 task candidate. Engineering Work contains only acceptance criteria that
Generator and Reviewer can prove by executing the candidate script directly with that Run's Repo
manifest. When accepted design explicitly requires public Preview proof, the final semantic Planner
uses the injected `HOPI_API_ORIGIN` after the relevant Engineering Work has integrated; it proposes
completion only after the public session reaches `running`, and otherwise plans the smallest repair.
Planner does not start Preview for Goals that do not require this proof. This reuses final Planning
instead of adding a post-C1 stage, candidate-Preview mode, or automatic Preview on every release.
The fixed API paths are `POST /api/projects/:projectId/preview/start`,
`GET /api/projects/:projectId/preview`, and `POST /api/projects/:projectId/preview/stop`; Planner
does not discover variants from Project source.

If a code change makes preparation obsolete, the candidate fails this existing pre-review check and
the same Work repairs it. If the script exits successfully but the environment is still wrong, normal
checks and Reviewer expose the defect. Process launch, provider quota, interruption, and malformed Run
protocol failures are operational Run failures: they remain in Attempt diagnostics, receive bounded
runtime backoff, publish no responsibility Evidence, and do not increment Work `attempts`.

Operational recovery survives restart without another counter or Work field. Reconciler derives the
current episode from consecutive finished Attempts whose application is `operational_failure`, after
the latest resolved Work-target Attention. Before the limit it retries with bounded in-memory
backoff. At the third consecutive failure it creates one ordinary Work-target Attention containing
the latest exact failure and asks Assistant to diagnose the next action. The Attention ID and body do
not encode a failure kind. Resolving that exact Attention starts a fresh operational episode and
ordinary readiness may dispatch again; generic retry never closes unrelated Attention.

Planner reads every linked Repo's current managed source and existing Repo-local `AGENTS.md`, while
the primary root `AGENTS.md` remains the single automatically bootstrapped Project entrypoint. It
maintains `.hopi/docs/repos.md` as natural-language topology, responsibility, command, and shared
contract context when missing or materially stale. Engineering responsibilities receive the roots
listed by their owning Work and may change any of them; Reviewer read-only checks and Generator
checkpointing cover every root as one logical result.

User-authored code enters `hopi/release` only through an explicit ordinary Assistant Input naming a
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

Likewise, a responsibility process that never returns a valid result is not evidence that the Work
failed. Nonzero transport exit, provider quota, interrupted process, invalid result protocol, and a
Reviewer write violation finish the diagnostic Attempt as operationally unapplied while leaving the
canonical Work unchanged. Only an explicit valid responsibility result may publish Evidence and
consume semantic recovery.

Concurrency rules:

- one writing pass at a time per task worktree
- read-only work may run in parallel
- independent writers require separate Work and worktrees
- Generator Runs may execute in parallel within profile capacity
- a same-Goal Planning trigger queues immediately but its Planner Run waits for admitted Engineering
  Runs to drain; once queued, it blocks admission of new Engineering Runs
- a material contract revision interrupts already admitted Runs for that Goal after the revision is
  durable
- a same-revision request that changes an existing Planning Work interrupts only that Work's active
  Planner after publication; creating a new Planning guard does not interrupt already admitted
  Engineering Runs
- possible overlap is serialized with `dependsOn`
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
interrupt.

Assistant never edits source or canonical files directly. Its local MCP server is an adapter over
existing controllers and the global publisher. Reply prose, tool-result summaries, and raw vendor
events are never parsed for control state. Planner still owns delivery decomposition.

The MCP tool descriptions and JSON schemas injected into the Assistant turn are the only authority
for tool arguments. Assistant calls those tools directly and never searches Project files,
`.hopi/runtime`, transcripts, or HOPI source to guess a schema. It reads an exact canonical or
diagnostic path returned by `hopi_read_state` only when that file's body is actually needed; broad
runtime search is neither discovery nor evidence.

An Inbox turn is eligible when it is pending, not already active in the one Home conversation, and
not covered by open event-target Attention. Public user turns have priority over internal Reflection
turns; each source class runs in receipt order. Project Attention blocks a tool targeting that
Project, not unrelated conversation or direct answers. A terminal Assistant or tool failure leaves
the turn pending under targeted Attention immediately. Vendor-local transient retry belongs to the
single configured invocation; Coordinator does not repeat that invocation. Only an explicit cached
session incompatibility may rebuild once from durable conversation history.

Messages remain writable while passes run. A material instruction first ensures Planning Work as
the Goal-wide guard, then increments `contractRevision` and publishes its effects. Once that
revision is durable, Coordinator interrupts the Goal's admitted Runs to avoid spending more work on
obsolete authority. The immutable-context publication guard remains the correctness boundary if a
result races that interrupt. Before completing an interrupted Generator Attempt, Coordinator makes
one safe task-branch checkpoint of partial source; it publishes no Evidence and advances no Work.
Older Runs may therefore preserve useful source but cannot publish state.

### State read and Reflection

The bounded HOPI state read is a current-state index, not a dump of the durable archive. It returns
Projects, Goals, scoped design, every Engineering Work, nonterminal Planning Work, open Attention,
derived Kanban facts, and an explicit list of active Runs. Historical Planning, resolved Attention,
and Evidence bodies remain canonical documents but are not inlined by default. Evidence references
on Work and local Project paths preserve the route to that history without a query DSL.

For each visible Work the state read returns a small runtime diagnostic descriptor: current
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

Reflection starts immediately for an unnotified Attention, unavailable Project, or stale running
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
an immediate signal; an unnotified Attention, unavailable Project, or stale running Attempt must
survive process restart and is assessed without waiting for a later digest. The Reflection receives a
code-derived trigger reason, semantic delta from the last assessed snapshot, a compact relevant state
slice, and bounded public conversation history. It excludes old Reflection briefs and full unrelated
document bodies. Reflection decides from those facts first and may inspect only exact diagnostic paths
for a concrete candidate. It has only read plus one `handoff_to_main` capability. A no-op result is
silent unless the same current snapshot still contains unnotified Attention. Attention already means
Assistant management is required, so Coordinator deterministically prepares one scoped internal
fallback brief and attaches the exact canonical Goal-local or workspace Attention references rather
than allowing a model omission to strand the target. A handoff durably creates one
internal Inbox turn, after which the speaking thread revalidates current state and owns every action
and optional operator notification.

One pending Reflection-sourced Inbox turn suppresses another Reflection assessment until that turn
is handled. This includes an internal turn blocked by its own event-target Attention: the durable
turn already represents the outstanding assessment, so its failure may be recovered or escalated
but must not recursively create more handoffs. An Attention-blocked public user turn remains
Reflection-eligible because no internal assessment exists for it yet.

Receiving a public user turn aborts an active Reflection-sourced speaking turn but not the independent
read-only Reflection process. Source priority selects public input next. Reflection may finish its
immutable snapshot, but Coordinator publishes its prepared brief only when the semantic digest is
still current; otherwise the result is discarded and the newest eligible digest is assessed later.
This avoids cancellation churn without letting stale thought act or delay speech. One digest is
otherwise assessed once. Reflection model failures retry with per-digest exponential backoff and a
fixed attempt ceiling; an exhausted digest remains visible in runtime diagnostics and is not retried
until semantic state changes. Consecutive internal handoffs are also bounded so a feedback loop cannot
consume unbounded calls.

## Reconciler and Scheduling

Before Reconciler starts, Coordinator fully validates the Assistant home and every linked project.
It validates the Repo binding and release ref, then validates the stable managed integration
worktree, delivery checkout, and Project package. Missing or inconsistent projection truth creates
workspace project Attention. A dirty delivery checkout blocks automatic release projection rather
than being reset or overwritten. Invalid Assistant-home truth still
fails closed to supervisor intervention.
Reconciliation, dispatch, integration, and delivery never race this startup scan or proceed from
missing original intent.

Each cycle:

1. validates the built-in profile and canonical packages
2. marks stale runtime Attempts interrupted and clears leases without reattaching children
3. advances the oldest eligible Assistant conversation turn
4. ensures final Planning assessment or consumes its current completion proposal
5. evaluates `ready(work)` and dispatches responsibility passes within capacity
6. after Reviewer success, performs deterministic integration while Work remains at `review`
7. publishes validated outcomes and wakes dependents after upstream `done`
8. evaluates completion and routes unnotified Attention through Reflection
9. observes the latest semantic digest and starts or coalesces non-blocking Reflection

`ready(work)` is one conjunction:

- Goal lifecycle is `active`
- Work kind and stage match one profile rule
- Work `contractRevision` is current
- Engineering Work has no nonterminal Planning Work in its Goal
- every `dependsOn` Work is `done`
- `notBefore` is null or elapsed
- `attempts < maxAttempts`
- no open targeted Attention covers its project, Goal, or Work
- no active Run already owns it and pass/worktree capacity is available

The UI may show every failed predicate, but readiness is not another state machine.

If `attempts >= maxAttempts` and no matching targeted Attention exists, Reconciler creates or reuses
it before evaluating the Work again. An interrupted exhaustion publication or offline import can
therefore never make exhausted Work runnable.

For an active Goal with no nonterminal Work, Coordinator completes only from one current unclaimed
targetless Attention produced by final Planning. If none exists, it ensures Planning Work. The
deterministic Reconciler never interprets success criteria itself.

There is no `orphaned` projection or second orphan-detection budget. A Goal with nonterminal Work
must be held by a visible failed readiness predicate. An invalid or otherwise unexplained hold
creates targeted Attention immediately instead of inventing another status.

Scheduling is global across projects. Goal priority orders ready Work across Goals; stable
topological order breaks ties within one Goal.

## Failure and Delivery

Work recovery has one authority: [Bounded recovery](./mvp_document_model.md#bounded-recovery).
Scheduling enforces that budget through `ready(work)`; C1 only distinguishes failure before and
inconsistency after its durable ref. Neither adds another Goal or Work lifecycle state.

### Notification

Open targeted Attention appears as **Waiting for Assistant** until the speaking Assistant has
delivered a user-facing question. An unresolved Attention with `notifiedAt` set appears as **Needs
you**. Both are projections of the same Attention document, not additional state. Raw Attention is
handled through Reflection and the speaking Assistant rather than exposed directly inside
conversation and Goal views. Targetless completion Attention appears in the normal update feed.
An eligible Reflection handoff binds exact canonical Goal-local or workspace Attention references
in ordinary Inbox context, and `notify_user` records one Run-local operator-facing message. Other
internal model text remains diagnostic only. After the model returns, Coordinator first publishes
that message as the complete public Inbox reply and only then acknowledges every
still-current linked Attention. Targeted Attention remains open. Completion resolves in its
acknowledgement publication. A crash between roots leaves a complete public reply and an
unacknowledged Attention; ordinary Inbox recovery finishes the acknowledgement. HOPI never records
delivery before the message exists.

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

When a Goal has no nonterminal Engineering Work and no current completion proposal, Reconciler
ensures Planning Work. Planner reads the Goal criteria, current design, Work Evidence, Git facts,
and project documentation:

- if more delivery is required, it creates the smallest additional Engineering Work; after the
  proposal validates, Coordinator marks Planning Work `done`
- if operator authority or missing external information is required, it publishes targeted
  Attention and leaves Planning Work at `plan`
- if proof is sufficient, it proposes the Goal's one unclaimed targetless Attention as supporting
  content, containing the completion summary and Markdown links to existing Work Evidence and Git
  facts; after validation, Coordinator marks Planning Work `done` as the gate

Creation of an unclaimed targetless Attention is valid only in that final Planner-success
publication, at the current `contractRevision`, with no nonterminal Engineering Work. Its presence
is the durable completion proposal; no `completionReady`, approval field, or new pass result is
stored.

Coordinator then verifies only structural conditions:

- the proposal remains the Goal's only open unclaimed targetless Attention
- Goal remains `active`
- no nonterminal Planning or Engineering Work remains
- target history contains exactly one reachable commit whose qualified Work trailer equals each
  done Engineering Work identity exactly, and that commit's tree contains the Work at `done`; Work
  IDs that are prefixes of other Work IDs never match
- no open targeted Attention covers the Goal or its Work

Coordinator installs Goal lifecycle `done` with `completionAttentionId` as the final gate.
Completion creates no dedicated Evidence document or deterministic snapshot identity.

If an accepted instruction changes the contract or requires new Planning before that Goal gate,
HOPI first resolves the proposal as superseded, then increments revision when required and ensures
Planning Work. This ordering makes an unclaimed proposal an assertion about current canonical
truth without adding a revision field. A process stop before Planning Work `done` causes Planner to
re-evaluate and reuse the candidate only while accurate. A process stop after Planning Work `done`
but before the Goal gate lets Coordinator finish from the durable proposal without another
semantic model call.

Before delivery, Coordinator verifies the Goal is still done and still references that
Attention. Reopen resolves an unnotified old completion as superseded before clearing the
reference and creating Planning Work.

Manual completion confirmation is not required.

## Preview Capability (P2)

Preview is a Project capability, not a Goal lifecycle, Work stage, or responsibility pass. After the
shared reviewed `scripts/hopi/prepare` succeeds, a reviewed executable at `scripts/hopi/preview` owns
only project-specific startup and shutdown behavior. The UI asks Coordinator to run these adapters
directly, so ordinary Start and Stop operations do not invoke a model.

The combined contract is one-click from a clean managed integration worktree. `prepare` may use a
shared package cache or project-native installation commands; `preview` makes the service reachable
before advertising its URL. A clear missing-dependency error is useful diagnosis, not successful
Preview behavior; requiring the operator to enter the managed worktree and install dependencies
violates the Project contract.

The first version always runs the Project's current integration target. It does not select a task
worktree, combine unintegrated Work, or construct a speculative Goal checkout. Coordinator owns the
disposable process, logs, endpoint, and health facts under runtime storage; none is canonical
workflow truth. A later multi-Repo Project may extend the same adapter input without changing this
product model, but Preview does not imply cross-Repo delivery support.

A running Preview is a lease on the release materialized when it started, not a hot-reload contract.
After C1 has durably advanced `hopi/release` and verified the managed integration projection,
Coordinator immediately stops any running or starting Preview for that Project, clears its endpoint,
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
streams in runtime storage. Exactly one line `HOPI_PREVIEW_URL=<url>` is the required ready signal,
not an early intention: the adapter emits it only after that endpoint is reachable. Coordinator
keeps the session at `starting` and the Start request pending until this line, adapter exit, or one
bounded startup timeout. Only the ready line produces `running`; exit or timeout produces
`startup_failed` with the captured logs and no extra health state. These are adapter I/O
conventions, not generic responsibility-Run environment, canonical Project configuration, or
workflow state.

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

On Start, Coordinator first checks for the reviewed adapter. If it is missing or startup fails, the
current UI shows the condition and asks whether Assistant should establish or repair Preview. A
positive answer submits an ordinary durable message with the adapter path and available failure
logs plus the immutable Project/Goal page context from which the operator confirmed repair. Context
helps Assistant judge reuse, reopen, or creation but does not force that Goal to receive the repair.
The message tells Assistant to first reuse any current Goal or Work already establishing Preview and,
only if none exists, call its Planning tool for creation or repair. A terminal setup Work whose
adapter still fails in a clean managed worktree is evidence to reopen or plan repair, not a reason
to declare the failure already accepted. The model judges equivalence from current documents;
there is no Preview setup Action, deduplication field, setup state, or Reconciler-created Work.
