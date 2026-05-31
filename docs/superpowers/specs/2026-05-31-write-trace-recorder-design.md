# Write Trace Recorder Design

Status: approved for implementation by the current project direction on 2026-05-31.

## Goal

Add the first durable `write-trace.jsonl` implementation for real task execution:

- record compact file-write evidence under Goal docs
- keep workflow truth in `todo.yml` and runtime transcript detail out of docs
- make the trace useful for later planner / generator / reviewer / merger context assembly

This moves HOPI closer to the long-term file-native model without binding write tracing to a specific LLM vendor or transcript transport.

## Scope

This slice covers:

- a Goal-scoped `write-trace.jsonl` path under `.hopi/docs/goals/<goalKey>/`
- a durable append-only store for compact write-trace entries
- a recorder that derives changed files from process execution before/after snapshots
- integration with `ProcessAgentRunner`

This slice intentionally excludes:

- transcript pagination
- UI rendering of write traces
- API endpoints for write-trace browsing
- vendor-specific tool-call normalization
- prompt compilation that consumes write traces

## Durable Path

Write traces live at:

```text
.hopi/docs/goals/<goalKey>/write-trace.jsonl
```

Rules:

- the file is append-only
- it is durable docs state, not runtime overlay
- it does not affect workflow transitions

## Entry Model

Each entry represents one compact write summary for a task step execution.

Required fields:

- `id`
- `timestamp`
- `goalKey`
- `runId`
- `stepId`
- `taskRef`
- `role`
- `agent`
- `cwd`
- `toolName`
- `callId`
- `targetPaths`
- `changes`
- `argumentSummary`
- `resultSummary`

`changes` is an array of:

- `path`
- `kind`: `added` | `modified` | `deleted`

The entry must not store full file contents.

## Change Detection

The first recorder implementation is process-oriented:

1. snapshot the selected execution directory before the process starts
2. snapshot the same directory after the process exits
3. compare file presence and file fingerprints
4. append a write-trace entry only when at least one file changed

Snapshot rules:

- ignore `.git/**`
- compare repo-relative paths
- detect `added`, `modified`, and `deleted`
- use a lightweight fingerprint based on file size and a content hash

This keeps the recorder independent from git cleanliness and works for both root-mode and worktree-mode execution.

## Process Runner Integration

`ProcessAgentRunner` should:

1. capture a snapshot before spawning the process
2. run the process and stream runtime events as it already does
3. capture a second snapshot after exit
4. append a compact write-trace entry when file changes are present

The recorder must not change `AgentOutcome`, scheduler transitions, or runtime message flow.

## Testing Strategy

Use real temporary repositories and real filesystem writes.

Required checks:

- a missing write-trace file reads as an empty trace
- appending entries creates valid JSONL
- process execution that writes files records changed paths
- process execution that does not write files records no trace entry
- write-trace recording works for worktree execution and root execution

## Non-Goals

- no compatibility layer for obsolete task schemas
- no replay system based on `write-trace.jsonl`
- no attempt to replace runtime transcripts with docs traces
