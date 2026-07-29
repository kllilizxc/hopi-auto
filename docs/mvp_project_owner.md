# Project Owner And Attention

Status: authoritative MVP design
Last updated: 2026-07-28

This document owns the Project Assistant, wake-up, Attention, and operator-notification model.

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
Planner   -> interpret the current Goal boundary and maintain only the Work needed to reach it
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
A missing or defective contract-required deliverable is a Reviewer `reject`. Attention records a
condition for the Project Assistant to interpret. It is presented as Needs You only when current
progress genuinely requires operator authority or action.

Reconciler schedules valid ready work and wakes the Assistant. It does not interpret failures,
select recovery strategies, or decide what the operator should do.

## Goal Authority

The operator's original Goal statement is immutable after creation. It is permanent source evidence,
not a mutable contract.

Later understanding lives in Goal-local design documents, accepted Inputs, Work, and Evidence.
Lifecycle, priority, and scheduling controls remain mutable facts. Reopening a Goal changes lifecycle
only; it does not revise the original statement.

The current Goal contract is the completion boundary for this delivery, not a roadmap of possible
future rollout, certification, or governance work. An accepted instruction that narrows, defers, or
removes an outcome removes it from current design, nonterminal Work, acceptance, and completion
assessment. Deferred concerns may remain as historical context or become a later Goal; they do not
remain active as blocking Attention. Planner may replace and shrink prior nonterminal plans whenever
current authority no longer supports them.

## Speaking Session And Supervision Fork

The product exposes one Assistant identity. The runtime keeps one provider-native persistent
**speaking session** per Project so several Projects can advance independently without sharing an
unbounded conversation. Goal conversations inside one Project remain in that Project session.
Changing vendor, model, or incompatible execution capability starts a compatible physical session
without creating another product actor.

User turns continue the speaking session. A Project wake runs in a provider-native fork of the
speaking session. The fork inherits the same conversation context and provider cache, but its turns
never join the speaking-session history. It is the same Assistant with the same Project authority,
not a Reflection role, handoff target, or second product identity.

Native fork is a transport capability. HOPI does not approximate it by rebuilding a fresh prompt or
copying a transcript. A configured transport that cannot fork reports that capability failure
directly. A Project with no matching speaking session cannot run a supervision fork until a
speaking turn establishes one.

The Assistant has the Project's configured execution access. A provider transport may still enforce
its physical boundary, but HOPI adds no smaller semantic command allowlist for the Assistant.
Unrestricted access changes available capability, not responsibility ownership.

## Project Assistant Queue

Each Project admits one Assistant invocation at a time. Different Projects may invoke their
Assistants concurrently.

- a user message is durable and visible immediately, then waits if that Project already has an
  active invocation
- a wake waits behind an active user turn
- a user message arriving during a supervision fork does not interrupt it; it is the next invocation
- newer wake facts coalesce while either invocation is active and run only after queued user turns

This is ordering over existing durable Inbox turns and observed Project facts, not another workflow
state machine. User input has priority when selecting the next pending invocation, but an already
running invocation is allowed to settle. Process stop still interrupts the active provider process;
restart replays the retained pending input or unobserved Project facts.

## Wake-Up

Reflection is not an Agent, a role, or a model invocation. A Project event is only a reason to wake
the same Project Assistant in a supervision fork.

On a wake, one Assistant invocation receives:

- the concrete Project facts newer than its durable observed cursor and why they are material
- every unresolved Project Attention
- the affected Work contract, the complete latest terminal responsibility result, a bounded Attempt
  sequence, current active responsibility, relevant Goal-design excerpts, and canonical source paths
- the ordinary Project tool surface

The invocation may respond, act, update Attention, or finish silently. These are model judgments,
not workflow branches. A wake brief exposes facts rather than a retry threshold, diagnosis, or
recovery recommendation.

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

Events coalesce while an invocation is running. A material fact has one stable observation identity,
such as the published Reviewer Run that rejected a Work; a following Generator start does not turn
that same rejection into another wake. The observed cursor advances when its durable Inbox event is
stored. A process interruption leaves that event pending, so restart can fork the latest speaking
session and reassess current truth. A terminal provider failure is recorded and exposed once on the
same event rather than retried indefinitely; the event body and current Project state retain the
facts for the next speaking turn or material wake.

A running Work Attempt supplies its own later settlement edge, so unresolved Attention does not
create polling while delegated work is active. When no responsibility is active, unresolved
Attention may create one idempotent continuation edge per Attention revision.

If the Assistant transport cannot run, HOPI records and presents that operational failure directly.
It does not rely on the unavailable Assistant to report its own outage.

## Action Receipts

A supervision fork is never merged back into the speaking session. Instead, HOPI durably records the
fork's confirmed effects as compact action receipts:

- a successful mutating HOPI tool result
- a non-empty public Assistant reply, including any external effect it reports

Read-only investigation and an empty final response create no receipt. Raw fork prompts, reasoning,
tool streams, and diagnostics remain available in runtime logs but are not conversation context.

Pending receipts are supplied before the next user turn in that Project's speaking session. They are
acknowledged only after that speaking turn succeeds, so a failed turn cannot lose them. Repeated
delivery is harmless because each receipt has a stable identity and reports an already completed
fact. This is the only information returned from supervision to speaking context; it replaces both
session merging and a second handoff Agent.

## Attention

Attention is the Assistant's durable Project todo set. It is not a workflow gate, queue protocol, or
separate user channel.

An Attention document owns:

```yaml
id: A-...
createdAt: ...
updatedAt: ...
resolvedAt: null
refs:
  - project:P-...
summary: A short operator-facing explanation.
decisionPrompt: null
body: |
  Complete rationale, evidence, and technical detail for Agents.
```

`refs` are canonical identity and traceability links, not session-routing targets. Responsibility is
always the Project Assistant, and the owning Project selects that Assistant's persistent
conversation. A Project Attention keeps its canonical Home reference when copied into an Inbox
turn; routing it through the owning Project does not rewrite that reference. There is no owner,
target, kind, priority, waiting, working, notification, or recurring retry state.

`summary` and `body` describe the same condition for different readers. `summary` is the default
operator presentation; `body` is the complete Agent record. `decisionPrompt` is optional and reuses
one UI contract for one or more related questions, choices, recommendations, and free-form answers.
It belongs to Attention so editing the condition updates its current presentation without duplicating
question data in an Inbox event or presentation call.

The Assistant may create, edit, merge, or resolve Attention. An operator message is not
automatically converted into Attention, and an operator reply never automatically resolves one.
Attention does not block unrelated Work or Preview. Historical resolved documents remain auditable.

The model-facing Attention mutation tool operates on the Project-level set. Responsibility passes
may also publish Goal-local Attention as scoped execution facts. Assistant reads and may present
either form by exact canonical reference; it does not copy one into the other. Historical completion
Attention remains historical evidence rather than a second user channel.

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
unfinished responsibility without recurring polling. A material state edge, an active Attempt's
settlement, or one idempotent continuation for the current Attention revision wakes the same Project
conversation.

The Assistant provider process tree has the same turn lifetime. A shell child still running when the
turn ends is terminated with that turn; it is not a background job. A Work Attempt has an independent
RoleRunner process lifetime, and its settlement changes Project state and therefore produces the
ordinary supervision wake. `continue` durably queues that Work's next current-responsibility Attempt
without changing Work identity.

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

Needs You is the operator presentation of one or more open Attention records presented by the
Project Assistant in a public Inbox turn. `present_attention_to_user` records only their exact
canonical references on that turn. The UI reads current `summary` and optional `decisionPrompt`
directly from Attention; the detailed `body` remains available behind disclosure.

- one presentation may batch several related Attention records and several related questions
- an exact unresolved Attention referenced by the presentation renders as `Needs you`
- the header count is the number of distinct unresolved Attention records represented by visible
  requests
- selecting the count opens the newest represented request
- replying sends one ordinary user message with the source message and Attention reference as context
- the reply does not automatically resolve or modify Attention
- resolving every referenced Attention removes the request presentation
- presenting an Attention again makes the newest public request its current presentation

Requests use the presentation tool; neither presentation nor a choice submission changes Work readiness or
resolves Attention by itself.

The Assistant's ordinary final text is still a durable public receipt, but it is not the source of
Needs You wording. Optional external delivery mirrors an already persisted public message and never
becomes semantic authority.

## Deterministic Kernel

Deterministic validation remains only where a malformed value would corrupt durable or physical
state:

- identity and canonical path validation
- atomic document writes
- immutable Goal-source enforcement
- acyclic Work dependencies
- process ownership, interruption, and restart recovery
- Git/worktree publication integrity
- provider transcript, fork lineage, action-receipt, and event-cursor durability

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
- for Planner and Reviewer, the current Goal or Work boundary being judged

Prompts do not prescribe recovery playbooks, attempt thresholds, recommended choices, step order, or
structured final output. Documents and tools carry authority; model prose is not parsed into hidden
workflow state. Planner is not asked for a globally complete roadmap, and Reviewer is not asked to
promote future or deferred concerns into the current contract.
