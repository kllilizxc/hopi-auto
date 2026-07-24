# HOPI Documentation

## Current Authority

- [`mvp_design.md`](./mvp_design.md): product concepts, scope, accepted choices, UI, and scenarios.
- [`mvp_document_model.md`](./mvp_document_model.md): canonical home, Project, Goal, Work, Input,
  Attention, and Evidence documents.
- [`mvp_assistant.md`](./mvp_assistant.md): Home-configured Assistant conversation, HOPI tools,
  session recovery, Reflection, and Assistant UI behavior.
- [`mvp_execution.md`](./mvp_execution.md): fixed responsibilities,
  scheduling, worktrees, integration, completion, notification, and Preview.
- [`mvp_multi_repo.md`](./mvp_multi_repo.md): Project Repo membership, multi-root Work execution,
  the primary C1 release manifest, and projection recovery.
- [`multi_vendor_agent_support.md`](./multi_vendor_agent_support.md): adapter-only command, event,
  permission, image, MCP, and session contracts for supported model vendors.
- [`e2e_harness.md`](./e2e_harness.md): real-Agent E2E boundary, deterministic Harness, Project
  adapter, state invariants, evidence, and token-cost rules.
- [`e2e_test_cases.md`](./e2e_test_cases.md): zero-context E2E runbook, failure diagnosis, detailed
  HOPI scenario catalog, priorities, and acceptance criteria.
- [`mvp_publish_protocol.md`](./mvp_publish_protocol.md): single-Coordinator publication ADR and
  process-crash recovery rules.
- [`mvp_state_machine.md`](./mvp_state_machine.md): derived state charts, readiness, and Kanban
  projection.
- [`local_runtime_problem_catalog.md`](./local_runtime_problem_catalog.md): deduplicated local
  production-history problem catalog, current open records, evidence paths, code ownership, and
  downstream Project incidents for zero-context debugging.
- [`mvp_alignment_plan.md`](./mvp_alignment_plan.md): implementation evidence and cutover checklist;
  it is not a design authority.

## Historical Reference

`unified_design.md`, `agent-handoff.md`, `zero-context-continuation.md`, the Phase 1 documents,
deep dives, and `superpowers/**` preserve pre-MVP rationale. Their references to Assistant Actions,
decisions, planning requests, `todo.yml`, per-Run worktrees, merger, old server routes, the Vite
runtime, or writable React workflow screens are intentionally historical. Do not use them to infer
current state or extend the product.
