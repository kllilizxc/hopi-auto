# HOPI Multi-Vendor Agent Support

Status: adapter contract authority
Last updated: 2026-08-14

Vendor support is an adapter concern. HOPI has two configurable agents—`assistant` and `worker`—and
one semantic model regardless of provider.

## Configuration

Home configuration contains shared coding defaults plus optional Assistant and Worker transport
overrides. Assistant must use a built-in Codex, Claude, or OpenCode transport at the Home/Project
root. Worker may also use a process adapter and always runs at its declared worktree boundary.

Provider names, models, reasoning effort, permission modes, binary paths, and native session ids
never enter Goal or Work authority.

## Common invocation

Every invocation receives the same logical inputs:

- natural-language assignment and bounded context files;
- explicit execution envelope and readable/writable roots;
- canonical mutation through HOPI tools only for Assistant;
- declared `workspaceMode` for Worker;
- optional images and managed-browser facts;
- complete local transcript and normalized public events.

The adapter translates this contract into provider CLI arguments, stdin, environment, permissions,
MCP configuration, and final-output capture.

## Sessions and compaction

Assistant provider sessions are disposable context caches for one visible Project conversation.
They may resume, compact, hand off, fork for supervision, or rebuild from bounded public history and
canonical state.

A Worker Run has a fresh session namespace. Native compaction may continue inside that Run, but no
later Run shares its session. If the execution boundary changes or a provider rejects resume, HOPI
invalidates the cache and restarts from the same immutable Run assignment.

## Normalized facts

Adapters normalize provider output into message, transcript, and optional provider-plan events;
execution identity; final natural-language Report; usage diagnostics; termination; and native
session id. Provider plans are observational progress only, never HOPI planning authority.

Secrets are redacted before public or persistent diagnostics. A transport error settles the
Assistant turn or Worker Run factually; adapters do not map errors into Work transitions, retries,
or Attention.

## Process adapter

The process transport is a Worker-only escape hatch. It receives the same environment and bounded
paths, but has no assumed native session or multimodal support. It must emit a final response or
write Markdown to `HOPI_REPORT_FILE`.
