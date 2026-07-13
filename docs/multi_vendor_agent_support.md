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
- lossless raw stdout and stderr
- process-group cancellation and bounded termination
- read-only access to exact canonical and diagnostic paths under Assistant Home
- an optional vendor session ID for the speaking Assistant
- a final plain-text reply or an explicit transport failure

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
Responsibility Runs may use any supported transport independently through Project defaults or Home
role overrides. `process` remains a responsibility-only escape hatch and cannot run Assistant or
Reflection because it has no guaranteed conversation, MCP, or session contract.

## Configuration Rules

Home `assistant` configuration owns speaking Assistant and Reflection. Project `codingDefaults`
owns only Planner, Generator, and Reviewer defaults. Editing one never silently changes the other.

The UI accepts free-form model identifiers because valid catalogs are vendor- and account-specific.
It preserves compatible advanced fields when changing a model. Switching transport drops
incompatible fields, installs safe defaults for the new adapter, and invalidates only the disposable
runtime session cache. Durable Inbox history remains the recovery source.

## Verification Bar

Each adapter needs a fake-CLI contract test covering a new turn, resume, tool activity, final reply,
image input, cancellation, malformed output, and raw transcript preservation. Shared end-to-end tests
must then prove that changing transport does not change Inbox handling, exact Attention
acknowledgement, Reflection delivery, or canonical HOPI tool effects.
