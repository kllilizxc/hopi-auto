# HOPI MVP Design

Status: current product authority

Last updated: 2026-08-13

Migration baseline: `0fe89334e30f76c45da00ada4f8b75378f5dab8d`

HOPI evolves from the existing Work-based product. This document replaces both the fixed
`Planner -> Generator -> Reviewer -> C1` product model and the clean-slate proposal that removed
Work entirely.

The migration changes the boundaries that caused real failures while preserving the product and
runtime capabilities that already work: Project linking, Goal and Work documents, the Board,
Assistant feed, stable worktrees, multi-Repo execution, Preview, provider adapters, artifacts, and
the publication coordinator.

## Product outcome

HOPI is one user-facing assistant that turns conversations into durable Goals, visible Work, and
bounded execution. The operator must be able to answer these questions without inspecting SQLite,
temporary worktrees, provider transcripts, or Coordinator processes:

- What outcome is this Goal trying to achieve?
- What Work is currently understood and why does it exist?
- What actually ran, with which provider/model/reasoning configuration?
- Did a Run finish, fail, crash, time out, or get interrupted?
- Was provider context reused or rotated?
- What source change was produced and from which base?
- Was that change integrated, archived, deployed, or otherwise delivered?
- What decision or external fact is still needed?

## Product topology

HOPI has three independent continuity planes:

```text
conversation: Thread -> Session Epochs
goal meaning: Goal -> Goal Document revisions -> visible Work
execution:    Work -> Run -> Report / ChangeSet -> Operation
```

These planes may reference one another but do not substitute for one another:

- a provider Session is not durable conversation truth;
- a Work stage is not evidence that a Run succeeded;
- a ChangeSet is not proof that the Goal is accepted or deployed;
- a Work count is not Goal progress.

## Durable concepts

| Concept | Owns | Does not own |
| --- | --- | --- |
| Project | Repo membership, permissions, Prepare/Preview, execution boundary | conversation history or one global execution queue |
| Thread | one user-visible conversation and its Epoch chain | Goal binding or execution state |
| Goal | one acceptable outcome, lifecycle, and current Goal Document | numeric progress or a mandatory task graph |
| Work | one operator-visible unit of currently understood work | a mandatory Generator/Reviewer pipeline |
| Run | one immutable, bounded execution assignment for a Work | Work meaning or a reusable settled Session |
| ChangeSet | immutable multi-Repo source delta and lineage | review, acceptance, integration, or deployment meaning |
| Attention | one unresolved user or external fact | a hidden Work stage or automatic pause rule |
| Operation | one typed, idempotent external side effect | arbitrary model-authored JSON execution |

Document Revision, Session Epoch, Artifact, Event, transcript, and runtime diagnostics are
inspectable infrastructure records. They need not be primary Board objects.

## Goal and Work

### Goal authority

Each Goal owns one current Markdown Goal Document containing the desired outcome, acceptance
meaning, current understanding, current state, open questions, and stable references. Headings are
writing conventions, not a parsed workflow schema.

After creation, one logical Goal Supervisor is the only semantic writer of that document. User
messages become durable directives or references. A Goal Document update uses revision
compare-and-swap so two concurrent judgments cannot silently overwrite one another.

Goal lifecycle remains deliberately small:

```text
active <-> paused
active | paused -> done | cancelled
done | cancelled -> active
```

`done` is an explicit semantic decision based on the current acceptance meaning and observed
facts. It is never derived from `completed Work / total Work`.

### Work remains a product concept

Work is retained because it gives the operator a stable planning and intervention surface. It is
created only when a unit of work is understood well enough to name and inspect. Unknown downstream
work remains prose in the Goal Document until evidence makes it actionable.

Existing Work kinds, IDs, Markdown bodies, dependency references, and Board lanes remain readable
during migration. Their meaning is narrowed:

- dependencies are optional ordering constraints, not a requirement to model a complete DAG;
- `Plan`, `Build`, `Review`, and `Done` are visible focus/lifecycle lanes;
- `Review` is optional and may be entered, skipped, or revisited;
- changing a lane does not itself schedule a provider role;
- cancelled Work is excluded from progress because numeric Work progress does not exist;
- a Goal may complete after the Supervisor explicitly settles or archives remaining Work, but it
  cannot complete while an active Run or required Operation is still executing.

During compatibility migration the stored `planning | engineering` kind and
`plan | generate | review | done | cancelled` stage may remain. They must stop selecting a fixed
responsibility in the scheduler. A later schema may simplify those enums only after UI and data
migration prove that doing so removes more complexity than it adds.

## Run and Session lifecycle

A Run is one execution attempt with immutable input:

```text
Work identity
instruction Markdown
source Event/directive and stable references
Goal Document revision
base ChangeSet or base Repo refs
workspace mode: none | read_only | isolated_write
requested execution profile
```

Its lifecycle is mechanical:

```text
queued -> running -> settled
queued ------------> settled
```

Settlement stores a separate termination fact:

```text
normal | cancelled | interrupted | crashed | timed_out
```

Semantic success, rejection, findings, and recommended next steps live in the Report. Runtime must
settle every exit path even when the model emits no terminal JSON or no final text. In that case it
generates a minimal factual Report from timing, exit status, diagnostics, transcript tail, and
workspace observations.

Every new Run starts a fresh provider Session. A still-running Run may rotate through Session
Epochs when context pressure or provider compatibility requires it:

```text
Run R1 -> Epoch 1 -> checkpoint/handoff -> Epoch 2
```

Epoch rotation preserves the Run ID and workspace. A settled Run is never resumed. Review feedback,
repair, or retry creates a new Run with explicit references to the previous Report and ChangeSet.

The runtime records requested and actual provider, model, reasoning effort, permission boundary,
Session/Epoch identity, timestamps, termination, exit code, diagnostics, transcript, artifacts,
and workspace observations. Actual execution facts take precedence over requested configuration.

## Review and execution profiles

Planning, implementation, investigation, reproduction, review, repair, and verification all use
the same Run mechanism. Natural-language instruction defines the purpose. `workspaceMode` defines
the machine-enforced source permission.

Existing `planner`, `generator`, and `reviewer` settings may remain temporarily as named model
profiles so operators do not lose configuration. They are not business roles and the scheduler
must not infer a mandatory workflow from them. The UI must state which profile was requested and
which execution configuration actually ran.

The Goal Supervisor decides whether evidence warrants an independent review. A Work may therefore
follow any evidence-backed path, including:

```text
Build -> Done
Build -> Review -> Done
Build -> Review -> Build -> Done
Plan -> Build
```

Those are choices, not one global state machine.

## Conversation and supervision

The existing Assistant panel and feed remain the user surface. Internally:

- every top-level message creates a Thread root;
- an explicit reply continues that Thread;
- Project/Goal page location contributes origin references, not permanent routing authority;
- sibling Threads do not share a provider Session;
- a Thread may discuss zero, one, or several Goals;
- long Threads rotate Session Epochs using a bounded handoff;
- an Attention reply retains exact Thread, Goal, and Attention references.

The user-side Assistant answers conversation and emits explicit Goal directives. A logical Goal
Supervisor reacts to Goal facts using a bounded packet and a fresh invocation. It may update the
Goal Document, create or adjust Work, start/cancel Runs, create/resolve Attention, propose an
Operation, or change Goal lifecycle. It never edits Project source directly.

The first migration may preserve the existing Feed HTTP contract and React stream components. The
storage and session boundary may change without forcing a simultaneous frontend rewrite.

## ChangeSet and Operation

An `isolated_write` Run freezes any surviving source delta into an immutable ChangeSet on every
termination path, including interruption and crash. At minimum each Repo entry records:

```text
producer Run
Repo ID
base commit
result commit or immutable patch
content hash
created time
```

A ChangeSet means only that a source delta exists. It does not mean reviewed, accepted, integrated,
or delivered.

Git ref movement, baseline integration, archive creation, pull requests, and deployment cross the
database boundary and therefore use typed Operations:

```text
proposed -> approved? -> executing -> succeeded | failed | cancelled
```

Each Operation kind owns a validated intent and result. Every Operation stores an idempotency key,
authorization facts, expected external state, observed result, timing, and recovery information.

Baseline integration compares every current Repo ref with the ChangeSet expected base. A valid
fast-forward preserves candidate ancestry. A conflict becomes an observed result for the
Supervisor; the runtime does not fabricate a merge policy or replace ancestry with a synthetic
tree-only commit.

ZIP, PR, deployment, and baseline integration block Goal completion only when the current Goal
acceptance meaning requires them.

## Deterministic kernel and model judgment

The runtime, not a model, enforces:

- append-only durable input and exact recipient/reference facts;
- Goal Document compare-and-swap and single-writer capability;
- idempotent tool and Operation effects;
- immutable Run input and terminal settlement;
- workspace permission, leases, capacity, timeout, and configured cost limits;
- content-addressed artifacts and immutable ChangeSets;
- expected-base checks for external state changes;
- process-group cleanup and managed-worktree ownership;
- bounded default Thread, Goal, and Run context.

Models decide meaning:

- what the user intends;
- what Work is currently useful;
- which Run instruction should execute next;
- whether review is warranted;
- whether evidence satisfies Work or Goal acceptance;
- whether an Attention is actually resolved;
- how to respond to a conflict or failed Operation.

Runtime limits and failures produce facts. They do not invent semantic recovery policy.

## Fact priority

When descriptions conflict:

```text
external observation and physical database/Git state
  > immutable ChangeSet / Artifact / Run / Operation result
  > current Goal and Work documents
  > Thread messages, old Reports, and transcripts
```

Physical facts cannot decide whether the operator's desired outcome is acceptable. Conversely,
prose cannot override a failed deployment or a Git ref that did not move.

## Product surface invariants

The migration preserves the current frontend structure:

- `/projects` Project home;
- `/projects/:projectId` scoped Assistant;
- `/projects/:projectId/board/:goalId` four-lane Work Board;
- `/projects/:projectId/docs/:goalId` three-pane document view;
- the current Layout, project/Goal switchers, Assistant drawer, card grid, Work detail modal, and
  document panes.

The content evolves without a layout rewrite:

- Goal headers show lifecycle and natural-language semantic status, never Work-count progress;
- Work cards remain real Work cards;
- Work detail presents its Run history;
- Run detail presents actual model configuration, Epoch/handoff, termination, Report, ChangeSet,
  artifacts, and a transcript audit entry;
- the Board may show optional Review but must not imply that it is mandatory;
- Assistant, Project, and Goal activity reuse the existing feed surface while Thread isolation is
  introduced behind it.

## Persistence and migration

This is an incremental migration, not a permanent compatibility architecture:

1. Start from the last Work-based implementation with its complete test suite.
2. Add new durable Run/Epoch/ChangeSet/Operation facts alongside existing Work documents.
3. Switch one writer and one reader at a time behind contract tests.
4. Migrate existing Home data once, with a verified backup and rollback path.
5. Stop writing the superseded Attempt/result fields.
6. Remove compatibility readers only after the new path and frontend have passed the take-home
   replay and restart tests.

Do not assign a persisted schema/epoch number until the migration spike determines whether any
already-created experimental database must be retained. One version number must never describe two
different layouts.

The clean-slate implementation that removed Work remains a reference source for Session Epoch,
Run settlement, ChangeSet, and Operation code. It is not the product model and is not switched into
production as a whole.

## Explicit non-goals

The MVP does not:

- model a complete Work DAG before evidence exists;
- require every Work to pass a Reviewer;
- infer Goal progress from Work counts;
- depend on model-authored terminal JSON for settlement;
- resume a settled Run or hide a retry inside an old Session;
- treat a provider Session or temporary worktree as unique truth;
- build an untyped arbitrary-JSON Operation executor;
- add full event sourcing or a vector database without measured need;
- rewrite the frontend layout as part of the backend migration;
- maintain indefinite dual writes between old and new execution records.

## Implementation order

1. Establish a green Work-based baseline and preserve the clean-slate workspace as reference.
2. Freeze this document and the evolution acceptance contract.
3. Add Run settlement and actual execution facts.
4. Add Session Epoch rotation without changing Run identity.
5. Separate scheduler mechanics from fixed responsibility selection.
6. Add ChangeSet lineage and typed Operations.
7. Introduce Thread isolation behind the existing feed contract.
8. Adapt the existing Board and detail surfaces.
9. Run migration, restart, multi-Repo, browser, and take-home replay gates.
10. Remove superseded fixed-pipeline code and compatibility storage.

Each step must leave the application startable and its previously accepted behavior testable. API,
storage, scheduler, and frontend are not switched simultaneously.

## Acceptance authority

[`mvp_evolution_acceptance.md`](./mvp_evolution_acceptance.md) defines the required regression
trajectories and implementation gates. Existing test cases remain useful historical coverage, but
they cannot require a fixed responsibility pipeline when they conflict with this document.
