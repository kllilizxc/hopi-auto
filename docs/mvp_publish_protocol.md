# MVP Publish Protocol

Status: accepted implementation ADR
Last updated: 2026-07-13

This ADR defines the small publication kernel beneath [the MVP design](./mvp_design.md). Document
invariants belong to [the document model](./mvp_document_model.md), and semantic behavior belongs
to [the execution design](./mvp_execution.md). This ADR covers process-crash behavior, not a general
transaction system or sudden-power-loss durability.

## Decision

The one ordinary mutation primitive is:

```text
publish({
  root,
  supportingWrites,
  gateWrite?,
})
```

One call changes exactly one Assistant-home or project root and has at most one domain gate.
Supporting writes establish content, provenance, or prerequisites. The optional gate is the one
write whose presence claims the publication's intended domain effect, including installing a
guard, authorizing a next phase, claiming a transition, or removing a guard.

Coordinator code knows which write is the gate from the flow it is executing. Models and API
callers provide candidate documents, not operation names, ordering instructions, or custom actions.
The kernel does not inspect a diff to infer a mutation class.

If an operation must block before doing other work, publish the blocking fact as its own gate first.
If it has several gates, split it into several publications. This constraint is intentional: the
kernel has one ordering rule instead of a registry of operation-specific protocols.

## Ownership And Bundle

The deployment runs one Coordinator:

- It holds one advisory OS instance lock under Assistant home for its lifetime.
- One global in-memory mutex serializes every publication and every canonical control snapshot.
- Model calls, tests, Runs, and task-worktree edits occur outside the mutex.
- Responsibility passes and subprocesses never write canonical control documents directly.
- One writable project may belong to only one active Assistant home.

Ordinary `publish` still changes exactly one root. Project canonical documents live in the primary
Repo's stable HOPI-managed integration worktree on `hopi/release`; user-selected `repoPath` values
only locate Git Repos. Cross-Repo Engineering completion does not pretend that one ordinary bundle
is atomic. It uses the fixed primary-C1 manifest and secondary projection protocol specified in
[the multi-Repo design](./mvp_multi_repo.md).

A bundle contains stable root identity, its current path, writes, and expected prior hashes:

```yaml
root:
  id: project:P-1
  path: /hopi-home/.hopi/projects/P-1/integration
supportingWrites:
  - path: .hopi/docs/goals/G-1/evidence/E-1.md
    expectedHash: null
    content: staged-bytes
gateWrite:
  path: .hopi/docs/goals/G-1/work/W-1.md
  expectedHash: prior-hash
  content: staged-bytes
```

Paths must stay beneath the root and may not traverse symlinks into another root or runtime data.
Duplicate paths are rejected. Direct external canonical-file mutation while Coordinator runs is
unsupported.

Responsibility proposal directories use the same write-list semantics as this bundle rather than a
second candidate model. Each starts as an empty sparse overlay beside a complete immutable authority
snapshot. A present path proposes one add or replacement with its staged prior hash; an absent path
means unchanged. Responsibility passes cannot delete canonical documents in the MVP. Coordinator
combines proposed writes with current authority to build and validate the complete candidate, so
sparse staging does not weaken snapshot or conflict guards.

While holding the mutex, Coordinator:

1. rereads every affected file and checks expected hashes
2. builds the complete post-publication candidate view
3. validates schemas, references, lifecycle rules, semantic authorization, and the single-gate
   constraint
4. atomically replaces supporting files in deterministic path order
5. rechecks the gate's expected hash and semantic guards, then atomically replaces the gate last
6. rereads the affected canonical view before returning

An invalid candidate writes nothing. If current canonical facts already express the requested
effect, publication returns already current.

Supporting writes may not independently install or remove an eligibility guard, mark an Inbox
event `handled`, set Attention `resolvedAt`, or mark Goal or Work terminal. Those claims belong in
`gateWrite`. Work definitions and dependency edges may be supporting writes while an already
durable Planning Work guard blocks their Goal.

## Ordinary File Safety

An ordinary file replacement writes complete bytes to a fresh sibling temporary path and atomically
renames it over the target. A process stop therefore leaves either the previous complete file or the
new complete file, never a half-written target. Known abandoned temporary files are removed at boot.

Ordinary publication does not flush every file and parent directory to stable storage. A sudden
machine or storage power loss may roll back any ordinary intermediate document, including a gate.
That is an explicit MVP non-guarantee. Boot validation blocks inconsistent truth rather than
guessing.

There are two durability exceptions:

1. A newly received Inbox turn is acknowledged to its transport only after its file, referenced
   Assistant-home image bytes, and their parent directories have been made durable with the platform
   filesystem primitives. Image files are supporting writes and the Inbox event is the receipt gate.
2. C1 integration uses Git-supported object and ref durability before its ref becomes the completion
   boundary.

No other ordinary publication waits for synchronous Git history or full filesystem durability.

## One-Gate Mapping

The fixed product flow maps to the primitive without defining more kernel protocols:

Evidence named below is always generated by Coordinator from the responsibility's Run-local
`result.json`. A model proposal never creates `evidence/**` or appends `evidenceRefs`; Coordinator
adds both as part of the same validated publication.

| Flow                        | Supporting writes                                             | Gate write                                    |
| --------------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| Initial planning            | Goal, design, adopted image assets, Goal Input                 | Planning Work guard                           |
| Assistant design tool       | design Markdown and adopted image assets                      | immutable Goal Input                          |
| Assistant control tool      | operation-specific support                                    | Goal or Work control transition               |
| Assistant tool receipt      | none                                                          | immutable Goal Input                          |
| Reflection handoff          | none                                                          | new internal pending Inbox turn               |
| Assistant final reply       | none                                                          | handled Inbox turn; Reflection visibility in the same gate |
| Assistant Attention acknowledgement | handled public Inbox turn                              | Attention `notifiedAt` or completion resolution |
| Planner question            | `AGENTS.md` bootstrap, design, Coordinator Evidence           | targeted Attention                            |
| Planner plan success        | `AGENTS.md` bootstrap, design, Work DAG, Coordinator Evidence | Planning Work `done`                          |
| Planner completion proposal | targetless completion Attention, Coordinator Evidence         | Planning Work `done`                          |
| Generator source savepoint  | task-branch source checkpoint                                 | none                                          |
| Ordinary pass result        | artifacts, Evidence                                           | Work transition                               |
| Attention-producing result  | Evidence                                                      | targeted Attention                            |
| Replan                      | Evidence                                                      | Planning Work guard referencing that Evidence |
| Goal completion             | none                                                          | Goal `done` and pointer                       |
| Answer resolution           | verified effects and receipts                                 | Attention `resolvedAt`                        |

Creating a dependency target and adding the edge are separate publications when necessary. A
nonterminal Planning Work is itself the Goal-wide Engineering guard, so it is published before
other replanning effects and changed to `done` only after Planner outputs validate.
Planner success requires no separate design-approval publication; unresolved operator authority is
represented by targeted Attention instead.
An Attention-producing result must be `fail`; other pass results combined with targeted Attention
are rejected before the Attention gate is publishable.
Planner publications require their staged integration target. Engineering publications allow an
unrelated C1 to advance that target when all selected canonical guard hashes remain current; the
task branch stays isolated and the later C1 path owns deterministic rebuild or conflict rejection.
A Planning Work published after an Engineering Run was admitted is likewise not an independent
stale condition. Coordinator delays that Planner Run until admitted same-Goal Engineering Runs
drain and blocks new Engineering dispatch in the meantime; exact canonical hashes still reject a
result when Planning actually changes its semantic inputs.
Canonical snapshot guards compare the complete protected selection, including path membership and
content hashes. A selected file created after staging therefore stales the result just like a
selected file changed or removed. Result-owned supporting writes are the only allowed delta while
that result's gate is being validated.
Every semantic-guard rejection has one outcome regardless of where it is detected: unconsumed
Evidence may be preserved, the application is `stale`, and no Project Attention is created. This
includes the pre-C1 Reviewer-success check and a lifecycle change racing Run termination.
Writing a HOPI design document has no gate semantics by path alone. Any Goal revision, Planning
guard, or Work change is an explicit HOPI tool request validated and published through its existing
gate.

Adopting an Inbox image adds no gate of its own. Its immutable Goal-local bytes and
`design/references.md` entry are supporting writes in the same Goal publication whose existing Input
or Planning Work gate accepts the instruction. The owning Planning Work includes the selected paths,
so no responsibility can dispatch from a publication that claims the instruction but lacks its
visual context.

A material revision is the only case where an existing mutable document must be staged ahead of
its gate. While the current Planning guard is open, a nonterminal Work document may therefore
carry exactly `Goal.contractRevision + 1` as unconsumed support. Mixed current/next Work revisions
are valid only during this guarded publication window. Eligibility still requires exact equality
with the Goal's current revision, so neither next-revision support nor current-revision Engineering
Work can dispatch while the Planning guard exists. The Goal revision write is the single gate that
consumes the staged Work. This narrow recovery state replaces a WAL or multi-file filesystem
transaction; the pending Assistant turn and idempotent HOPI tool deterministically retry from
current documents after a crash.

Inbox turn handling and Attention resolution are separate gates. A Goal-local answer completes its
project Input gate, then its Attention resolution gate, then Codex continues toward the final home
turn gate. An answer to event-target Workspace Attention resolves that guard and handles only the
answer turn; the older turn stays pending and becomes independently eligible with the answer visible
in durable conversation history.
Project-target Attention resolves only after deterministic repair validation.

A read-only Reflection may only prepare one handoff brief. Coordinator confirms the observed digest
is still current before creating one new internal pending speaking Inbox item as its single gate.
Reflection cannot publish Project state. If the speaking thread decides the operator should see the
eventual reply, `notify_user` records only capability-local intent. After the model returns,
Coordinator first exposes and handles that same turn with its complete reply, then acknowledges each
exact canonical Goal-local or workspace Attention reference from Inbox context in its owning-root
publication. A crash before the handled gate leaves the turn internal and pending; a crash after it
leaves a handled public turn whose normal recovery finishes any missing acknowledgement. Recovery
never infers visibility or Attention identity from reply prose. An optional webhook mirrors only the
handled public Inbox reply and records its independent `webhookDeliveredAt`; it never acknowledges
raw Attention.

## Process-Crash Reconciliation

The ordinary Reconciler uses current domain facts; it never guesses an interrupted publication
intent. A still-pending Assistant turn resumes through Codex; repeated HOPI tools use their named
target, current guards, expected content, and Input source identity to complete safely.

A Reflection process interrupted before its handoff owns no durable effect. A durable internal turn
is sufficient recovery state after handoff; the disposable Reflection is never resumed. Its source
and visibility distinguish it from operator input without adding a second queue protocol.

- Supporting Evidence without a Work gate is provenance only. The pass may run again with a new
  Run identity.
- An Attention-producing result stops after its Attention gate and does not update Work or
  `attempts`. After Attention resolves, the pass runs again with a new Run identity.
- Planner clarification is the same Attention-producing path. Established design may be supporting
  content, Planning Work remains at `plan`, and a clear requirement may bypass this path entirely.
- Replan stops after the Planning Work gate, which references its Evidence as the consumed-result
  marker. Planner owns the next step and updates affected Engineering Work. Reconciler does not
  apply an old pass transition afterward.
- Planning Work at `plan` runs Planner and blocks every Engineering dispatch and returning result
  in its Goal.
- A targetless completion proposal without its Planning Work gate is unconsumed support. Planner
  runs again and may reuse it only while its message remains accurate; otherwise Planner resolves
  it as superseded before creating a replacement.
- A completion proposal with its Planning Work gate but without the Goal gate needs no repeated
  semantic model call. Coordinator publishes Goal `done` only if the proposal is unique and every
  current structural completion guard still passes; otherwise it remains unclaimed until the
  blocker clears or current planning supersedes it.

Work stores `attempts` as a top-level field. Readiness requires `attempts < maxAttempts`. A crash
before the Work gate may therefore undercount one attempt; the MVP accepts that and reruns. Once a
Work gate reaches the limit, Work cannot dispatch, and Reconciler creates or reuses blocking
Attention if it is missing.

Completion creates no separate Evidence document or content-digest identity. Its Attention body
links Evidence and Git facts that Planner already judged sufficient.

## Attention

Attention has no type discriminator. Its control meaning is:

- `resolvedAt: null` means open
- a non-null `target` blocks that event, project, Goal, or Work and its defined descendants
- `target: null` is a non-blocking Goal completion proposal and becomes deliverable only while its
  Goal is `done` and references it through `completionAttentionId`
- `notifiedAt` records acknowledged delivery, not resolution

The body carries the question, blocker explanation, or completion message. Models interpret that
Markdown; the kernel does not parse it into an action. A materially different operator-visible
message uses a new Attention identity.

Assistant delivery is durable before `notifiedAt`: the complete handled public Inbox reply is its
receipt, and exact canonical Inbox references correlate it to Attention across roots. The optional
webhook is an at-least-once mirror of that reply; a crash after transport acknowledgement but before
Inbox `webhookDeliveredAt` may repeat the same event identity without repeating domain effects.

## Cross-Root Handoff

Assistant home and a project are independent roots. A mutating HOPI tool uses these local
publications:

1. The source Inbox turn, whether public operator input or an internal Reflection brief, is already
   durable and remains `pending` while Codex runs.
2. The tool validates its explicit target and any selected durable Inbox attachments. When creating
   a Goal or requiring planning, it publishes the Goal, adopted Goal-local image bytes, reference
   Markdown, and Goal Input as support and Planning Work as that publication's gate.
3. It publishes operation-specific project effects under the existing one-gate rules, then
   publishes immutable Goal Input `inputs/<homeId>/<eventId>.md` as the effect receipt when another
   gate was required. A design-only tool may publish design support and Input together.
4. Codex may call more tools. Only its final reply atomically stores home reply and disposition and
   marks the Inbox turn `handled`.

The tool call fixes its own destination; Input proves that project phase completed. Input contains
source Home, event identity, digest, lossless content, and attachment references. The same qualified
turn has at most one identical Input in a given Goal but may have Inputs in multiple explicitly
targeted Goals.

After a process stop:

- a pending turn resumes through the persistent Codex conversation or a rebuilt session
- missing Input makes a repeated tool reread current state and complete or safely reject the effect
- matching Input proves that Goal accepted the turn and lets later idempotent phases continue

A Goal-local answer tool publishes effects and Input before `resolvedAt`. An event-target answer
resolves its Workspace Attention and is handled; the original turn then runs again from current
conversation and canonical context. Project-target Attention is not answerable by model assertion:
a validated repair such as Repo rebind completes first and resolution follows. Unavailable unrelated
projects do not block direct conversation or tools targeting valid projects.

## C1 Integration

Reviewer success creates one commit, C1. Its tree contains:

- source and ordinary project-document changes
- immutable integration Evidence
- the owning Work already at `stage: done` with appended `evidenceRefs`

C1 carries qualified Work and producer Run trailers, and its first parent is the validated old
integration target. Work stores no copy of the commit hash; Coordinator derives the integration
commit from the unique reachable qualified trailer.

For a single-Repo Work, Coordinator retains the following behavior. For multi-Repo Work, the same
primary steps wrap durable secondary component candidates and the Project release manifest as
specified in the multi-Repo design. Coordinator:

1. constructs and validates every C1 object without changing the target ref or canonical working
   tree; the candidate snapshots the complete validated managed root plus accepted task changes
2. makes those objects durable using supported Git durability settings and commands
3. rereads current truth, rechecks all semantic guards, and chooses the current target as C1 parent;
   if it advanced cleanly after Reviewer staging, reconstructs and validates the candidate on it
4. uses a guarded, durability-configured Git ref update whose successful return means the target
   moved from that old value to a durable C1
5. if that command reports an error or uncertain result, rereads the ref before choosing any domain
   outcome
6. materializes the complete C1 tree in the managed integration worktree before releasing the
   publication mutex

Git commands that inspect or refresh the same managed worktree index run sequentially. In
particular, `write-tree` and `status` may both take the index lock even though they are validation
reads from HOPI's perspective. Parallelism remains across model Runs and distinct Work checkouts;
the C1 verifier does not add another lock or retry policy to race its own commands.

A successful guarded ref command is the irreversible integration boundary. A clean target advance
observed after Reviewer staging but before construction causes Coordinator to rebuild against the
new target without incrementing Work `attempts`. A ref change during the globally serialized
guarded update is external ambiguity and follows the old/C1/other reread rule below.

After any uncertain ref-update result, only a ref verified at the old target permits a normal Work
failure. A ref at C1 means source is already integrated and Work is `done` in C1; Coordinator may
retry durability confirmation or block the project, but never publishes Work failure, retries
integration, or increments `attempts`. Any other ref value is ambiguous and blocks. Orphan objects
created before a ref move own no domain effect.

If materialization stops or the managed worktree does not match C1, Coordinator creates or reuses
project-targeted Attention and keeps the Project out of scheduling. It does not compare and repair
paths or reset the managed root: ordinary canonical publications may be newer than the latest Git
checkpoint. It never resets `repoPath` or another user checkout. Since the ref already contains
Work `done`, projection recovery never returns Work to `generate` or increments `attempts`.

## Git Audit

Ordinary publication does not synchronously create a Git audit commit. Canonical documents remain
workflow truth.

Task-branch source checkpoints are separate Run savepoints. Coordinator alone writes their Git
index and creates their commits after Generator Runs. A checkpoint may preserve partial output and
does not consume a pass result, change Work, or imply success; only a later validated Work gate and
eventual C1 can do so.

Git checkpoints may be created by C1, after Goal completion, or by a background checkpoint worker.
Their failure never changes Goal, Work, Inbox, or Attention state. Git history is audit and export
support, not a second workflow authority.

## Boot

Before enabling Assistant turn processing, dispatch, integration, or delivery, Coordinator:

1. acquires the instance lock and removes known temporary files
2. validates Assistant-home identity, Inbox turns, project links, and Attention
3. validates each Repo binding, `hopi/release` ref, and stable managed integration worktree, then
   validates Project identity, Goal and Work documents, references, Evidence, and qualified
   trailers
4. blocks and excludes any ambiguous, invalid, or unwritable project
5. fails closed through the external supervisor if Assistant home itself is invalid or unwritable
6. enables valid roots and starts the ordinary Reconciler

Root scheduling eligibility is a rebuildable runtime projection. Project-targeted blocking
Attention is its durable operator-facing reason; no additional project lifecycle is stored.

## Failure Boundary

The MVP guarantees:

- one Coordinator and one in-process publication order
- full candidate and expected-hash validation before the first write
- at most one gate per ordinary publication, installed after supporting writes
- complete old-or-new individual files after a process stop
- durable Inbox receipt before transport acknowledgement
- a guarded durable C1 ref before integration completion
- domain idempotency through Inbox turn state, Goal Input, Work Evidence references, Attention identity,
  and qualified C1 trailers

The MVP does not guarantee:

- atomicity for a multi-file publication or across roots
- sudden-power-loss durability for ordinary documents
- generic automatic continuation of an interrupted publication beyond the documented pending-turn,
  HOPI-tool, and domain-idempotent recovery paths
- automatic repair of a post-C1 managed-worktree mismatch
- exactly-once notification
- safe coordination with direct external canonical-file edits
- automatic import from or publication into a user checkout or user-owned branch
- continuation of a pass subprocess after Coordinator exits

An ambiguous project creates or reuses project-targeted blocking Attention and remains unscheduled.
An invalid Assistant home cannot safely persist that Attention, so boot fails closed and the
external supervisor alerts the operator.

## Required Tests

The implementation must cover:

- instance-lock exclusion and publication mutex serialization
- expected-hash or final-candidate failure writes nothing
- supporting writes precede the single gate
- injected process stops leave every ordinary target wholly old or wholly new
- Inbox transport acknowledgement occurs only after its turn receipt is durable
- direct reply, tool success, process stop before Goal Input, and process stop between Input and
  final home handling
- Planning Work blocks Engineering dispatch and returning results until `done`
- Evidence without a Work gate remains unconsumed and a fresh Run may retry
- Attention or Planning gates never cause an old Work transition to be reconstructed
- Work at the retry limit cannot dispatch and gains missing blocking Attention
- only final Planner success can create the one unresolved unclaimed target-null Attention
- a crash before its Planning Work gate reruns Planner, while a crash after that gate lets
  Coordinator finish from structural guards without another semantic model call
- C1 object durability and semantic recheck precede guarded ref update
- successful guarded ref update returns only after C1 ref durability
- ref-update error rereads old/C1/other and respectively fails safely, treats C1 as integrated, or
  blocks; C1 never produces a Work failure
- a clean target advance after Reviewer staging rebuilds C1 without incrementing `attempts`
- post-ref managed-worktree mismatch blocks without touching `repoPath`
- invalid project and Assistant-home handling follow the documented failure boundary

## Deferred

Add only after measured need:

- full per-file and directory durability plus sudden-power-loss fault injection
- automatic post-C1 managed-worktree repair that preserves newer canonical publications
- synchronous Git audit commits for selected ordinary publications
- stronger general multi-file or cross-root atomicity outside the fixed Project release projection
- primary Repo switching or removal after Project creation
- coordination with supported external canonical-file writers

These remain kernel improvements. They must not introduce new Goal, Work, Inbox, or Attention
lifecycle values.
