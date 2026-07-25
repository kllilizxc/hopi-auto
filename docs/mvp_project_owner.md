# Project Owner And Attention

Status: authoritative MVP design
Last updated: 2026-07-24

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

## Wake-Up

Reflection is not an Agent, a role, or a model invocation. A Project event is only a reason to wake
the same Project Assistant.

On a wake, one Assistant invocation receives:

- the current operator message, when one exists
- Project events newer than its durable observed cursor
- every unresolved Project Attention
- compact derived Project health with canonical source paths
- the ordinary Project tool surface

The invocation may respond, act, update Attention, or finish silently. These are model judgments, not
workflow branches.

Wake-up is edge-triggered:

- new operator input wakes the Assistant
- new material Project events wake the Assistant
- explicit runtime liveness recovery may wake the Assistant
- unresolved Attention by itself does not repeatedly wake the Assistant

Events coalesce while an invocation is running. Advancing the observed cursor and persisting any
Assistant effects is crash-safe. An interrupted invocation does not acknowledge unseen events.
Effects produced by the current Assistant turn are acknowledged with that turn and do not wake the
same Assistant again. A different operator or runtime event that arrives while the turn is active
remains newer than the turn and causes the next wake.

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
refs:
  - project:P-...
body: |
  Natural-language fact, question, or unfinished responsibility.
```

`refs` are traceability links, not routing targets. Responsibility is always the Project Assistant.
There is no owner, target, kind, priority, waiting, working, notification, retry, or operator-request
state.

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

Finishing an Assistant turn publishes its effects and optional reply, but does not itself preserve
unfinished responsibility or schedule another wake. Attention is the durable representation for
responsibility that must remain available to a later turn.

## Needs You

The Assistant can associate part of a public reply with one unresolved Attention:

```xml
<NeedsYou attentionId="A-123">
需要你确认实际业务取舍。
</NeedsYou>
```

This annotation changes message presentation only:

- while the referenced Attention is unresolved, the block renders as `Needs you`
- resolving the Attention makes the same historical block render as ordinary Markdown
- Reply records `replyToAttentionId` as conversation context
- Reply does not mutate the Attention
- a missing or invalid reference renders as ordinary Markdown and records a diagnostic

Only this allowlisted tag is interpreted. It does not enable arbitrary HTML, scripts, or nested
control markup. The header count is the number of distinct unresolved Attention IDs referenced by
visible Assistant messages.

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
the Assistant. No Attention is synthesized by Coordinator.

## Work Intervention

The Assistant changes Work through the same canonical Work document used by responsibility passes.
Changing dependencies replaces the nonterminal Engineering Work's `dependsOn` set and is accepted
only when the resulting graph is valid and acyclic.

Sending a Work message appends a timestamped, source-traced Project Owner note to that document. If
an Attempt is active, HOPI interrupts it and schedules the changed Work in the same persistent
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
