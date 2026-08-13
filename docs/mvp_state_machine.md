# HOPI MVP State Model

Status: fixed-pipeline implementation baseline; not current product authority. See `mvp_design.md`.

Status: current derived-state authority
Last updated: 2026-07-29

HOPI persists only business facts that must survive restart. Scheduling, board lanes, activity,
readiness, and user presentation are projections of those facts. This document describes the
current schema only; after a schema change, development state is recreated.

## Goal

A Goal has one lifecycle:

```text
active <-> paused
active  -> done
active  -> cancelled
paused  -> cancelled
```

- `active`: Reconciler may dispatch ready Work.
- `paused`: no new Work is dispatched.
- `done`: final Planning Evidence proves the accepted outcome.
- `cancelled`: the outcome was abandoned; all nonterminal Work is cancelled and live Runs are
  interrupted.

`done` and `cancelled` are terminal. A completed Goal can be reopened only by an explicit new
contract revision, which returns it to `active` and creates current Planning Work.

## Work

Planning Work:

```text
plan -> done
plan -> cancelled
```

Engineering Work:

```text
generate -> review -> done
    ^          |
    +-- reject-+

generate | review -> cancelled
```

The Work document owns only `kind`, `stage`, `dependsOn`, `notBefore`, `contractRevision`, and
consumed `evidenceRefs` plus optional direct-dispatch provenance for Engineering Work. It does not
store running, blocked, retry, Repo, or attempt counters.

Responsibilities are fixed by Work state:

| Work state | Responsibility |
| --- | --- |
| Planning `plan` | Planner |
| Engineering `generate` | Generator |
| Engineering `review` | Reviewer |

Reviewer success becomes `done` only after C1 integrates the candidate into every Project binding
and publishes the primary release boundary.

## Attempt

Each responsibility invocation has one immutable Run identity and one runtime manifest:

```text
queued -> running -> finished
             \----> interrupted
queued ------------> interrupted
```

The responsibility reports `success | reject | attention | fail`. Coordinator separately records
whether the proposed effect was `published | invalid | stale`. Provider, process, filesystem, and
tool failures are runtime facts rather than semantic results.

An unchanged Work with a settled unsuccessful Attempt is not automatically redispatched. The
Project Assistant sees the current state and may continue the Work, change its authority, cancel it,
or ask the operator. HOPI has no retry counter or outcome-specific recovery tree.

## Readiness

Reconciler dispatches a Work when all current facts permit it:

- Goal is `active`
- Project bindings and canonical root are valid
- Work is nonterminal and belongs to the current Goal contract revision
- `notBefore` has passed
- every dependency is terminal
- no Attempt for the same current responsibility is queued or running
- the unchanged Work has no settled unsuccessful Attempt
- the responsibility has global capacity

Attention is context, not a second scheduling state. Creating, presenting, or replying to
Attention does not itself change readiness. Any effect that should stop or resume execution must be
represented by Work, Goal, Project, or Attempt facts.

If an active Goal has no nonterminal Work, Reconciler ensures one Planning Work so Planner can judge
whether the Goal is complete or needs more Engineering Work.

## Attention

Attention has only two states:

```text
open -> resolved
```

An Attention document owns:

- stable identity and canonical target
- creation time and optional resolution facts
- a concise operator `summary`
- optional `decisionPrompt` choices
- detailed Markdown for the Assistant

`present_attention_to_user` attaches complete Attention references to the current Assistant reply.
The UI presents the Assistant reply followed by each concise summary and its choices. Presentation
does not mutate Attention, Work, or
scheduling. A user reply preserves exact reply provenance; the Assistant then judges current facts
and explicitly performs any needed domain action or resolves the Attention.

## Assistant Turn

Inbox turns have one durable transition:

```text
pending -> handled
```

A handled turn atomically owns `handledAt` and `disposition`. A public turn additionally owns its
non-empty final `reply`; an intentionally silent internal turn keeps `reply: null`. Tool calls
publish their own domain effects; reply prose is never interpreted as control state. One Home
conversation and one conversation per Project share a single speaking queue.

## Completion

Goal completion is direct:

1. Engineering Work reaches `done` through Reviewer success and C1.
2. Planner reads the complete current Goal and formal release Preview evidence when available.
3. Planner publishes final Planning Evidence and marks its Planning Work `done`.
4. Coordinator validates that every Work is terminal and sets Goal lifecycle to `done`.
5. The feed derives one completion update from that final Evidence.

There is no completion Attention, delivery-pending state, or required Assistant phrase.

## Restart

Canonical documents, release refs, task branches, and durable Attempt manifests survive restart.
Processes, locks, projections, and session caches do not own business state. Startup:

1. acquires the single Coordinator lock;
2. validates the current Home, Project bindings, release refs, and canonical roots;
3. marks abandoned running Attempts interrupted;
4. rebuilds disposable projections;
5. resumes reconciliation from current facts.

Readers accept only the current schemas. Invalid state fails visibly and may be discarded and
recreated during development; HOPI does not infer or migrate another format.
