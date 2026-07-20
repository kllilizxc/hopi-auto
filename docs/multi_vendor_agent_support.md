# Multi-Vendor Agent Adapter Contract

Status: implementation reference
Last updated: 2026-07-13

This document records only the vendor boundary. It does not define another workflow, Assistant
type, or session authority. Product behavior remains owned by
[the Assistant design](./mvp_assistant.md) and responsibility behavior by
[the execution design](./mvp_execution.md).

## One Contract

Codex, Claude, and OpenCode adapters must provide the same HOPI behavior:

- one prompt plus optional local image paths
- one injected `hopi` MCP server with the current turn capability
- normalized message, tool-call, tool-result, status, and error events
- provider-native thinking summaries normalized as internal status; count-only thinking progress
  and provider task-progress heartbeats are protocol noise and never substitute for a summary,
  plan snapshot, or tool event
- lossless raw stdout and stderr
- process-group cancellation and bounded termination
- writable Assistant-owned runtime and scratch, read-only linked and canonical roots, and network
  access under the same boundary for every provider
- speaking Assistant skills remain execution aids under a provider-level HOPI ownership contract;
  Reflection has no ambient skills, and provider apps/plugins/workflows never gain HOPI authority
- an optional vendor session ID for the speaking Assistant
- a final plain-text reply with provider thought envelopes removed, or an explicit transport failure
  when an envelope is malformed and cannot be separated without guessing

Vendor commands, event shapes, session flags, permission flags, and configuration files stay inside
the adapter. Canonical documents, Inbox ordering, Attention delivery, Reflection handoff, Work
results, and UI state never branch by vendor.

## Supported Transports

| Transport | Speaking resume | Images | HOPI MCP | Model setting |
| --- | --- | --- | --- | --- |
| Codex | native thread resume | native image arguments | injected CLI config | optional model plus reasoning effort |
| Claude | native session resume | local image references in the turn | injected MCP config | optional model |
| OpenCode | native session resume | local file arguments | injected MCP and permission config | optional model and variant |

Reflection uses the same configured transport and model but always starts a disposable session.
Responsibility Runs may use any supported transport independently through Home-wide role settings.
`process` remains a responsibility-only escape hatch and cannot run Assistant or Reflection because
it has no guaranteed conversation, MCP, or session contract.

## Configuration Rules

Home `assistant` configuration owns speaking Assistant and Reflection. Home `roles` owns Planner,
Generator, and Reviewer overrides; missing entries use Home `defaults`. Projects own no model
configuration.

The UI accepts free-form model identifiers because valid catalogs are vendor- and account-specific.
It preserves compatible advanced fields when changing a model. Switching transport drops
incompatible fields, installs safe defaults for the new adapter, and invalidates only the disposable
runtime session cache. Durable Inbox history remains the recovery source.

## Verification Bar

Each adapter needs a fake-CLI contract test covering a new turn, resume, tool activity, final reply,
image input, cancellation, malformed output, and raw transcript preservation. Shared end-to-end tests
must then prove that changing transport does not change Inbox handling, exact Attention
acknowledgement, Reflection delivery, or canonical HOPI tool effects.
