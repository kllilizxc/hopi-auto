# HOPI MVP State Model

Status: current derived-state authority
Last updated: 2026-08-13

Canonical documents and Attempt manifests own facts. Board lanes, readiness, progress, and activity
are projections.

## Goal

```text
active <-> paused
active  -> done
active  -> cancelled
paused  -> cancelled
```

A Goal may become Done only through an explicit completion decision when every Work is terminal and
no Attempt is queued or running. Work count is not completion authority.

## Work

Planning Work:

```text
plan -> done
plan -> cancelled
```

Engineering Work:

```text
generate <-> review
generate  -> done
review    -> done
generate | review -> cancelled
```

`generate` renders in Build. `review` renders in Review. Requesting a Generator or Reviewer Run
may move the Work to that display focus. Moving a Work never requests a Run.

Review is optional. A settled Run never changes Work stage or terminal state.

The Wayfinding map, decision tickets, fog, and frontier are planning meaning, not stored lifecycle
states. Current Planning Work and its Attempt use only the ordinary states below.

## Attempt / Run

```text
queued -> running -> settled
queued -----------> settled
```

A settled Attempt has exactly one termination:

```text
normal | cancelled | interrupted | crashed | timed_out
```

It also has a non-empty Report. There are no semantic result or application substates.

## Explicit readiness

Only an already queued Attempt can become running. Scheduler checks:

- Project available;
- Goal active;
- Work nonterminal and authority hash current;
- `notBefore` reached;
- all dependencies done;
- no conflicting active Attempt;
- requested profile capacity.

Work kind and stage do not select a profile and do not enqueue execution. An unchanged settled
Attempt is inert until the Assistant explicitly requests another Run or changes the Work.

## Source candidate

An `isolated_write` Run checkpoints every exit path to the stable Work task branch:

```text
task branch head before Run -> checkpoint commit -> candidate commit in Attempt
```

The branch, not a disposable worktree or copied patch, is durable source truth.

## Explicit Engineering completion

```text
completion requested
  -> validate Work/dependencies/no active Run
  -> snapshot release refs + task heads
  -> C1 merge and canonical Done publication
  -> compare-and-swap release ref
  -> Done
```

Any validation, conflict, release movement, or task-head movement leaves the Work nonterminal and
publishes a failure fact for Assistant judgment. No source change follows the same path with a
canonical-only C1.

## Attention

```text
open -> resolved
```

Attention supplies durable context to the Assistant. It is not an execution queue or an implicit
retry gate.

## Assistant turn

```text
pending -> handled
```

A handled Assistant turn may explicitly create or update domain facts, request a Run, complete Work,
or cancel Work. The Assistant is the logical supervisor; there is no separate Supervisor lifecycle.

## Restart

Restart reconstructs current state from canonical documents, Project release refs, stable task
branches, and Attempt manifests. A writable manifest left running after process loss checkpoints
its stable task branch before settling as interrupted with a factual Report. Project Reset creates
an epoch boundary so earlier C1 records are not replayed into a reset Project.
