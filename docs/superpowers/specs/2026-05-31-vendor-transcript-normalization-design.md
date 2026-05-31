# Vendor Transcript Normalization Design

Status: approved for implementation
Date: 2026-05-31

## Goal

Normalize built-in Codex, Claude Code, and OpenCode machine-readable output streams into richer step-history transcripts instead of persisting raw vendor lines as plain messages.

## Why This Slice Exists

The current runtime adapter boundary can execute real vendor CLIs, but built-in transports still behave like raw line pipes once the process starts:

- Codex `--json` lines would currently be stored as opaque strings
- Claude `stream-json` events would currently be stored as opaque strings
- OpenCode `--format json` events would currently be stored as opaque strings

That loses the value of the transport-aware phase we just added. The next long-term step is not a transcript database or session daemon. It is a deterministic, Goal-local transcript model that extracts the stable meaning of those vendor streams.

## In Scope

- add a normalized transcript entry model to run history
- parse built-in transport stdout streams into transcript entries
- keep raw plain-process output on the existing message path
- persist normalized transcripts on each step
- surface transcripts through existing run detail API responses
- render transcripts in the Bun UI

## Out of Scope

- exact replay of vendor-native event payloads
- long-lived session resume or conversational thread state
- database-backed transcript storage
- transcript search, filtering, or secondary indexes
- replacing scheduler system messages

## Design

### 1. Step History Gains Transcript Entries

Each `GoalRunStep` should gain a `transcript` array.

Each transcript entry stores:

- `entryId`
- `createdAt`
- `transport`: `codex | claude | opencode | process`
- `kind`: `status | assistant | tool_call | tool_result | error`
- `summary`
- optional `toolName`
- optional `vendorEventType`

This is intentionally compact. It is richer than raw lines but still stable enough to keep in Goal-local runtime files.

### 2. Runtime Events Gain a Transcript Variant

`AgentRuntimeEvent` should add a `transcript` variant so the scheduler stays transport-agnostic while the process runner can emit normalized structured transcript entries.

The existing `message`, `artifact`, and `worktree_prepared` events remain unchanged.

### 3. Process Runner Parses Vendor Formats

`ProcessAgentCommand` should carry an optional transcript format:

- `plain`
- `codex_jsonl`
- `claude_stream_json`
- `opencode_json`

For built-in vendor transports:

- Codex command resolution should enable `--json`
- Claude keeps `--output-format stream-json`
- OpenCode keeps `--format json`

The process runner should parse stdout line-by-line according to the command transcript format:

- `plain`: keep existing message behavior
- vendor formats: emit normalized transcript events instead of raw JSON-line messages

For plain stderr on built-in vendor transports, emit transcript `error` entries.

### 4. Parser Scope

This slice should normalize only stable, high-signal concepts:

- assistant text
- tool invocation
- tool result
- status milestones
- errors

It should not attempt to preserve full raw payloads or every vendor-specific field.

Codex parsing can use the currently installed CLI’s `thread/started`, `item/completed`, and `turn/completed` event families.

Claude parsing can use the documented `assistant`, `user`, and `result` `stream-json` events, especially `text`, `tool_use`, and `tool_result` blocks.

OpenCode parsing should use a conservative heuristic model:

- parse obvious `assistant`/`message` text content
- parse obvious tool-use / tool-result shapes
- otherwise fall back to normalized `status` or `error` entries

That keeps OpenCode support useful without pretending we have a stronger schema guarantee than we do today.

### 5. Bun UI

The selected step pane should show transcript entries before the lower-level message stream.

Messages remain useful for:

- scheduler system messages
- plain process output
- any unstructured fallback lines

Transcripts become the primary place to inspect built-in vendor execution.

## Testing Strategy

- parser unit tests for Codex, Claude, and OpenCode sample events
- process-runner test proving built-in vendor JSON lines emit transcript events
- run-history test proving transcript events persist on steps
- API test proving run detail includes normalized transcript entries

## Acceptance Criteria

- built-in vendor transports no longer persist raw JSON lines as plain step messages
- run history persists structured transcript entries on steps
- Codex, Claude, and OpenCode each have parser coverage
- Bun UI renders transcript entries for selected steps
- `bun run check` passes
