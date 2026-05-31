# Merge Execution And Cleanup Design

Status: approved for implementation by the current project direction on 2026-05-31.

## Goal

Add deterministic merge execution and final cleanup on top of the current typed role-process adapter contract:

- perform real git merge completion for engineering runs
- keep planning runs merge-safe without forcing fake worktree merges
- clean disposable worktrees and branches only when the run is truly settled

This moves HOPI from “merger process returned success” to “the backend proved merge completion and cleaned the run workspace accordingly.”

## Scope

This slice covers:

- a deterministic git merge executor
- cleanup policy for success and no-op planning merges
- scheduler integration for merger-step post-processing
- tests using real temporary git repositories

This slice intentionally excludes:

- vendor-specific transports
- prompt compilation from `write-trace.jsonl`
- UI/API rendering of merge execution traces
- intervention surfacing beyond existing blocker behavior

## Merge Model

When a task is in `merging` and the merger adapter returns `success`, the backend must not immediately assume the task is `done`.

Instead it must:

1. determine the run-scoped source branch
2. execute or skip the actual merge based on task kind and repository state
3. clean disposable worktree state only on a settled success path

Run-scoped source branch identity remains:

```text
hopi/<goalKey>/<taskRef>/<runId>
```

## Engineering Tasks

Engineering tasks are expected to merge a run branch into the repo root.

Success path:

- if the source branch has a delta against `HEAD`, run `git merge --no-ff --no-edit <branch>`
- on merge success, remove the run worktree and disposable branch
- return `success`

Conflict path:

- if `git merge` conflicts, abort the in-progress merge in the root repo
- preserve the run worktree and branch for inspection or retry
- return `merge_conflict` with a stable artifact ref based on the source branch

Configuration errors:

- if an engineering merger succeeds but no run branch exists, treat this as a system error rather than silently claiming completion

## Planning Tasks

Planning work may legitimately edit durable Goal docs in the root workspace and may not need a worktree branch at all.

Planning merger success should:

- skip branch merge when no run branch exists
- clean a run worktree if one exists
- return `success`

This keeps planning tasks aligned with the design rule that planner may update `goal.md` and `design.md` directly.

## No-Op Merge Handling

For engineering work:

- if the source branch exists but has no delta against `HEAD`, treat it as a successful no-op merge
- clean the run worktree and branch
- do not manufacture a blocker

This matches the long-term principle that Merger should not invent blockers from an empty source branch.

## Cleanup Policy

Cleanup occurs only when the run is settled on a success path:

- engineering merge success
- engineering no-op merge success
- planning merge success

Do not cleanup when:

- merge conflict occurred
- a system error occurred
- reviewer rejection or retryable work sends the task back to `planned`

This preserves diagnostic state for non-settled runs while preventing successful runs from leaking worktrees indefinitely.

## Scheduler Integration

`reconcileOnce` remains the workflow control plane.

When dispatch step is `merger`:

- adapter `success` must be post-processed by the merge executor
- adapter `merge_conflict` still follows the existing retry/budget path
- merge executor `merge_conflict` feeds the same existing retry/budget path
- merge executor system errors remain system errors and must not become task blockers

## Testing Strategy

Use real temporary git repositories and real worktrees.

Required checks:

- engineering merge success merges the branch into the root repo and cleans the worktree
- engineering merge conflict aborts the root merge and preserves the run worktree
- planning merge success can complete without a run branch
- no-op engineering merge succeeds and cleans the worktree
- scheduler integration uses merge execution before marking merger work `done`

## Non-Goals

- no hidden compatibility layer for deleted task states
- no DB-owned merge state
- no fake merge success without proving repo state
