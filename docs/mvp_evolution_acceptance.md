# HOPI Work-Preserving Evolution Acceptance

Status: current acceptance authority

Last updated: 2026-08-13

This document turns the 2026-08-13 take-home evidence into implementation contracts for the
Work-preserving HOPI evolution. Tests should assert durable facts and user-observable behavior, not
private class names or a fixed provider call sequence.

## Test layers

Each trajectory is covered at the cheapest layer that proves it:

1. pure state and projection tests;
2. durable store/restart tests;
3. scheduler and runtime contract tests with fake providers;
4. HTTP and browser product tests;
5. one bounded live take-home replay before cutover.

An upper-layer test does not replace a missing lower-layer invariant. Live tests are evidence for
provider and host boundaries, not the only proof of deterministic behavior.

## Baseline preservation

Before migration work begins:

- the restored frontend suite, typecheck, and production build pass;
- backend typecheck, lint, and the complete non-live suite pass;
- Project linking, multi-Repo worktrees, Preview, Assistant feed, Work Board, document view, and
  provider adapter tests remain enabled;
- baseline failures are repaired or recorded before architecture changes are attributed to them.

Existing tests that require mandatory `Planner -> Generator -> Reviewer -> C1` ordering must be
rewritten when the scheduler boundary changes. They must not simply be deleted: their safety,
artifact, isolation, and integration assertions move to generic Run trajectories.

## EV-001: fresh Run session

Given a Work with a settled Run, when the Supervisor starts a retry, repair, or review Run:

- the new Run has a new Run ID and provider Session Epoch;
- its immutable input references the earlier Report/ChangeSet when relevant;
- it does not resume the settled provider Session;
- changing assignment, execution profile, permission boundary, or runtime contract cannot reuse an
  incompatible Session;
- a Coordinator restart preserves enough metadata to prove the decision.

## EV-002: Epoch handoff within one running Run

Given a running Run near its provider context boundary:

- the runtime waits for the current tool call to settle;
- an isolated-write workspace is checkpointed;
- the old Epoch records its close reason and bounded handoff;
- a new Epoch continues the same Run and workspace;
- the Board and Run URL retain the same logical Run identity;
- a crash before a safe checkpoint settles the Run instead of replaying an uncertain tool turn.

## EV-003: unconditional settlement

For `normal`, `cancelled`, `interrupted`, `crashed`, and `timed_out` exits:

- the Run reaches `settled` exactly once;
- timing, actual execution configuration, termination, exit code, diagnostic, transcript, and
  artifacts remain readable after restart;
- final natural language becomes the Report when present;
- missing final language produces a factual fallback Report rather than `no terminal outcome`;
- no semantic success is inferred solely from process exit code.

## EV-004: interrupted source preservation

Given an isolated-write Run that changes one or several Repos and then crashes or is interrupted:

- every surviving source delta is frozen before disposable workspace cleanup;
- the ChangeSet records producer Run, Repo ID, base, result/patch, and content hash;
- the ChangeSet is explicitly marked as unaccepted evidence;
- a later Run can consume it without relying on the old worktree.

## EV-005: actual model visibility

Given different Assistant/profile defaults and overrides:

- each Run records requested and actual transport/provider/model/reasoning;
- the Work/Run detail shows the actual values;
- profile labels do not imply that another profile changed with them;
- Session or Epoch reuse is visible;
- a user can answer “did the model change take effect?” without reading runtime files.

## EV-006: optional review

The same scheduler supports all of these without special workflow branches:

- a low-risk Work completes after one implementation Run;
- a Work receives an independent read-only review Run;
- a rejected review leads to a new repair Run with explicit references;
- a research-only Work settles with a Report and no ChangeSet;
- Work stage presentation does not automatically select a fixed provider role.

## EV-007: semantic completion

- adding or cancelling Work never changes a numeric Goal progress fraction because none exists;
- Goal completion requires an explicit Supervisor decision against current acceptance meaning;
- active Runs and acceptance-required Operations prevent premature completion;
- optional ZIP/PR/deployment does not become a hidden global gate;
- a required ZIP/PR/deployment remains incomplete until its Operation succeeds;
- reopened Goals retain prior evidence without resuming settled Runs.

## EV-008: candidate ancestry and baseline conflict

For single- and multi-Repo ChangeSets:

- integration validates every expected base;
- a valid fast-forward keeps the accepted candidate in Git ancestry;
- selected user checkouts are never mutated;
- a competing baseline change produces a durable conflict result;
- the runtime does not synthesize a tree-only commit that hides candidate provenance;
- restart at each Operation boundary is idempotent and recoverable.

## EV-009: Thread isolation

- two top-level messages produce sibling Threads with distinct provider Sessions;
- replying resumes only the selected Thread;
- Project/Goal page scope is an origin reference, not permanent binding;
- a Thread may explicitly affect several Goals;
- bounded retrieval resolves cross-Thread references without injecting complete unrelated history;
- Thread Epoch handoff remains transparent in the existing Assistant feed.

## EV-010: Attention reply lineage

- a surfaced Attention is readable from Home, Project, and Goal projections without duplication;
- its reply retains exact Thread, Goal, and Attention references;
- receiving a reply does not mechanically resolve the Attention unless the operator dismisses it;
- Supervisor judgment can resolve it and continue Work;
- retries do not duplicate the canonical reply or downstream action.

## EV-011: old frontend structure

Browser coverage proves that these remain structurally stable:

- Project home and switching;
- docked/compact Assistant behavior;
- four-lane Work Board;
- Work detail modal and Run history;
- three-pane Goal documents;
- Project linking/rebinding, Preview, and agent settings.

It additionally proves that Goal cards omit Work-count progress and Run detail exposes actual model,
Epoch, termination, Report, ChangeSet, artifacts, and transcript entry.

## EV-012: take-home replay

Replay the service-monitor take-home pattern with deterministic fixtures and one bounded live run:

1. implementation leaves a candidate ChangeSet;
2. independent review finds defects;
3. repair starts a fresh Run and Session;
4. a second review can reject documentation evidence without losing source history;
5. the final accepted candidate remains in release ancestry;
6. an explicitly required archive is represented by an Operation;
7. restart during execution and during integration preserves an explainable trail;
8. the operator can reconstruct the entire result from product APIs and UI.

## Migration gates

### Gate A: baseline

- complete old frontend check passes;
- complete old backend check passes;
- baseline-only fixes are isolated and documented.

### Gate B: execution facts

- EV-001, EV-003, EV-004, and EV-005 pass below the browser layer;
- old Work and Feed APIs remain usable.

### Gate C: scheduler decoupling

- EV-006 and EV-007 pass;
- no runtime-required `responsibilityFor(stage)` or model-authored terminal JSON remains.

### Gate D: external effects

- EV-008 passes for single- and multi-Repo Projects, including restart injection.

### Gate E: conversation and UI

- EV-002, EV-009, EV-010, and EV-011 pass;
- frontend build budgets do not regress without an explicit reviewed change.

### Gate F: cutover

- EV-012 passes;
- Home migration backup, apply, verification, and rollback are exercised;
- compatibility writers are disabled;
- obsolete fixed-pipeline tests are replaced by equivalent generic Run safety tests.

## Test implementation rule

Until a later gate is under active implementation, its executable test may be committed as
`test.todo` with the complete assertion name. A gate cannot be declared complete while any of its
tests remain todo, skipped, or dependent only on a live provider.
