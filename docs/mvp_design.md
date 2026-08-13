# HOPI MVP Design

Status: current product and architecture authority
Last updated: 2026-08-13

This document defines the implemented MVP boundary. Supporting documents may explain storage,
publication, Project runtime, Assistant, or multi-Repo mechanics, but they must not introduce another
product workflow.

Production supports the current schema only. After an incompatible schema change, reset the Project
before use. Runtime readers do not infer or migrate superseded Attempt formats.

## Current authority

The MVP proves exactly five product properties:

1. A Run is requested explicitly.
2. Every Run has an independent provider Session and bounded workspace.
3. Review is optional.
4. Every Run settles reliably with a Report and termination fact.
5. Engineering Work becomes Done only after an explicit completion decision and successful C1
   delivery.

These properties are intentionally implemented on the existing Project, Goal, Work, Attempt, stable
task branch, and C1 architecture.

## Product model

The operator-facing concepts remain:

- **Assistant**: the conversation and semantic decision surface.
- **Project**: stable repository bindings, Project guidance, Preview, and Goals.
- **Goal**: the accepted outcome.
- **Work**: a visible unit of work in the existing four-lane Board.

The runtime adds only the facts required to execute Work:

- **Run / Attempt**: one immutable, bounded execution request and its lifecycle.
- **Report**: the Run's natural-language outcome.
- **C1**: the deterministic publication boundary that delivers current task branch heads and the
  Work completion document together.

Run and Attempt are two names for the same stored runtime object. There is no second Run store.

## Explicit execution loop

```text
Assistant or API
  -> explicitly request Run
  -> queued Attempt
  -> Scheduler starts that Attempt
  -> fresh provider Session and selected workspace
  -> settle once with termination + Report + candidate repo commits
  -> publish the facts and wake Assistant
  -> Assistant decides the next explicit action
```

A settled Run never changes Work semantics by itself. The runtime does not automatically create a
Planner, Generator, or Reviewer Run, enter Review, retry, or complete Work.

The Project Assistant is the logical supervisor. It reads current facts and may create Goal/Work,
request another Run, update Work authority, complete Work, cancel Work, or ask the operator. This is
ordinary Assistant judgment through existing tools, not a separate Goal Supervisor service or store.

## Progressive wayfinding

When the route to a Goal's destination is wrapped in fog, Wayfinding finds the way rather than
charging at the destination. Goal-local `design/index.md` is the shared low-resolution map; precise
questions become decision tickets, while what cannot yet be phrased precisely stays in `Not yet
specified`. Assistant works one current-frontier ticket at a time and hands off actionable
Engineering Work when it reaches the edge of the map.

The Work DAG contains execution commitments, not decision tickets or a speculative roadmap. The
authoritative HOPI mapping is in
[`mvp_project_owner.md`](./mvp_project_owner.md#progressive-wayfinding).

## Work lanes

The existing Board lanes remain `Plan`, `Build`, `Review`, and `Done`.

Lanes are presentation and lifecycle facts, not a scheduler program:

- requesting a Generator Run projects Engineering Work to `Build`;
- requesting a Reviewer Run projects Engineering Work to `Review`;
- no lane ever creates a Run;
- Review may be skipped, entered, or revisited.

Valid Engineering paths include:

```text
Build -> Done
Build -> Review -> Done
Build -> Review -> Build -> Done
```

Planning Work remains available but Planner execution is also explicit.

## Run contract

A Run request contains only:

```text
profile: planner | generator | reviewer
workspaceMode: none | read_only | isolated_write
instructionMarkdown: non-empty Markdown
refs?: string[]
```

There is no protocol selector, base ChangeSet, legacy semantic outcome, or implicit continuation
command.

Attempt lifecycle is:

```text
queued -> running -> settled
```

Every settled Attempt has one termination:

```text
normal | cancelled | interrupted | crashed | timed_out
```

Every settled Attempt has a non-empty `reportMarkdown`. The model's final natural-language response
is the Report. If the process ends without final language, the runtime writes a concise factual
fallback from the observed termination and diagnostics. Runtime never fabricates semantic success.

Actual transport, model, and reasoning configuration are recorded when execution starts.

## Session and workspace isolation

Every Run uses a Session/workspace identity containing its Run ID. A settled provider Session is not
reused by another Run.

`isolated_write` Runs use the existing stable task branch for the owning Work. Their disposable
Run workspace may be rebuilt, but the task branch remains source truth. On normal exit,
cancellation, interruption, crash, or timeout, runtime checkpoints each bound Repo and records the
resulting candidate commit in the Attempt manifest. It does not copy a patch into another store.

Context exhaustion or provider Session failure settles the current Run. The Assistant may request a
new Run with explicit references. Session Epoch rotation is not part of this MVP.

## Explicit completion and C1

Completing Engineering Work is an Assistant/API decision, not a Run result.

Before completion, runtime verifies:

- the Work is nonterminal;
- all dependencies are done;
- the Goal is active;
- no Attempt for that Work is queued or running.

The completion operation snapshots the current Project release refs and current stable task branch
heads. C1 then:

1. validates those expected refs;
2. integrates the selected task heads for every bound Repo;
3. writes the Work Done document into the same logical release;
4. advances the primary release ref with compare-and-swap;
5. materializes secondary projections.

Only successful C1 makes the Work Done. A release or task-head change, merge conflict, failed
projection precondition, or restart uncertainty leaves Work nonterminal, records the failure fact,
and wakes the Assistant. A Work with no source delta still uses canonical-only C1.

The audit record contains the Assistant event ID, completion decision, final primary C1 commit, and
the actual repo commits integrated. It does not require an evidence Run ID.

A Goal may become Done only through an explicit decision after every Work is terminal and no Run is
queued or active. Work count remains a display summary and is not completion authority.

Unresolved text is not independently a completion gate. If current Goal acceptance is satisfied,
remaining possibilities are either explicitly outside this Goal or become a new Goal; they do not
force placeholder Work merely to empty the map.

## UI compatibility

Projects, Board, four lanes, progress summary, Assistant docking, and the Work modal retain the
pre-evolution structure and wording. The modal keeps the existing Model display and adds only a
collapsed Report plus termination. Operation, ChangeSet, Session Epoch, and new dashboard sections
are not exposed.

## Deferred capabilities

The following are legitimate future capabilities, not current requirements:

- first-class Thread isolation;
- Session Epoch handoff;
- a standalone Goal Supervisor;
- a generic immutable ChangeSet store;
- typed Delivery Operations;
- workflow expressions or lane-driven scheduling.

They require a separate design decision and must not appear as compatibility scaffolding in current
production code.

## Reset boundary

The current feAgent-Message Project was reset and is the schema cutover boundary: it contains only
its two Repo bindings and no Goal or Attempt history. Other Homes created with a superseded Attempt
schema must be reset before use. The Project Reset epoch prevents old C1 history from being
reconstructed as current Project state.
