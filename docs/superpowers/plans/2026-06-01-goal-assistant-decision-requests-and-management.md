# Goal Assistant Decision Requests And Management Implementation Plan

Goal: extend the Goal assistant/product path with explicit decision requests, manual file-native decision management, and visible decision blocker follow-through on planning work.

Architecture: a shared decision-request control path coordinates `decisions.yml` and `todo.yml`, assistant gains a structured `request_decision` action, the server exposes a direct decision-creation API, and the Bun UI consumes that same surface for create/resolve flows plus SSE refresh.

Tech Stack: Bun, TypeScript, Bun test, Bun HTML import UI

Completed implementation tasks:

- [x] Add a shared decision-request helper that can create/reuse decision topics and optionally link visible task blockers.
- [x] Add assistant action support for `request_decision`.
- [x] Add `POST /api/goals/:goalKey/decisions`.
- [x] Broadcast `decisions_changed` SSE events for create/resolve flows.
- [x] Extend the Bun UI with direct decision creation and inline decision resolution.
- [x] Verify through failing server tests first, full `bun run check`, and local product-path sanity checks.
