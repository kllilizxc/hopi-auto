# HOPI MVP Execution

Status: forward execution authority
Last updated: 2026-07-12

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
- The deployment permits one active Coordinator through an OS-level instance lock.
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
  user-checkout content and never materializes source or documents into that checkout.
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
- Attention identity and `notifiedAt` govern notification delivery
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
consumed-result marker. Ordinary outcomes reference it from the owning Work gate; `replan` references
it from the new Planning Work gate. Unreferenced Evidence is provenance only and does not suppress a
rerun. The append-only referenced Evidence list is ordered oldest to newest, so a retry reads its
final reference first and expands backward only as needed. This existing order is the repair
context. The Run manifest may render that same order and label its final item for model salience;
this is a disposable projection, not a separate replay ledger or latest-failure pointer.

### Cross-root operations

Assistant home and project Git are not one atomic store. HOPI uses a simple idempotent sequence:

1. The pending Assistant turn is already durable before Codex runs.
2. Each mutating HOPI tool names and validates its own target. In that project it uses
   operation-specific single-gate publications for the blocking guard and requested effects, then
   publishes Goal Input for source `(homeId, eventId)` as the durable effect receipt. Goal-local
   Attention resolution is one more publication after Input. Goal creation establishes the Goal
   and initial Planning guard before its Input receipt.
3. After all optional tool calls and the final Codex reply, publish the Assistant-home reply and
   disposition and mark the turn handled.

The tool target owns destination choice for that call; the qualified Goal Input path and digest are
the project-effects receipt. One turn may create receipts in multiple Goals. Goal-local Attention
resolution may follow as the final unblocking gate. None of these is a generic operation receipt or
cross-root transaction entity.

After a process crash, a pending turn resumes in the Codex conversation. A tool whose Goal Input is
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
Codex uses the HOPI Attention/control tool when the answer resolves the condition. Clearing that
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
    replan: ensure_planning

  - when: { kind: engineering, stage: review }
    pass: reviewer
    on: { success: done, reject: generate }
    replan: ensure_planning

retry:
  maxAttempts: 3
  exhausted: create_attention

concurrency:
  planner: 1
  generator: 3
  reviewer: 1
```

The profile supports only exact kind-stage matching, one responsibility pass per dispatch rule,
explicit success/reject transitions, one built-in replanning handoff, one retry limit, and per-pass
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

The workspace Assistant always uses the Home Assistant/default configuration because its Codex
thread belongs to Home rather than any Project. Saving Project settings affects only responsibility
Runs dispatched afterward; an already-started Run keeps its resolved immutable command. Settings do
not alter the workflow profile, capacities, retry policy, Work stage, or Goal revision.

Pass result values are:

- `success`: no operator intervention remains; apply the profile transition after validation and
  any built-in postcondition
- `reject`: Reviewer returns engineering Work to `generate` with findings
- `replan`: ensure the Goal-wide Planning guard; Planner owns later Engineering Work changes
- `fail`: keep stage and apply bounded recovery

`blocked` is not a pass result. Ordinary failures retry according to recovery facts and budget;
conditions requiring operator authority may create targeted Attention immediately. Coordinator
validates the staged Attention document rather than parsing pass prose for control. Process
interruption, invalid output, and invalid pass-result combinations normalize to `fail`.

Semantic invalidation is expected concurrency control, not pass failure or Project failure. A stale
guard detected before a gate, during publication, or immediately before C1 produces the same
`stale` application: preserve any complete Run Evidence as unconsumed provenance, do not advance
Work, and let current canonical state determine the next reconciliation. It never creates Project
Attention merely because Goal lifecycle, revision, Work ownership, dependency truth, or another
guard changed while the Run was active.

A pass that knows retry cannot resolve the condition returns `fail` and may include a staged
targeted Attention document. In that case Coordinator publishes Evidence plus Attention and does
not publish a Work gate or increment `attempts`; after resolution a new Run starts. A `replan`
publishes Evidence plus the Planning guard, and Planner owns the later Work update. If the project
root is invalid or unwritable, Coordinator publishes only Assistant-home project Attention. This is
a document proposal, not a second pass result or prose interpretation.

A targeted Attention proposal is valid only with `result: fail`. `success`, `reject`, or `replan`
combined with targeted Attention is an invalid pass result and normalizes to ordinary `fail` without
publishing the proposed Attention. A responsibility must not classify its own sandbox restrictions,
Git metadata access, unavailable local port, or missing optional tool as operator authority. It
records those facts in the result and raw transcript; bounded recovery and Background Reflection
decide whether repair or eventual user escalation is useful.

Valid results by responsibility pass:

| Pass      | Results  |
| --------- | -------- |
| Planner   | `success | fail`  |
| Generator | `success | replan | fail`  |
| Reviewer  | `success | reject | replan | fail` |

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
material ambiguity through purpose-driven questions, updating `design/**` with decisions already
established, and proposes the smallest independently schedulable engineering Work set, complete
acceptance criteria, all known ordering edges, and current contract revisions. It proposes targeted
Attention when an answer may materially change that output or when it cannot safely infer operator
authority; it does not ask merely to satisfy a fixed interview ritual.

Independently testable code is not automatically independent Work. Planner keeps a prerequisite and
its only consumer together when they share the same primary source surface and the prerequisite has
no separately useful operator outcome. A helper-only extraction that exists solely to enable one
panel rewrite therefore receives one Generator, Reviewer, and C1 cycle rather than a ceremonial
dependency edge. Planner splits Work only for real ordering, isolation, or independently valuable
delivery.

Planner decides which adopted references matter to which Engineering Work. For every related Work,
it writes the exact Goal-relative image path and intended use or limitation into the Work Markdown.
It does not add an attachment field to Work and does not propagate unrelated Goal images merely
because they exist.

Every newly proposed Engineering Work starts at `stage: generate`; only Generator, Reviewer, and C1
advance it. Planning Work remains `plan` while clarification is required and becomes `done` with the
complete proposal. These are fixed profile facts, not details Planner must rediscover from history.

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

Planner never creates a second nonterminal Planning Work. Success means the entire proposal was
published before Planning Work becomes `done`. A clarification question uses the ordinary
Attention-producing path, leaves Planning Work at `plan`, and consumes no failed attempt.

Planner proposes only `design/**`, Work, targeted or completion Attention, and a missing root
`AGENTS.md`. It never creates or rewrites `evidence/**` and never appends `evidenceRefs`. Every
responsibility writes only its Run-local `result.json`; Coordinator alone derives immutable Evidence
from that result and appends its reference while publishing the owning gate. Evidence from an
earlier failed Planner Run is retry input, not a template for new Planner output.

Planner reads existing documents only from the immutable authority root and copies into the sparse
proposal only a document it intends to replace. It does not mirror unchanged Goal-package files;
their absence means unchanged, never deleted.

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

Planner may return only `success` or `fail`. Success means its complete sparse proposal and Run
result are ready for Coordinator validation. Fail means the Run could not produce a valid proposal;
a targeted Attention accompanies fail only when retry cannot supply required operator authority.

### Generator

Generator edits only the stable task worktree. Its current assignment inlines the owning Work
objective and acceptance criteria, plus the latest referenced Evidence as the reason for a retry when
present. It reads the Work contract, design, current target state, and findings from the staged
canonical context bundle; changes source and normal project docs; runs focused checks; and produces
Evidence. It returns `success`, `replan`, or `fail`: replan means the accepted design cannot be
implemented safely, while fail means this Run did not complete valid implementation proof.

When the Work body explicitly cites a Goal image asset, Generator receives both its staged local
path and the actual image input. It must apply the documented purpose rather than infer that every
visual detail is a requirement.

Generator may inspect Git status and diff but never writes the Git index, creates commits, changes
branches, merges, rebases, or resets. Coordinator snapshots safe task-worktree changes after the Run;
an inability to run `git add` inside the model sandbox is therefore expected and is never a blocker.

A responsibility Run resolves ordinary project paths from its assigned `cwd` and reads integration
truth only through the immutable context bundle. It does not receive the Preview-adapter
`HOPI_PROJECT_ROOT` variable: exporting the managed integration root there could make a task script
bypass its stable worktree. Project Preview alone owns that variable.

### Reviewer

Reviewer independently checks acceptance criteria, diff, tests, and material runtime behavior.
It normally reads without editing source. Implementation rejection records findings and returns
the same Work to `generate`; invalid design returns `replan`. Reviewer success keeps the durable
stage at `review` while Coordinator immediately attempts deterministic integration under the same
Work lease.

Before Reviewer starts, Coordinator rematerializes any dirty HOPI-managed task checkout from its
stable task-branch checkpoint. "Clean" means `git status` is empty at the exact task HEAD; the Work's
committed delta from `hopi/release` remains present. This makes review proof describe exactly the
candidate C1 can integrate. The checkout is disposable and no user checkout is touched. A Reviewer
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

Reviewer may return `success`, `reject`, `replan`, or `fail`: reject identifies an implementation
defect against accepted criteria, replan identifies an invalid design or Work contract, and fail means
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
managed integration root plus the accepted task changes. No user checkout, user branch, index, or
uncommitted file participates in construction or materialization.

The guarded ref move to C1 is the one irreversible integration boundary and is independent of
`publish(bundle)`; success is reported only after Git confirms ref durability. A conflict, failed
check, or ref-update error verified to have left the old target may record Evidence and increment
`attempts`; rebuilding on a clean target advance does not. If an uncertain update leaves the ref at C1, source
is treated as integrated and the project blocks rather than publishing Work failure or retrying.
After the boundary, source is never integrated again, rolled back, or counted as Work recovery. Any
ref, commit, Work, Evidence, or managed-worktree inconsistency creates workspace project Attention
and keeps the project out of scheduling. Coordinator never repairs individual paths, resets the
managed root, or touches `repoPath` or another user checkout automatically. Since ordinary
canonical publications may be newer than the last Git checkpoint, ownership alone does not make
the managed root disposable. There is no metadata follow-up commit, integration-pending state, or
merge stage. Mechanical guarantees belong to the publish ADR.

## Worktrees and Parallelism

Each linked Repo has a stable managed integration worktree materializing its `hopi/release`. The
primary root remains the base for canonical publication and Project entrypoint scripts; all managed
roots are distinct from user checkouts.

An engineering Work deterministically maps to one stable task branch and worktree in each Repo named
by its `repos` field. Retries reuse those branches. Task worktrees live under Assistant-home runtime
storage and start from their Repo's current `hopi/release`. A responsibility receives one logical
workspace containing all named roots; no Repo subtask or extra responsibility is created. Checkout
directories are disposable and may be rebuilt from their stable branches after migration.

### Project preparation

Primary `scripts/hopi/prepare` is the Project's one reviewed, executable preparation contract. It is a fixed
convention rather than Project configuration or lifecycle state. The script is foreground,
non-interactive, idempotent, and returns zero only when the current checkout can build, test, and run.
It may populate ignored dependencies and caches but must not modify tracked or non-ignored Project
files. Coordinator invokes it with the primary root as cwd and a runtime-only `HOPI_REPOS_FILE`
mapping stable Repo IDs to the exact task or integration roots that will be consumed before every
Generator, Reviewer, and Preview start. Repeated invocation, rather than a HOPI-maintained lockfile
fingerprint, is the freshness check. The script may call Repo-native setup commands through that
manifest; HOPI does not add per-Repo preparation configuration.

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
ready URL. There is no initialized flag, prepare revision, setup Action, or preparation Kanban state.

If a code change makes preparation obsolete, the candidate fails this existing pre-review check and
the same Work repairs it. If the script exits successfully but the environment is still wrong, normal
checks and Reviewer expose the defect. Process launch, provider quota, interruption, and malformed Run
protocol failures are operational Run failures: they remain in Attempt diagnostics, receive bounded
runtime backoff, publish no responsibility Evidence, and do not increment Work `attempts`.

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
`fail`, `replan`, or legitimate Attention remain isolated and recoverable, while only a validated
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
- possible overlap is serialized with `dependsOn`
- deterministic source integration is idempotent by the qualified project/Goal/Work trailer

Independent tasks may finish concurrently. Final publication and integration enter the global
publication queue. Tests and conflict analysis run before entering it.

## Global Assistant

The Assistant execution contract is defined in [the Assistant design](./mvp_assistant.md). It is one
persistent Codex conversation with ordinary replies and optional HOPI tool calls, not a
responsibility pass or staged-diff producer.

Conversation is the default control surface. The selected Project or Goal is context only. Common
buttons may continue to call the same deterministic controllers directly; the MVP explicitly
provides **Pause** on active Goals and **Resume** on paused Goals. Cancel, reopen, priority, timing,
design editing, and Planning may be requested in conversation, where Codex chooses whether to call
the matching HOPI tool.

Lifecycle control has no separate worker or queue. On each ordinary reconciliation scan, a Goal
whose lifecycle is not `active` loses all of its Run leases before any further decision. The
interrupt is Goal-scoped, so pausing one Goal does not stop independent work in the same Project.
The existing semantic publication guard remains the final protection for a result that races the
interrupt.

Assistant never edits source or canonical files directly. Its local MCP server is an adapter over
existing controllers and the global publisher. Reply prose, tool-result summaries, and raw Codex
events are never parsed for control state. Planner still owns delivery decomposition.

An Inbox turn is eligible when it is pending, not already active in the one Home conversation, and
not covered by open event-target Attention. Public user turns have priority over internal Reflection
turns; each source class runs in receipt order. Project Attention blocks a tool targeting that
Project, not unrelated conversation or direct answers. Bounded Assistant or tool failure leaves the
turn pending under targeted Attention.

Messages remain writable while passes run. A material instruction first ensures Planning Work as
the Goal-wide guard, then increments `contractRevision` and publishes its effects. Older Runs may
preserve source and Evidence but cannot publish state.

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
silent. A handoff durably creates one
internal Inbox turn, after which the speaking thread revalidates current state and owns every action
and optional operator notification.

Receiving a public user turn aborts an active Reflection process and any active Reflection-sourced
Assistant turn before waking the speaking thread. The internal Inbox turn stays pending; source
priority selects public input next, and the internal turn may rerun only after that input. An
interrupted digest remains unassessed and may be retried from a fresh snapshot after the user turn.
Ordinary state changes during Reflection do not need to abort it because its brief has no authority
and the speaking thread must reread state. One digest is otherwise assessed once. Consecutive
internal handoffs are bounded; failure to converge becomes targeted Attention rather than an
unbounded feedback loop.

## Reconciler and Scheduling

Before Reconciler starts, Coordinator fully validates the Assistant home and every linked project.
It validates the Repo binding and release ref, then validates the stable managed integration
worktree and its Project package. Missing or inconsistent managed truth creates workspace project
Attention. A dirty user checkout does not affect eligibility. Invalid Assistant-home truth still
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
8. evaluates completion and delivers unnotified Attention
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

Open targeted Attention appears as pinned **Needs you** messages and an unresolved filter inside
conversation and Goal views. Targetless completion Attention appears in the normal update feed.
Both can use the provider-neutral webhook configured by `HOPI_ATTENTION_WEBHOOK_URL`. The built-in
Assistant path may also deliver an Attention when Reflection decides a speaking-thread update is
useful: the handoff binds the exact Goal Attention in ordinary Inbox context, and `notify_user`
exposes that pending turn before acknowledging the Attention. Both paths claim the same canonical
delivery key and `notifiedAt`; neither owns separate provider state or a deduplication table.

The delivery worker scans open Attention with `notifiedAt: null`. Targeted Attention is immediately
eligible; targetless Attention is eligible only while its Goal is `done` and references it through
`completionAttentionId`. Delivery uses canonical Attention identity as the idempotency key and
publishes `notifiedAt` after acknowledgement. Targeted Attention remains open. Completion resolves
in the same publication. Resolved Attention is never newly delivered. The acknowledgement
publication rereads Attention and, for completion, its Goal reference; it applies only if both are
still current. An Attention-linked Assistant exposure follows the same project acknowledgement
after its home-root visibility gate. A crash between roots leaves a public pending turn and an
unacknowledged Attention, so ordinary Inbox recovery and at-least-once delivery remain sufficient.

Persistent transport failure leaves `notifiedAt` null and keeps retrying with bounded in-memory
backoff. It does not block delivery to other readable roots and does not create recursive Attention
about Attention.

An external process supervisor is required to restart or alert on Coordinator death or an
unwritable Assistant-home publication root, because HOPI cannot persist Attention in that root.
This is a deployment capability, not a product state machine.

## Goal Completion

Planner owns the semantic completion assessment; Coordinator alone declares the lifecycle
transition.

When a Goal has no nonterminal Engineering Work and no current completion proposal, Reconciler
ensures Planning Work. Planner reads the Goal criteria, current design, Work Evidence, Git facts,
and project documentation:

- if more delivery is required, it creates the smallest additional Engineering Work and then marks
  Planning Work `done`
- if operator authority or missing external information is required, it publishes targeted
  Attention and leaves Planning Work at `plan`
- if proof is sufficient, it proposes the Goal's one unclaimed targetless Attention as supporting
  content, containing the completion summary and Markdown links to existing Work Evidence and Git
  facts, then marks Planning Work `done` as the gate

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

On Start, Coordinator first checks for the reviewed adapter. If it is missing or startup fails, the
current UI shows the condition and asks whether Assistant should establish or repair Preview. A
positive answer submits an ordinary durable message with the adapter path and available failure
logs, telling Assistant to first reuse any current Goal or Work already establishing Preview and,
only if none exists, call its Planning tool for creation or repair. A terminal setup Work whose
adapter still fails in a clean managed worktree is evidence to reopen or plan repair, not a reason
to declare the failure already accepted. The model judges equivalence from current documents;
there is no Preview setup Action, deduplication field, setup state, or Reconciler-created Work.
