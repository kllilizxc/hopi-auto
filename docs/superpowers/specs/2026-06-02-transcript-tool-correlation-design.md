# Transcript Tool Correlation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Strengthen durable run evidence by persisting stable tool invocation keys on normalized transcript events and correlating tool calls with their results across run detail and reviewer/merger context.

## Why This Slice Exists

The current system already supported:

- normalized transcript entries for Codex, Claude, and OpenCode transports
- durable run-history persistence for transcript summaries
- reviewer and merger context that included prior run-history transcript evidence

But one evidence gap still remained:

- transcript entries only exposed `summary`, `toolName`, and `vendorEventType`
- tool calls and tool results were persisted as unrelated flat transcript rows
- reviewer/merger context therefore saw strings like `Tool call: Bash | Command completed successfully.` without any durable proof that those lines described the same invocation

That kept transcript evidence weaker than the authority route used for write traces and workflow graphs.

## Constraints

- keep normalized transcript events file-native inside run history
- do not add a second transcript store or sidecar correlation registry
- preserve current transcript summary behavior for entries that do not represent tool interactions
- use stable invocation keys when vendor payloads expose them, rather than heuristically correlating every tool event by text alone

## Implemented Scope

### Stable `toolInvocationKey` On Normalized Transcript Events

Normalized transcript events now support optional `toolInvocationKey`.

This field is extracted during vendor normalization for tool interactions when a vendor payload exposes an invocation identifier such as:

- `call_id`
- `callId`
- `tool_call_id`
- `tool_use_id`
- nested invocation ids
- tool-use block `id` on call-side events

The same field now persists through:

- runtime events
- run-history transcript entries
- run-detail API responses
- Bun UI run-detail transcript inspection

### Correlated Tool Evidence In Review/Merge Context

Reviewer and merger run evidence no longer flatten keyed tool events into unrelated summaries.

When prior run-history transcript entries share one `toolInvocationKey`, context now renders one correlated interaction summary such as:

- `Bash [shell-1] -> Command completed successfully.`

This keeps transcript evidence compact while preserving the durable link between a tool call and its observed result.

Entries without a stable invocation key still fall back to the existing flat transcript summary path.

### No New Workflow Truth

Correlation is derived from durable transcript entries already stored in run history.

No new transcript registry, no second evidence file, and no mutable post-processing cache were introduced.

## Non-Goals

- inventing heuristic correlation for every unkeyed tool event
- parsing full tool arguments or stdout payloads into a separate structured tool log
- changing assistant-run transcript schemas, which already use a separate Goal assistant product path
- replacing write traces as the primary durable evidence source for file mutations

## Acceptance Criteria

- normalized Codex, Claude, and OpenCode tool transcript events persist `toolInvocationKey` when vendor payloads expose one
- run-detail API responses surface `toolInvocationKey` on stored transcript entries
- Bun UI transcript inspection can show the stable tool invocation key
- reviewer/merger context correlates keyed tool calls and results into one durable interaction summary
- unkeyed transcript entries still remain visible through the previous flat summary path
