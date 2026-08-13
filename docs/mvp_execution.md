# HOPI MVP Execution

Status: current execution authority
Last updated: 2026-08-13

This document specifies how the design in [mvp_design.md](./mvp_design.md) executes on the existing
Goal, Work, Attempt, task-branch, and C1 runtime.

## One explicit Run path

All role execution enters through one command:

```ts
type RunRequest = {
  profile: 'planner' | 'generator' | 'reviewer'
  workspaceMode: 'none' | 'read_only' | 'isolated_write'
  instructionMarkdown: string
  refs?: string[]
}
```

The command validates the current Goal and Work, applies the one-way Board projection for Generator
or Reviewer, hashes the resulting Work authority, and reserves exactly one queued Attempt. Repeating
the same explicit request while it remains queued is idempotent.

There is no `continue`, `protocol`, `baseChangeSetId`, `legacy_outcome`, semantic result JSON,
or application phase.

## Scheduling

Scheduler consumes durable queued Attempts. It never derives a responsibility from Work kind or
stage and never creates an Attempt.

A queued Attempt may start when:

- its Project is available;
- its Goal and Work are current and nonterminal;
- its stored Work hash still matches;
- `notBefore` has passed;
- dependencies are done;
- no conflicting active Attempt exists;
- the requested profile has capacity.

A stale or no-longer-runnable queued Attempt settles as interrupted with a factual Report. If no
queued Attempt is runnable, Scheduler waits.

## Planner Run

Planner works one current-frontier decision ticket per explicit bounded Run. Wayfinding is planning:
the ticket resolves a decision rather than delivering the destination. The pull to implement is the
signal that Planner has reached the edge of the map and should report the Engineering handoff.

A `none` Run reasons over supplied authority; `read_only` may inspect Project source, documentation,
and current candidate facts. AFK research or investigation may resolve from evidence alone. A HITL
grilling or prototype ticket cannot resolve until the operator reacts; Planner may produce a rough
Run Artifact to raise fidelity but never supplies the human side. Product source remains unchanged;
source intended to survive requires Engineering Work and an `isolated_write` Generator Run.

The natural-language Report records the ticket's answer, evidence, remaining fog, newly visible
decision tickets, and any actionable Engineering handoff without a parsed result schema. Settlement
wakes Project Assistant, which alone updates the map, mutates Work, requests Attention, or chooses
the next frontier ticket. A Report has no automatic control effect.

## Attempt manifest

Every Attempt stores immutable identity and request data plus mutable runtime settlement:

```ts
type AttemptStatus = 'queued' | 'running' | 'settled'
type AttemptTermination =
  | 'normal'
  | 'cancelled'
  | 'interrupted'
  | 'crashed'
  | 'timed_out'

type Attempt = {
  runId: string
  projectId: string
  goalId: string
  workId: string
  workHash: string
  profile: RunRequest['profile']
  workspaceMode: RunRequest['workspaceMode']
  instructionMarkdown: string
  refs: string[]
  status: AttemptStatus
  execution: null | {
    transport: string
    model: string | null
    reasoningEffort: string | null
  }
  termination: AttemptTermination | null
  reportMarkdown: string | null
  candidateCommits: Array<{
    repoId: string
    baseCommit: string
    resultCommit: string
  }>
}
```

Queued and running Attempts have no termination or Report. Settled Attempts have both. The store
permits only one settlement and uses atomic manifest replacement.

## Execution

Every Run receives:

- a provider Session key containing the Run ID;
- a Run-local directory containing the Run ID;
- current canonical Project/Goal/Work context;
- explicit referenced facts;
- the workspace selected by `workspaceMode`;
- actual provider/model/reasoning settings captured at start.

Provider Session continuity exists only inside one Run. Context exhaustion, a dead provider
Session, or process loss settles that Run; another invocation is a new Run.

`none` has no Repo workspace. `read_only` reads the current stable task branches without source
publication permission. `isolated_write` executes in managed task worktrees backed by the stable
task branches.

## Report and termination

Role prompts request a natural-language Report, not terminal JSON. The final language is stored
verbatim as `reportMarkdown`.

If final language is missing, runtime creates a short factual Report naming the observed
termination, exit code when known, and the most relevant diagnostic. The fallback describes facts
only; it does not claim success, rejection, acceptance, or completion.

Cancellation, interruption, process crash, timeout, and normal exit all converge on the same
settlement function. A Run settles once even if process exit and cancellation race.

Settlement publishes the Attempt fact and wakes the Project Assistant. It does not mutate Work.

## Source checkpoint

For every `isolated_write` exit path, runtime checkpoints each managed task worktree before final
settlement. The task branch is the durable candidate source. The Attempt records the base and
resulting commit for diagnosis and completion audit.

No patch or source tree is copied into a ChangeSet store. A later Run reconstructs or reuses the
managed worktree from the stable task branch, so disposable workspace loss does not lose accepted
candidate source.

## Work completion

`hopi_control_work.complete` accepts only `{ decision }` in addition to the Work identity carried
by the tool envelope. The source Assistant event provides idempotency and audit identity.

Completion rejects when the Work has queued/running Attempts, incomplete dependencies, stale
authority, or an inactive Goal. It snapshots:

- every bound Repo release commit;
- every current Work task-branch commit;
- current Goal and Work document hashes.

C1 integrates those exact task heads and the completed Work document. Ref movement is guarded by
compare-and-swap. If any snapshotted task head or release ref changes, completion fails without
publishing Done.

Multi-Repo C1 keeps one primary release boundary and component commits for secondary Repos.
Projection recovery may finish materializing an already durable C1 after restart, but it never
re-runs a model or invents a completion. A source-less Work still receives a canonical-only C1.

## Goal completion

Goal completion is explicit. It requires all Work terminal and no queued/running Attempt in the
Goal. Attention and Work count remain visible facts but do not synthesize completion. Text remaining
under `Not yet specified` does not mechanically block completion: Assistant must judge whether it is
irrelevant to current acceptance, explicitly outside the Goal, or evidence that the Goal is not yet
complete.

## Public projections

Existing Project, Goal, Work, Attention, and Attempt routes remain. Attempt summary/detail expose:

- `status`;
- `termination`;
- `reportMarkdown`;
- actual `execution`;
- internal candidate Repo commits.

List summary is the first non-empty Report text. No projection includes Operation or ChangeSet
objects.
