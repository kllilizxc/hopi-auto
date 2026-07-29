# HOPI Publication Protocol

Status: current implementation ADR
Last updated: 2026-07-29

HOPI has one publication primitive:

```text
publish(validated bundle, optional final gate)
```

It protects durable document transitions inside one authority root. It is not a general database
transaction, distributed lock, or workflow engine.

## Ownership

One writable Assistant Home belongs to one Coordinator process. Startup acquires an instance lock;
a second Coordinator fails before it can schedule or publish.

Inside that process, one global publication queue serializes canonical mutations. Model execution,
Git inspection, tests, and file preparation happen outside the queue. The queue contains only the
final reread, validation, and durable write.

## Bundle

A bundle contains:

- the authority snapshot against which the caller acted;
- exact file writes and deletes;
- the canonical parser and domain validator for the resulting package;
- at most one final control gate.

The publisher:

1. rereads every protected path;
2. rejects changes outside the caller's declared writes;
3. applies the writes to an in-memory candidate;
4. validates the complete candidate package;
5. writes ordinary facts first;
6. writes the one gate last.

The final gate is the fact whose presence makes the transition effective, such as a Work stage,
Goal lifecycle, Attention resolution, Inbox handling, or release ref. A transition needing two
independent gates is two publications with an explicit order.

## Durability

Each file is written to a sibling temporary path and atomically renamed into place. JSONL uses a
newline-terminated record as its durability boundary: readers ignore only the single unfinished
tail and reject malformed terminated records.

The publication queue does not make the filesystem transactional across several files. Correctness
comes from:

- ordinary facts before the final gate;
- complete-package validation before writes;
- immutable identities and append-only Evidence;
- idempotent reread of the intended end state after restart.

## Responsibility Result

When a Run ends, Coordinator enters the publication queue and rereads current Goal authority. It
requires:

- Goal is still active;
- Work still owns the Run's responsibility and contract revision;
- dependencies and C1 prerequisites still hold;
- protected source paths still match the Run snapshot;
- the Run result has not already been consumed.

Outcomes:

- `published`: proposed Evidence and state transition became current.
- `invalid`: the proposal violates the current document or responsibility contract; no canonical
  effect is written.
- `stale`: authority changed while the Run executed; no canonical effect is written.

The Attempt keeps the complete result and diagnostics in all cases.

For `success`, Evidence is written before the Work transition. Reviewer success additionally runs
C1 and publishes the primary Project release ref as its irreversible boundary. For `attention`,
Evidence and targeted Attention are published while the owning Work remains unchanged. For `fail`,
Evidence is preserved and Work remains unchanged. A settled unsuccessful Attempt prevents automatic
redispatch of that unchanged Work until the Assistant chooses a current action.

## Assistant Tool Effects

Every mutating HOPI tool names its authority root and validates its own target. Goal-changing tools
publish a qualified Input receipt for the originating Inbox event. That receipt proves the event's
material effect was accepted and makes repeated tool execution idempotent.

From the first Goal effect in one Assistant turn until the turn is handled or fails, Coordinator
holds an in-process dispatch barrier for each touched Goal. This prevents Runs from observing a
half-finished sequence of tool effects without inventing another persistent status.

After tools finish, the Assistant turn publishes `handledAt`, final reply, and disposition together.
If the turn requested user attention, the same handled turn owns the exact canonical
`attentionRequest` references shown by the UI.

## Cross-root Sequence

Assistant Home and Project Git are separate authority roots. HOPI does not pretend to make them one
transaction.

For a user instruction that changes a Goal:

1. the pending Inbox turn is already durable;
2. the Project publication writes its domain effect and qualified Input receipt;
3. the Assistant-home publication marks the turn handled.

On restart, the tool rereads the qualified Input receipt and current target. It either observes the
completed effect or reports the current conflict; it never guesses missing business intent.

Project-target Workspace Attention is written only in Assistant Home because an invalid Project root
cannot safely accept Goal-local documents. Repair validates the complete current binding and
canonical root before resolving that Attention.

## Git C1

Each `Project × Repo` binding owns:

- `refs/heads/hopi/project/<projectId>/release`;
- one managed integration worktree;
- Project-qualified Work branches and task worktrees.

C1 prepares candidate commits outside the publication queue, then revalidates every release head
inside the final integration operation. Secondary binding commits are materialized first. The
primary commit contains the current `.hopi/project.yml` release manifest and is published last.

The selected user checkout is only a repository locator and initial baseline. HOPI never switches
its branch, changes its HEAD, index, or working tree, or uses it as a delivery target.

## Restart

After process replacement:

- running Attempts become interrupted;
- queued Attempts remain durable;
- disposable worktrees and projections are rebuilt from current refs when missing;
- a gate already present makes its preceding facts authoritative;
- facts present without their gate remain unconsumed evidence;
- pending Inbox turns resume from durable conversation and tool receipts.

Only the `schemaEpoch` declared by current code is accepted. State from another epoch is discarded
with the explicit whole-Home reset; there are no schema readers, importers, field defaults, or
migrations.
