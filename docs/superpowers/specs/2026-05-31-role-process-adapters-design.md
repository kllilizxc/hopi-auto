# Role Process Adapters Design

Status: approved for implementation by the current project direction on 2026-05-31.

## Goal

Promote the current process substrate into the first real default runtime-adapter layer:

- provide concrete planner / generator / reviewer / merger command resolution
- assemble stable Goal/task context files for role processes
- ingest typed reviewer / merger outcomes without teaching the scheduler transport details

This moves HOPI from injected test runners toward a configurable product path that can later host real Claude / Codex / OpenCode adapters.

## Scope

This slice covers:

- a repo-local role adapter config file
- a Goal docs helper for `goal.md` and `design.md`
- a per-step runtime context bundle
- typed process outcome ingestion
- a default runner factory used by `createServer()`

This slice intentionally excludes:

- merge cleanup policy
- prompt compilation from `write-trace.jsonl`
- UI/API rendering of adapter config or context bundles
- transcript persistence beyond current runtime history

## Adapter Config

Configured adapters live at:

```text
.hopi/runtime/agent-adapters.json
```

Shape:

```json
{
  "version": 1,
  "roles": {
    "generator": {
      "cmd": ["some-binary", "--context", "${CONTEXT_FILE}", "--outcome", "${OUTCOME_FILE}"],
      "cwdMode": "worktree"
    }
  }
}
```

Rules:

- config is optional
- when config is absent, the backend may still fall back to `MockAgentRunner`
- each configured role resolves to one process command
- placeholder substitution is explicit and deterministic

## Goal Docs Bootstrap

Each Goal should have:

```text
.hopi/docs/goals/<goalKey>/goal.md
.hopi/docs/goals/<goalKey>/design.md
```

If a file is missing, the adapter layer should create a minimal bootstrap file rather than running without a durable Goal/design doc.

Bootstrap rules:

- `goal.md` is short and derived from the board goal metadata
- `design.md` starts as a minimal placeholder noting that durable design detail has not been recorded yet
- bootstrap is deterministic and idempotent

## Runtime Context Bundle

Each dispatched step gets a runtime bundle under:

```text
.hopi/runtime/goals/<goalKey>/runs/<runId>/<stepId>/
```

Files:

- `context.md`
- `outcome.json`

`context.md` should include:

- Goal key and title
- task ref, role, kind, title, description, and acceptance criteria
- paths to `goal.md` and `design.md`
- role-specific write boundaries

Baseline write boundaries:

- planner may edit `goal.md` and `design.md`
- generator, reviewer, and merger must not edit `.hopi/docs/**`

## Structured Outcome Contract

Role processes may write:

```json
{
  "kind": "success" | "reject" | "merge_conflict" | "fail" | "timeout",
  "reason": "optional human-readable explanation",
  "artifactRef": "optional artifact ref",
  "artifactLabel": "optional artifact label"
}
```

Rules:

- exit code `0` with no outcome file means `success`
- exit code `0` with an outcome file means parse the structured outcome
- non-zero exit still maps to `fail`
- typed outcomes are the mechanism for reviewer rejection and merger conflict signaling

## Default Runner Selection

`createServer()` should use a configured role-process runner when adapter config exists and validates.

Fallback behavior:

- configured adapter present -> use role-process runner
- config missing -> keep current `MockAgentRunner` fallback

This keeps local startup deterministic while making real adapters the default when intentionally configured.

## Testing Strategy

Use real temporary repositories and real process commands.

Required checks:

- missing `goal.md` / `design.md` are bootstrapped
- configured commands receive substituted context/outcome paths
- reviewer can return `reject` through `outcome.json`
- merger can return `merge_conflict` through `outcome.json`
- `createServer()` uses configured role adapters by default when config exists

## Non-Goals

- no compatibility layer for deleted schema fields
- no hidden scheduler mutations outside the current deterministic transition table
- no vendor-specific JSON-RPC transport in this slice
