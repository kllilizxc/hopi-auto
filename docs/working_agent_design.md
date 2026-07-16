# HOPI Working Agent Design

Status: forward product and architecture authority
Last updated: 2026-07-16

This document defines the direction from the implemented Coding Agent MVP toward a general
Working Agent. New product and architecture decisions follow this document. The `mvp_*.md`
documents remain the authority for behavior that is still implemented but not yet migrated.

The design intentionally specifies semantic ownership and hard execution boundaries, not a fixed
workflow. Detailed schemas and state charts should be updated only as each slice is implemented.

## Product Goal

HOPI is a Working Agent for a one-person company.

The operator talks to one workspace-wide Assistant about whatever arrived: a feature request, an
incident, a review request, a meeting follow-up, a message that needs investigation, or an idea that
should be remembered. The Assistant uses the operator's Projects, tools, prior Evidence, and Skills
to answer immediately when it can and to keep longer work moving when it cannot.

The intended loop is:

```text
Input -> understand current context -> answer inline or create/update Goal
      -> maintain an incremental Work DAG -> execute ready Work
      -> inspect Result and Evidence -> revise the DAG or complete the Goal
      -> notify the operator only with an outcome, a real decision, or a hard blocker
      -> silently capture reusable knowledge

daily clock -> silently consolidate and improve accumulated knowledge and Skills
```

For software delivery, the DAG may include implementation, tests, local E2E, dev release, dev E2E,
main release, and production E2E. Those are possible Work and Effects, not a built-in lifecycle.

The first useful version accepts Input through the Assistant conversation. Slack and email can be
added later as connectors. WeChat is deferred. A cloud relay and a 24/7 availability guarantee are
not required; a local Mac process catches up after wake or restart.

## Design Principles

### 1. Trust model judgment; constrain effects

The model decides how to understand work, whether to answer inline, how to decompose a Goal, what
verification is useful, and whether the available Evidence satisfies the outcome.

The Kernel does not encode a Planner-Generator-Reviewer workflow, a software-only state machine,
keyword urgency rules, or a workflow DSL. It deterministically owns only the boundaries where a
model decision is insufficient:

- durable identity and publication
- concurrency, leases, and process recovery
- capability enforcement and resource isolation
- idempotent Effects and receipts
- semantic guards against stale Results
- immutable Run records and Evidence provenance

More capable models should improve HOPI without requiring a new workflow profile.

### 2. Keep the product model small

The operator needs only three durable product concepts:

1. **Assistant**: the single conversation and intent surface.
2. **Project**: durable context, resources, capabilities, preferences, and Goals for an area of work.
3. **Goal**: an outcome HOPI continues advancing until done, paused, cancelled, or genuinely blocked.

Input, Work, Run, Result, Evidence, Attention, Effect, Capture, Daydream, and Skill are internal
mechanisms. They may be visible for inspection and debugging but do not become separate workflow
products.

### 3. Documents are durable truth

Contracts, designs, Inputs, Work, dependencies, Results, Evidence, Attention, Effect receipts,
knowledge, and Skills are durable files. Runtime databases may index those files but are rebuildable.
Raw model sessions, process state, leases, and UI projections are disposable runtime data.

Each fact has one owner. Model context is a bounded projection of current documents, never a second
authority.

### 4. Every UI capability is also an Assistant capability

The UI is a convenient projection, not an exclusive control plane. Any operation the operator can
perform through HOPI's UI can also be requested through the Assistant, including creating a Project,
linking resources, changing Project settings, controlling Goals, resolving Attention, configuring
Preview, and executing authorized Effects.

Both paths call the same domain commands, validation, capability checks, and publication primitive.
The Assistant does not automate the UI to reproduce a domain operation.

### 5. Self-evolution is part of the work loop

A completed task is not fully consumed until its reusable knowledge has been considered. Capture and
Daydream are silent background work, not an approval inbox. They directly improve Project knowledge
and MySkills, validate the resulting files, and publish them without asking the operator to curate
candidates.

Knowledge quality is controlled by better routing, evidence selection, consolidation, validation,
and pruning rather than by moving every decision back to the user.

## Product Mental Model

### Assistant

There is one logical Speaking Assistant per Home and one persistent vendor-qualified session for it.
Public turns and hidden internal turns resume that same session and are serialized. An internal turn
is not a new Assistant session. The UI renders public replies plus explicit `notify_user` output; it
does not render internal prompts, reasoning, or tool traffic.

If the physical vendor session is lost, HOPI rebuilds it from durable public history and current
documents. This is a new physical session but the same logical Assistant conversation.

The Assistant may complete short, safe work inside the conversation turn. It creates or updates a
Goal when work must survive the turn, run asynchronously, coordinate multiple resources, or await a
later event. This is model judgment, not a duration or keyword threshold. Useful inline work may
also trigger Capture.

### Project

A Project is not synonymous with a Git repository. Every Project owns a HOPI-managed hidden control
repository for its canonical documents, so a non-code Project is valid and a new Project may start
with no external resource.

A Project may later link any number of resources, including:

- source repositories
- local directories and documents
- services and environments
- log and database access
- connector accounts and channels
- Preview and delivery targets

Repositories are ordinary resources. A Project no longer requires one primary repository to own
its control documents or one fixed `hopi/release` branch.

### Goal

A Goal belongs to exactly one Project. It owns a bounded package containing its outcome contract,
design when useful, accepted Inputs, sparse Work DAG, Results, Evidence, Attention, and Effect
references.

Cross-Project knowledge may be read by reference. Cross-Project execution does not create one shared
DAG: distinct outcomes become Goals in their owning Projects and may refer to one another's durable
Evidence.

The Speaking Assistant owns Goal-level semantic judgment among model sessions: it interprets new
Input, maintains the design and Work DAG, accepts or rejects Work Results, and decides when the Goal
is complete. Operator UI commands may still pause, resume, cancel, or otherwise control the Goal
through the same domain layer.

### Work

Work is a durable, independently executable node in a Goal's sparse DAG. It is not a Planner,
Generator, Reviewer, prompt template, or model session.

A Work document needs only the durable facts that survive execution:

- stable identity and owning Goal
- a natural-language title and body containing objective, context, and acceptance guidance
- `dependsOn`
- required resource references and capability subset when known before dispatch
- optional `notBefore`
- lifecycle: `open | done | cancelled`
- references to accepted Results and Evidence

`planning`, `generate`, and `review` are removed as Work kinds or stages. Running, queued, retrying,
waiting for semantic acceptance, and blocked are derived from Runs, Results, dependencies, timing,
Attention, and leases rather than stored as additional Work lifecycle states.

The Assistant creates Work only when it is independently schedulable, independently verifiable, or
must outlive one model turn. The entire DAG need not exist up front.

## Architecture

```text
                                      +--------------------------+
User conversation ------------------>| persistent Speaking      |
hidden semantic wake --------------->| Assistant session        |
                                      +------------+-------------+
                                                   |
                    shared domain commands         |
UI -----------------------------------------------+
                                                   v
                                      Project / Goal documents
                                      sparse Work DAG
                                                   |
                                      deterministic readiness
                                                   v
                                      disposable generic Work Run
                                                   |
                                             Result + Evidence
                                                   |
                                      hidden Speaking wake

ordinary semantic changes -> disposable read-only Reflection
                                      | optional handoff
                                      +-> hidden Speaking wake

terminal Work / useful failure / useful inline turn -> disposable Capture
daily local clock + accumulated deltas              -> disposable Daydream
```

Among model sessions, only Speaking may mutate Project, Goal, Work DAG, and Goal completion truth.
Work Runs execute assignments and submit Results. Reflection observes and hands off. Capture and
Daydream mutate only knowledge and Skill roots. The Kernel performs validated publication and
authorized Effects without making semantic product decisions.

## Speaking and Reflection

### Public and internal turns

All Speaking turns use one durable FIFO Inbox and the same logical session. Public user Input has
priority over pending internal work. Turns are never concurrent within the session.

An internal turn carries a reason to inspect durable truth, not a stale copy of that truth. Multiple
events for one Goal may coalesce into one pending wake. New facts are published before the wake, so
coalescing loses no information. If facts arrive while Speaking is reconciling, the Goal remains
semantically dirty and receives another wake after the turn.

Semantic dirtiness is derived from durable facts such as unconsumed Input, an unconsumed Work
Result, or an active Goal with no remaining Work and no completion decision. It is not another
operator-visible Goal state.

### Direct semantic wakes

Events that always require semantic ownership bypass Reflection and enqueue a hidden Speaking turn:

- new accepted Input for an active Goal
- a new Work Result and its Evidence
- an active Goal with no nonterminal Work and no final completion decision

This keeps Reflection from becoming a second scheduler or mutation authority.

### Reflection

Reflection remains disposable and read-only. It receives a bounded digest of ordinary semantic
changes, anomalies, or opportunities and may:

- do nothing
- coalesce or defer another observation
- hand a concise brief to Speaking

Reflection has read-state and handoff capabilities only. A handoff creates a durable hidden Inbox
event that the persistent Speaking session handles. Reflection never edits the Goal, DAG, Skills, or
operator-visible conversation.

### Reconciliation guard and recovery

While an internal Speaking turn is reconciling a Goal, the Kernel prevents new Work from being
admitted for that Goal. Individual domain tool calls are atomic and idempotent; there is no giant
multi-purpose `reconcile_goal` transaction.

If Speaking or the process stops after some calls, published changes remain valid, the guard expires,
and durable unconsumed facts cause a fresh turn to reread current truth and finish or correct the
decision. Input arriving during the turn remains unconsumed until the current or following turn
adopts it.

## Assistant Domain Capabilities

The exact transport schema may evolve, but Speaking needs small tools aligned to one semantic
operation each:

- read Home, Project, Goal, Work, Result, Evidence, Attention, and Effect state
- create a Project and update its resources, capabilities, preferences, and Preview configuration
- create and control a Goal
- update the Goal contract
- write or revise the Goal design
- update the Work DAG
- complete the Goal
- request or resolve Attention within operator authority
- execute an authorized Effect
- notify the operator from an internal turn

The fixed `request_planning` operation is removed. Creating a Goal does not mechanically create
Planning Work.

`complete_goal` records Speaking's semantic assessment and the supporting Evidence. Publication
requires no remaining open Work, no unconsumed Result, and no unresolved Goal-wide Attention. The
Kernel validates those structural preconditions; Speaking judges whether the outcome is actually
satisfied.

### Atomic Work DAG updates

`update_work_dag` applies a batch of explicit changes so the final graph can be validated and
published atomically:

```ts
update_work_dag({
  changes: [
    {
      action: "create",
      workId: "W-api",
      title: "Implement notification API",
      body: "Implement the accepted API contract and provide focused test evidence.",
      dependsOn: [],
      resources: ["repo:api"]
    },
    {
      action: "revise",
      workId: "W-web",
      dependsOn: ["W-api"]
    }
  ]
})
```

Supported semantic actions are `create`, `revise`, `complete`, and `cancel`. `revise.dependsOn` is a
complete replacement, not an add/remove patch. Completing, revising after a returned Result, or
cancelling Work consumes the referenced Result when applicable.

The Kernel validates the final batch:

- Work IDs are stable and unique in the Goal
- all dependency references exist and the graph is acyclic
- terminal Work is immutable
- completing Work cites a produced Result and its Evidence; Speaking judges sufficiency
- no open Work depends on cancelled Work after publication
- resources and requested capabilities belong to the owning Project
- the whole batch publishes or none of it does

These are integrity constraints, not a workflow policy.

## Generic Work Execution

### Work Run

A ready Work node launches a disposable generic executor session. Its assignment begins with the
Work body, followed by exact canonical source paths, relevant Project guidance, selected Skills,
dependency Evidence, resource locations, and granted tools.

The executor decides how to perform and verify that assignment within its scope. It may edit code,
inspect logs, operate a browser, review a change, run tests, or use a connector. HOPI does not first
classify it into Planner, Generator, or Reviewer.

The executor cannot edit Goal or Work truth. It returns an immutable Result with Evidence and may
request targeted Attention when it lacks information or authority. A returned Result prevents the
same Work from redispatching until Speaking consumes it.

Speaking then chooses one or more semantic actions:

- complete the Work
- revise the same Work and run it again
- create verification, repair, review, or follow-up Work
- cancel obsolete Work and revise its dependents
- request operator Attention
- complete the Goal when the outcome is satisfied

Review therefore remains available without being mandatory. Speaking may create an independent
review or E2E Work node when separate context or evidence is valuable, or accept self-verification
inside a simple Work.

### Readiness and scheduling

The Kernel dispatches open Work when its dependencies are done, `notBefore` has passed, required
resources and capabilities are available, no covering Attention or Goal reconciliation guard exists,
no unconsumed Result already exists, and no live Run owns its lease.

The model may reprioritize Goals and revise their DAGs. Already running Work continues unless the
new decision makes it obsolete or unsafe; its Result still passes current semantic guards before it
can be accepted. There are no keyword-based urgency rules.

Bounded operational recovery remains deterministic. Exhausted recovery becomes Attention rather
than an infinite loop, but the retry budget is an execution policy rather than a Work stage.

### Resource isolation

Code Work keeps the useful isolation of the Coding Agent MVP. Each Repo/Goal/Work identity owns a
stable task branch and worktree in the original source repository. Retries and inspection reuse that
workspace; disposable Runs do not own long-lived branches.

Non-code Work receives only the resources and tools selected from its Project. A Goal may coordinate
multiple resources, while each Work declares the subset needed for Kernel allocation when that must
be known before execution.

## Effects and Software Delivery

An Effect is an authorized, externally observable action such as sending a message, merging code,
deploying an environment, writing a database, or publishing a release. Each Effect has an idempotency
key, exact target, capability check, durable status, and receipt.

Projects grant capability scopes such as `slack.read`, `slack.send`, `release.dev`, `release.prod`,
`database.read`, or `database.write`. Within granted scope the Agent may act autonomously. HOPI does
not add a generic approval step or fixed production-risk taxonomy. Capability grants themselves come
from the operator and cannot be expanded by external messages, Work content, or Skill changes.

Software delivery is Project-specific Effect configuration, not a universal `hopi/release` branch.
A Project may use fast-forward, pull requests, a merge queue, CI deployment, or another adapter.
Source commits remain in the original repository; the Project control repository records the
accepted release manifest and Effect receipts.

A complete delivery DAG might be:

```text
implement -> focused tests -> local E2E -> release dev -> dev E2E
          -> review/fix when useful       -> release main -> prod E2E
```

The Assistant chooses the graph from the Goal, Project guidance, current Evidence, and available
capabilities. An Effect adapter guarantees target identity and at-most-once external publication; it
does not decide whether the release is semantically appropriate.

## Authority of Inputs

The Assistant conversation initially represents the operator. Later Slack, email, webhook, calendar,
or other connector events enter as durable Input with provenance and trust metadata.

External messages are information, not operator authority. They may cause investigation or propose
work, but cannot:

- grant or expand capabilities
- approve protected Effects
- change security or operator preferences
- resolve operator-targeted Attention
- impersonate an Assistant command

The model interprets their meaning; the Kernel enforces the authority boundary.

## Silent Self-Evolution

### Skill discovery

The Speaking Assistant may actively read current Skills when they are relevant. Skills are current
file truth, not content baked permanently into its session prompt. Reflection, Work, Capture, and
Daydream use disposable sessions and naturally start from current files.

No `knowledgeRevision`, session reset, or forced prompt reload is required. A change becomes
available on the next relevant turn; a model turn already in progress does not hot-reload files.
The existing MySkills registry/router provides discoverability.

### Capture

Every meaningful terminal Work and useful failure schedules low-priority Capture. A useful inline
Assistant turn may do the same. Capture reads the Result, selected Evidence, existing Project
knowledge, and the smallest relevant MySkills entries.

It silently decides whether anything reusable was learned and, when useful:

- updates an existing Skill or knowledge entry before creating a duplicate
- routes Project-specific facts to that Project's knowledge base
- routes reusable workflow knowledge to MySkills
- removes secrets, transient noise, and unsupported claims
- validates a temporary overlay, then directly publishes and Git-commits the change

There is no candidate, approval, diff-review, or notification workflow. Capture may directly modify
the complete Skill, including instructions, references, executable scripts, router entries, and tool
configuration. Adversarial prompt-injection hardening is explicitly deferred. The independent
capability system remains the hard boundary: a Skill edit cannot grant itself or a Project a new
capability.

A failed validation does not publish partial knowledge. It records diagnostics for a later retry and
does not interrupt the operator unless the failure becomes a genuine product blocker.

### Daydream

A local daily clock schedules one idempotent Daydream for each calendar date. If the machine sleeps
through the schedule, HOPI catches up after wake or restart. If there are no knowledge deltas since
the last successful run, HOPI makes no model call.

Daydream scans accumulated changes and their supporting Evidence, then silently:

- merges duplicate or overlapping Skills
- moves facts to the correct Project or reusable scope
- promotes recurring patterns and demotes stale specifics
- prunes contradictions, obsolete guidance, and noise
- improves routing and discoverability
- validates tests or dry runs where available
- directly publishes and Git-commits accepted changes

Capture and Daydream do not recursively capture their own maintenance in the same loop. Their
published changes may be considered by a later Daydream when there is a genuine new delta.

## UI

The UI keeps the three-concept product model:

1. **Assistant** shows the latest useful outcome, questions that truly require the operator, and a
   compact activity trail.
2. **Project** shows durable context, linked resources, capability grants, settings, Preview, and
   Goals.
3. **Goal** shows outcome, current status, and a DAG/Kanban projection of Work with expandable Runs,
   Results, and Evidence for diagnosis.

Internal Speaking turns are hidden. Recoverable retries, Reflection, Capture, and Daydream stay in
activity and diagnostics rather than becoming chat noise. Only `notify_user` publishes speech from
an internal turn.

The UI may use native controls such as a file chooser to acquire a local path, but the resulting
domain operation must also be expressible through Assistant tools when the path or resource identity
is known.

## Recovery and Invariants

The local daemon may stop at any instruction or process boundary. Recovery follows durable truth,
not remembered callbacks.

Core invariants are:

- one logical persistent Speaking session exists per Home
- public and internal Speaking turns are serialized; public Input has priority
- among model sessions, only Speaking mutates Project/Goal/Work semantic truth
- Reflection and Work Runs cannot mutate the DAG or mark a Goal complete
- every Goal belongs to exactly one Project
- every Work belongs to exactly one Goal and the final DAG is acyclic
- terminal Work is immutable and completed Work cites accepted Evidence
- one unconsumed Result prevents duplicate redispatch of its Work
- stale Results may remain Evidence but cannot advance current truth
- code Work retains stable original-Repo worktrees across disposable Runs
- external Effects require a granted capability, idempotency key, exact target, and durable receipt
- external Input and Skill changes cannot expand capability grants
- Capture and Daydream publication is atomic and recoverable
- durable facts survive coalesced or lost wake signals and are rediscovered after restart
- only explicit Speaking output becomes an operator-visible internal notification

A single publication coordinator remains the simplest implementation. Model calls, tests, and
isolated Work may run in parallel; final canonical publication and Effect receipt transitions are
serialized.

## Migration from the Coding Agent MVP

The current implementation is a valid baseline, not a constraint on the target model. Migration
should preserve durable evidence and worktree safety while deleting fixed workflow concepts.

### Slice 1: general Project foundation

- give every Project a managed control repository
- make source repositories optional resources
- move canonical Goal documents out of the primary source-repository assumption
- add Assistant tools for every existing UI mutation, including Project creation

### Slice 2: Speaking-owned dynamic execution

- add hidden deterministic Speaking wakes for Input, Results, and completion assessment
- add `update_goal`, `write_goal_design`, `update_work_dag`, and `complete_goal`
- replace Planning Work and Planner with Speaking reconciliation
- replace Engineering stages and Generator/Reviewer selection with generic Work Runs
- preserve stable code worktrees, Evidence, semantic guards, and process recovery

### Slice 3: close the self-evolution loop

- trigger silent Capture from meaningful Work, failures, and useful inline turns
- connect Project knowledge and the existing MySkills router
- add daily idempotent Daydream with catch-up and no-delta suppression
- validate and directly publish knowledge and complete Skill changes

This slice is part of the Working Agent MVP, not optional polish.

### Slice 4: general Effects and software delivery

- replace the fixed local delivery projection with Project-specific Effect adapters
- retain original-Repo task commits and record accepted release manifests in the control repository
- express test, E2E, release, and production verification as dynamic Work and Effects

### Slice 5: external Inputs

- add Slack or email using the durable Input path and trust boundary
- preserve the Assistant conversation as the operator authority
- defer WeChat and cloud-relay availability until the local loop is proven

Each slice must leave one coherent authority model. Compatibility adapters may read old documents
during migration, but new and old schedulers must not concurrently own the same Goal.

## Acceptance Scenarios

### Create a non-code Project

The operator asks the Assistant to create a Project for hiring follow-ups. HOPI creates the managed
control repository without requiring a source Repo. The operator later links documents and an email
account through either the Assistant or UI using the same domain commands.

### Handle an interrupting engineering request

While other Goals are active, the operator pastes a bug report. Speaking reads the relevant Project
knowledge, creates a Goal, and creates only the investigation Work it can currently justify. The
executor inspects code and logs and returns Evidence. Speaking revises the DAG to add a fix and
verification. Existing unrelated Work continues unless reprioritization makes it unsafe or obsolete.

### Absorb new Input during execution

New requirements arrive while code Work is running. The Input is published durably and wakes
Speaking. The current Result cannot advance state until it passes the new semantic truth. Speaking
may accept it, revise the same Work, or cancel and replace it without losing provenance.

### Dynamically review and release code

Implementation Evidence leads Speaking to create local E2E Work. After it succeeds, Speaking invokes
an authorized dev-release Effect and creates dev E2E Work. Independent review is added only when
useful. Main release and production verification occur only when their Project capabilities exist.

### Recover concurrent Results

Several Work Runs finish close together. Their Results and Evidence publish before a coalesced hidden
wake. Speaking rereads current Goal truth, applies one or more atomic DAG batches, and receives
another wake if new facts arrived during the turn. No Result is lost or dispatched twice.

### Evolve knowledge silently

A completed incident produces a reusable diagnostic sequence. Capture updates the existing Skill,
validates it, and commits it without notifying the operator. A later Work Run discovers the new Skill.
At the next daily Daydream, overlapping guidance is merged and routing is improved. Restarting the
Mac before either job completes causes durable catch-up, not lost learning.

### Preserve UI/Assistant parity

Creating a Project, linking a Repo, pausing a Goal, resolving Attention, or changing Preview through
the UI and through the Assistant reaches the same domain validation and produces equivalent durable
truth.

## Explicit Non-Goals

- a workflow editor, workflow DSL, or arbitrary configured pass graph
- mandatory Planner, Generator, Reviewer, or universal review stages
- requiring a source repository or primary repository for every Project
- one fixed release branch or delivery strategy for every Project
- a candidate approval inbox for captured knowledge
- session resets or knowledge revision counters for Skill updates
- Slack or WeChat as a prerequisite for the first vertical slice
- 24/7 cloud availability in the local-first version
- adversarial prompt-injection hardening for direct Skill self-modification
- a generic per-operation approval matrix inside already granted capability scope

## Simplification Check

This design removes rather than generalizes the Coding Agent's fixed workflow:

- Planning Work becomes a hidden Speaking reconciliation turn, not another durable Work type.
- Planner becomes part of the persistent Speaking Assistant's semantic responsibility.
- Generator becomes a generic disposable Work executor with assignment-specific context and tools.
- Reviewer becomes optional verification Work chosen by the model rather than a mandatory stage.
- Repository ownership becomes one kind of Project resource rather than the definition of Project.
- Release becomes an Effect rather than a built-in branch transition.
- Capture and Daydream directly maintain current Skill files rather than creating candidate states.
- Skill freshness comes from reading current files, not session invalidation machinery.

The remaining deterministic rules protect identity, integrity, authority, recoverability, and
external effects. Everything else is left to current model judgment and can improve with it.
