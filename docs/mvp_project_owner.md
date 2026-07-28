# Project Owner And Attention

Status: authoritative MVP design
Last updated: 2026-07-26

This document owns the Project Assistant, wake-up, Attention, and operator-notification model. It
supersedes conflicting Reflection, Attention-target, notification-ownership, and Assistant-policy
sections in older MVP documents.

## Mental Model

Each Project has one logical Assistant. It is the final owner of the Project rather than a chat
frontend for another coordinator.

The Assistant:

- receives operator messages
- sees Project state, events, unresolved Attention, runtime evidence, and source paths
- can perform every Project operation available through the UI
- can create Work, change a nonterminal Work's dependencies, cancel it, or append a source-traced
  message to its canonical document
- supervises Goals and Work across the Project
- changes documents and execution state through ordinary validated tools
- communicates outcomes, material deviations, and requests for operator authority

Planner, Generator, and Reviewer remain specialist responsibility passes:

```text
Planner   -> interpret one Goal and maintain its sparse Work DAG
Generator -> implement one Engineering Work in its persistent lineage
Reviewer  -> independently verify that Engineering Work
Assistant -> own the Project outcome and correct exceptions across these passes
```

Assistant may perform incidental self-contained Project operations and publish results that have
already been accepted. Those direct effects remain Assistant-owned. They do not acquire managed
implementation, Evidence, independent review, retry, recovery, or supervision by existing outside a
Work. Engineering Work is the responsibility surface for those properties, and an already settled
contract may begin there without a Planning pass. Planning exists to shape or revise an unsettled
contract, not as a mandatory prelude to every Engineering Work.

Generator owns the complete accepted Engineering Work in writable Project roots, including every
contract-required durable deliverable and the execution needed to materialize it. Reviewer judges
whether that candidate is already complete. Reviewer may independently reproduce behavior and
retain review evidence, but it does not become the sole producer of a missing Work deliverable.
A missing or defective contract-required deliverable is a Reviewer `reject`; missing authority,
an operator decision, or an external action outside both responsibility boundaries is Attention.

Reconciler schedules valid ready work and wakes the Assistant. It does not interpret failures,
select recovery strategies, or decide what the operator should do.

## Goal Authority

The operator's original Goal statement is immutable after creation. It is permanent source evidence,
not a mutable contract.

Later understanding lives in Goal-local design documents, accepted Inputs, Work, and Evidence.
Lifecycle, priority, and scheduling controls remain mutable facts. Reopening a Goal changes lifecycle
only; it does not revise the original statement.

## One Persistent Assistant Per Project

The product exposes one Assistant identity. The runtime keeps one provider-native persistent session
per Project so several Projects can advance independently without sharing an unbounded conversation.
Changing vendor, model, or incompatible execution capability starts a compatible physical session
without creating another product actor.

The Assistant has the Project's configured execution access. A provider transport may still enforce
its physical boundary, but HOPI adds no smaller semantic command allowlist for the Assistant.
Unrestricted access changes available capability, not responsibility ownership.

## Wake-Up

Reflection is not an Agent, a role, or a model invocation. A Project event is only a reason to wake
the same Project Assistant.

On a wake, one Assistant invocation receives:

- the current operator message, when one exists
- Project events newer than its durable observed cursor
- every unresolved Project Attention
- compact derived Project health, current Goal-design excerpts, recent Attempt artifact diagnostics,
  and canonical source paths
- the ordinary Project tool surface

The invocation may respond, act, update Attention, or finish silently. These are model judgments, not
workflow branches.

Design freshness is not another state machine or a fixed post-Run workflow. Material Run settlement
already wakes the Assistant. The supplied state places the latest observed result and preservation
diagnostics beside the current design excerpts and their canonical paths. `hopi_write_design` changes
those same documents. This gives the Project owner enough observable fact and capability to reconcile
new evidence with stale design without a semantic diff rule, mandatory design-review pass, or a new
Agent role.

Wake-up is edge-triggered:

- new operator input wakes the Assistant
- every published Reviewer `reject` is a material Project event
- settled failure, Attention, Goal completion or cancellation, Project availability changes, and
  explicit runtime liveness recovery are material Project events
- an Assistant-owned Attention may request one future observation through `revisitAt`

Transient logs, command output, running progress, and the ordinary Generator-to-Reviewer handoff do
not wake the Assistant by themselves. Material events are derived from durable Project and Attempt
truth, so a process restart can recover an unobserved event without a second event store.

Wake-up does not gate responsibility scheduling. A Reviewer `reject` returns the Work to `generate`,
and the next Generator may start while the Project Assistant observes the rejection and current
aggregate state. Concurrent observation does not transfer execution ownership: the active
responsibility Attempt owns that Work's execution and Evidence, while Assistant shell effects remain
outside the Attempt even when they persist on the host or a remote system; they have no Work Evidence,
review, retry, recovery, or supervision and cannot settle the Attempt. The Assistant may finish
silently. If it changes the
affected Work or Goal, the ordinary Assistant effect barrier invalidates or interrupts execution
based on the superseded authority; the Assistant is neither another approval stage nor an implicit
replacement for Generator or Reviewer.

Events coalesce while an invocation is running. Advancing the observed cursor and persisting any
Assistant effects is crash-safe. An interrupted invocation does not acknowledge unseen events.
Effects produced by the current Assistant turn are acknowledged with that turn and do not create a
second state-change wake. A different operator or runtime event that arrives while the turn is active
remains newer than the turn and causes the next wake. An unresolved Attention alone is not a
repeating event. When the condition depends on facts outside HOPI state, Assistant may record one
future `revisitAt`; HOPI derives one deterministic internal Inbox event from the exact Attention
reference and timestamp. Restart and repeated reconciliation observe the same event identity.

A staged Attention transfer belongs to one Assistant invocation. It becomes user ownership only
with that invocation's durable non-empty final reply. Failure, interruption, or restart clears the
uncommitted staging before another invocation observes the event, so a rejected handoff cannot turn
subsequent retries into a transfer loop.

A settled failure wake carries the exact Work recovery reference derived from the persisted Attempt.
That reference is not another document or workflow state. It records which failed execution currently
belongs to the Assistant. The internal event is acknowledged only after that Work has a queued or
running successor, its canonical authority changes, it becomes terminal, or an open Attention names
that exact Work as its target. Goal-level Attention does not identify a successor for one failed
Work. Planning and Engineering Work can both become terminal through the same explicit cancellation
capability. The Assistant remains free to choose the consequence; HOPI only prevents a durable
failure from disappearing because a conversation turn ended without a durable successor. Wake
protocol revisions invalidate old observation cursors once, so restart recovery also revisits
failures acknowledged under an older responsibility contract.

Evidence and Attention rationale retain historical observations rather than live environment state.
External sessions and services are current only when observed through the runtime capabilities
available to the active role.

An existing turn for that conversation already carries the current Attention set, so it suppresses a
redundant revisit. A running Work Attempt also supplies its own later settlement event, so Assistant
does not need to poll delegated progress.

New operator input interrupts an internal Assistant invocation so the persistent session can receive
the new turn. Interruption does not itself create or modify Attention. The Assistant may persist
unfinished work when that is useful.

If the Assistant transport cannot run, HOPI records and presents that operational failure directly.
It does not rely on the unavailable Assistant to report its own outage.

## Attention

Attention is the Assistant's durable Project todo set. It is not a workflow gate, queue protocol, or
separate user channel.

An Attention document owns only:

```yaml
id: A-...
createdAt: ...
updatedAt: ...
resolvedAt: null
revisitAt: null
refs:
  - project:P-...
body: |
  Natural-language fact, question, or unfinished responsibility.
```

`refs` are canonical identity and traceability links, not session-routing targets. Responsibility is
always the Project Assistant, and the owning Project selects that Assistant's persistent
conversation. A Project Attention keeps its canonical Home reference when copied into an Inbox
turn; routing it through the owning Project does not rewrite that reference. There is no owner,
target, kind, priority, waiting, working, notification, recurring retry, or operator-request state.
`revisitAt` is only a one-shot observation time; it neither changes ownership nor asserts progress.

The Assistant may create, edit, merge, or resolve Attention. An operator message is not
automatically converted into Attention, and an operator reply never automatically resolves one.
Attention does not block unrelated Work or Preview. Historical resolved documents remain auditable.

The model-facing Attention tool operates only on this Project-level set. Goal, Work, Attempt, and
source relationships are expressed through `refs`; adding a Goal ID never selects another Attention
store. Historical Goal-local Attention documents may remain as compatibility evidence or
kernel-owned completion records, but they are not a second Assistant todo surface.

Attention tool results report the resulting fact:

```json
{ "attentionId": "A-...", "resolved": true }
```

Create returns `resolved: false`; update returns the document's resulting resolved fact; resolve,
including an idempotent repeated resolve, returns `resolved: true`. Missing or cross-Project IDs are
errors rather than `resolved: false`.

All unresolved Attention is supplied together on each wake. The model may consider their
relationships and current Project facts rather than consuming them as a strict FIFO.

Finishing an Assistant turn publishes its effects and optional reply. Unresolved Attention preserves
unfinished responsibility but does not by itself create another turn. A material state edge, an
active Attempt's settlement, or an explicitly selected `revisitAt` wakes the same Project
conversation. Resolving the Attention makes any unconsumed revisit irrelevant.

The Assistant provider process tree has the same turn lifetime. A shell child still running when the
turn ends is terminated with that turn; it is not a background job. A Work Attempt has an independent
RoleRunner process lifetime, and its settlement changes Project state and therefore produces the
ordinary supervision wake. `continue` durably queues that Work's next current-responsibility Attempt
without changing Work identity. `revisitAt` reuses the Coordinator's deadline timer and Inbox rather
than adding an Assistant job queue or recurring waiting state.

A direct Engineering Work may belong to another Project. Its immutable `assistantDispatch` points
to the source Inbox event, whose Project context identifies the conversation that delegated it and
whose Attention references preserve any unresolved originating condition. HOPI derives a compact
cross-Project delegation view from those existing facts. While the delegated Work has an active Run,
that Run is visible to the source Project Assistant and supplies the next ordinary observation edge.
When the delegated Work settles, the derived source-Project state changes and wakes that same
conversation. The Assistant then judges the original condition from current evidence; settlement
does not mechanically resolve Attention, retry Work, or declare the external repair sufficient.
This adds no cross-Project dependency document, callback record, or workflow status.

## Needs You

Needs You is a projection of canonical Attention ownership, not a reply-text protocol. The Assistant
calls `transfer_attention_to_user` with one or more open Attention references, then writes the
complete question as ordinary final text. The pending Inbox event durably records the selected
references and optional structured decision prompt before publication. Once its non-empty reply is
handled, Coordinator stores that exact event reference in each Attention's `operatorRequest` and
clears `revisitAt`.

The request event may carry a vendor-neutral `decisionPrompt` with bounded questions, mutually
exclusive options, optional recommendation, optional supporting detail, and free-text Other. This
data belongs to the immutable request event; it is never reconstructed from Markdown. The UI submits
the selected answer as one ordinary Inbox reply to the same event and Attention references.

- an open Attention with non-null `operatorRequest` renders as `Needs you`
- the header count is the number of distinct open Attention records with that pointer
- the referenced event is projected into the Attention's owning conversation
- `replyTo` preserves provenance; the canonical Attention references identify returned ownership
- the exact reply clears `operatorRequest` and wakes Assistant without resolving the Attention
- resolving the Attention removes the decoration from its historical request
- a successful transfer clears any pending Assistant revisit because the exact reply supplies the
  next observation

New messages contain no interpreted control markup. Legacy `<NeedsYou>` and `<DecisionPrompt>`
content is read only by the one-time ownership migration and stripped for historical display.
Published message text remains immutable.

The Assistant's ordinary final text is already public communication. There is no separate
`inform`, `notify`, or delivery decision for in-app replies. Optional external delivery mirrors an
already persisted public message and never becomes semantic authority.

## Deterministic Kernel

Deterministic validation remains only where a malformed value would corrupt durable or physical
state:

- identity and canonical path validation
- atomic document writes
- immutable Goal-source enforcement
- acyclic Work dependencies
- process ownership, interruption, and restart recovery
- Git/worktree publication integrity
- provider transcript and event-cursor durability

The kernel does not classify semantic failures, prescribe retry counts, require fixed result prose,
or reject an otherwise valid Agent judgment because a parallel revision changed.

Failure to prepare a task worktree is recorded as a settled operational Attempt against the current
Work assignment. The unchanged Work is not dispatched in a loop; the resulting state change wakes
the Assistant. No Attention is synthesized by Coordinator. If responsibility must survive that
Assistant turn, the Assistant may create or update Project Attention; doing so records a todo and
does not change Work readiness.

## Work Intervention

The Assistant changes Work through the same canonical Work document used by responsibility passes.
Changing dependencies replaces the nonterminal Engineering Work's `dependsOn` set and is accepted
only when the resulting graph is valid and acyclic.

Continuing with a message appends a timestamped, source-traced Project Owner note to that document.
If an Attempt is active, HOPI interrupts it and schedules the changed Work in the same persistent
responsibility lineage. This is transport recovery, not a new queue or workflow state: the resumed
Agent receives the current Work document and its prior provider session. Project Owner message
blocks do not change the responsibility-session compatibility fingerprint; ordinary Work contract
or dependency changes still do.

## Prompt Contract

Prompts describe only:

- the responsibility and current assignment
- current observable facts and canonical source paths
- available capabilities
- the real effects of using those capabilities

Prompts do not prescribe recovery playbooks, attempt thresholds, recommended choices, step order, or
structured final output. Documents and tools carry authority; model prose is not parsed into hidden
workflow state.
