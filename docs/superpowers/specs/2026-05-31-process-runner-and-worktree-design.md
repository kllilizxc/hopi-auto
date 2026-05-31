# Process Runner And Worktree Design

Status: approved for implementation by the current project direction on 2026-05-31.

## Goal

Add the first real execution skeleton behind the streaming adapter boundary:

- provision isolated git worktrees for task execution
- run local processes inside the selected execution directory
- stream stdout and stderr into runtime history as typed step events

This moves HOPI from a scripted mock-only runtime toward a real autonomous execution substrate without prematurely binding to a specific LLM vendor.

## Scope

This slice covers:

- a git worktree manager
- a process-backed adapter implementation of `AgentRunner`
- tests that exercise real subprocess execution against temporary git repositories

This slice intentionally excludes:

- real Claude / Codex / OpenCode adapters
- merge automation
- write-trace recording
- transcript pagination

## Worktree Model

Execution worktrees live at:

```text
.hopi/worktrees/<goalKey>/<taskRef>/<runId>/
```

Rules:

- worktrees are derived from `HEAD`
- each run gets its own isolated worktree path
- cleanup removes both the worktree and its temporary branch

The manager may return an existing valid prepared worktree for the same run, but must not silently tolerate an arbitrary stale directory.

## Branch Model

Use a disposable local branch per run:

```text
hopi/<goalKey>/<taskRef>/<shortRunId>
```

This gives future merge logic a stable branch identity while keeping current cleanup straightforward.

## Process Runner Contract

`ProcessAgentRunner` implements `AgentRunner` by:

1. resolving an execution plan from the scheduler input
2. provisioning a worktree when the plan requests one
3. spawning the configured local process with `Bun.spawn`
4. streaming stdout as `message(level=info)`
5. streaming stderr as `message(level=error)`
6. mapping exit status to `AgentOutcome`

## Execution Plan

Keep the plan intentionally small:

- `cmd: string[]`
- `cwdMode: 'root' | 'worktree'`
- optional `env`
- optional `successArtifactRef`

Exit handling:

- exit code `0` -> `success`
- non-zero exit -> `fail`

This is enough for real process execution while leaving room for future adapter-specific parsing.

## Scheduler Integration

No scheduler redesign is needed in this slice.

The scheduler already:

- allocates `runId` and `stepId`
- passes an event sink to the adapter
- records streamed runtime evidence

This slice only needs the new process-backed runner to conform to that contract.

## Testing Strategy

Use real temporary git repositories in tests.

Required checks:

- worktree preparation creates an actual git worktree
- cleanup removes it cleanly
- process runner executes inside the intended directory
- stdout and stderr become step messages
- non-zero exit becomes `fail`

## Non-Goals

- no fake compatibility layer for deleted prototype runtime concepts
- no database
- no attempt to infer workflow transitions from logs
