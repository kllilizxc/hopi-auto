# Vendor Transport Adapters Design

Status: approved for implementation
Date: 2026-05-31

## Goal

Add the first vendor-aware transport layer on top of the current configured role-process runner so HOPI can run real non-interactive Codex, Claude Code, and OpenCode sessions without forcing every repo to hand-author fragile `cmd[]` arrays.

## Why This Slice Exists

The current `ConfiguredRoleProcessRunner` is already useful, but it is still too close to a raw process wrapper:

- every role config must hand-build CLI flags
- prompt assembly is implicit and transport-specific
- there is no stable built-in path for real Codex / Claude / OpenCode execution

That makes the product path brittle and difficult to verify. The next long-term step is not a queue, not a daemon, and not a compatibility shim. It is a deterministic transport abstraction that:

- keeps the scheduler transport-agnostic
- keeps file-native Goal docs and runtime bundles authoritative
- turns vendor CLIs into stable, testable command builders

## In Scope

- add a built-in transport config model for:
  - `process`
  - `codex`
  - `claude`
  - `opencode`
- generate a durable `prompt.md` in each role runtime bundle
- let `ProcessAgentRunner` pipe prompt content into child stdin when a transport needs it
- resolve vendor transports into deterministic command arrays and env vars
- allow a transport-specific binary override for testing and local setup
- keep typed `outcome.json` as the workflow contract across all transports

## Out of Scope

- parsing every vendor JSON event stream into a normalized transcript model
- long-lived session resume or daemon orchestration
- remote-control transports, app servers, or JSON-RPC bridges
- provider credential management or login flows
- replacing the existing raw `process` transport path

## Design

### 1. Runtime Bundle Adds `prompt.md`

Each role bundle under:

```text
.hopi/runtime/goals/<goalKey>/runs/<runId>/<stepId>/
```

already contains `context.md` and `outcome.json`.

This slice adds:

```text
prompt.md
```

`prompt.md` is transport-facing and self-contained. It should:

- identify the HOPI role, Goal, task, and current workflow boundary
- instruct the agent to use repository state plus the bundled context files
- explicitly require writing a structured outcome JSON to `outcome.json`
- embed the current `context.md` content so stdin/arg-based CLIs do not need extra wrapper logic

`context.md` remains the durable per-step context artifact. `prompt.md` is the executable transport prompt built from it.

### 2. Transport Config Becomes Explicit

Role entries in `.hopi/runtime/agent-adapters.json` should support these shapes:

```json
{
  "transport": "process",
  "cmd": ["bun", "-e", "..."],
  "cwdMode": "worktree"
}
```

```json
{
  "transport": "codex",
  "cwdMode": "worktree",
  "model": "gpt-5-codex",
  "sandbox": "workspace-write",
  "approvalPolicy": "never"
}
```

```json
{
  "transport": "claude",
  "cwdMode": "worktree",
  "permissionMode": "dontAsk"
}
```

```json
{
  "transport": "opencode",
  "cwdMode": "worktree"
}
```

Common fields:

- `cwdMode`
- `baseRef`
- optional `binary`

`binary` defaults to the real CLI name and exists for deterministic local overrides and tests.

### 3. Command Resolution

The configured runner should no longer hand-inline all resolution logic. A focused transport resolver should:

- accept the parsed role config plus the prepared runtime bundle
- return the final `ProcessAgentCommand`
- decide whether prompt content is passed as stdin or as an argv string

Transport defaults:

- `process`: keep existing behavior
- `codex`: `codex exec ... -` and pass `prompt.md` through stdin
- `claude`: `claude --print ...` and pass `prompt.md` through stdin
- `opencode`: `opencode run ... "<prompt contents>"`

All transports continue to rely on `outcome.json` for final structured workflow state.

### 4. `ProcessAgentRunner` Supports Stdin

`ProcessAgentCommand` gains optional `stdin`.

When present, the process runner should:

- spawn the child with piped stdin
- write the provided prompt text
- close stdin before awaiting process completion

This keeps prompt transport simple and avoids shell wrappers.

## Testing Strategy

- unit test command resolution for `codex`, `claude`, and `opencode`
- integration test that a configured `codex` transport can run against a mock binary, consume stdin prompt content, and still return typed `outcome.json`
- unit/integration test that `ProcessAgentRunner` pipes stdin correctly
- extend context-bundle tests to prove `prompt.md` is created and references `outcome.json`

## Acceptance Criteria

- role bundles include `prompt.md`
- built-in vendor transport configs resolve without hand-authored raw `cmd[]`
- `ProcessAgentRunner` can feed prompt stdin into child processes
- at least one built-in transport is proven end-to-end through the configured runner
- the scheduler and board workflow model remain unchanged
