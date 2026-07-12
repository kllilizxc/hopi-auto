# HOPI Pre-MVP Unified Design

Status: historical; superseded on 2026-07-11

The implementation described by the former unified design has been removed. Its Goal-scoped
Assistant Actions, `todo.yml` board authority, decision and planning-request stores, per-Run
worktrees, reviewer/merger flow, old server, and separate React/Vite frontend are not compatibility
surfaces.

Current design authority is split by concern so each document remains searchable:

- [MVP product design](./mvp_design.md)
- [Assistant conversation and tools](./mvp_assistant.md)
- [canonical document model](./mvp_document_model.md)
- [execution design](./mvp_execution.md)
- [publication protocol](./mvp_publish_protocol.md)
- [derived state machines](./mvp_state_machine.md)

The historical implementation record remains in [agent-handoff.md](./agent-handoff.md) and
[zero-context-continuation.md](./zero-context-continuation.md) when provenance is needed. Those
files are evidence, not live design.
