# HOPI Docs

Start with `docs/agent-handoff.md`.

## Active

- `docs/agent-handoff.md`: current handoff state for a zero-context agent.
- `docs/hopi-phase-1-authority.md`: canonical Phase 1 schema and backend boundaries.
- `docs/superpowers/plans/2026-05-31-hopi-takeover-stabilization-plan.md`: completed Phase 1 implementation plan and rationale.
- `docs/superpowers/specs/2026-05-31-run-history-and-bun-ui-design.md`: approved design for runtime history and the Bun UI.
- `docs/superpowers/plans/2026-05-31-run-history-and-bun-ui.md`: implementation plan for the runtime history and Bun UI slice.
- `docs/superpowers/specs/2026-05-31-execution-runtime-adapter-design.md`: approved design for the event-streaming execution adapter boundary.
- `docs/superpowers/plans/2026-05-31-execution-runtime-adapter.md`: implementation plan for the execution adapter slice.
- `docs/superpowers/specs/2026-05-31-process-runner-and-worktree-design.md`: approved design for the process-backed runner and git worktree substrate.
- `docs/superpowers/plans/2026-05-31-process-runner-and-worktree.md`: implementation plan for the process-backed runner and git worktree slice.
- `docs/superpowers/specs/2026-05-31-write-trace-recorder-design.md`: approved design for compact durable write-trace recording.
- `docs/superpowers/plans/2026-05-31-write-trace-recorder.md`: implementation plan for the write-trace recorder slice.
- `docs/superpowers/specs/2026-05-31-write-trace-consumers-design.md`: approved design for filtered trace queries, trace-aware context bundles, and UI/API surfacing.
- `docs/superpowers/plans/2026-05-31-write-trace-consumers.md`: implementation plan for the write-trace consumers slice.
- `docs/superpowers/specs/2026-05-31-role-process-adapters-design.md`: approved design for configured role-process adapters, context bundles, and typed outcomes.
- `docs/superpowers/plans/2026-05-31-role-process-adapters.md`: implementation plan for the role-process adapter slice.
- `docs/superpowers/specs/2026-05-31-vendor-transport-adapters-design.md`: approved design for built-in Codex / Claude / OpenCode transport adapters and durable `prompt.md` bundles.
- `docs/superpowers/plans/2026-05-31-vendor-transport-adapters.md`: implementation plan for the vendor transport adapter slice.
- `docs/superpowers/specs/2026-05-31-vendor-transcript-normalization-design.md`: approved design for structured vendor transcript normalization in step history.
- `docs/superpowers/plans/2026-05-31-vendor-transcript-normalization.md`: implementation plan for the vendor transcript normalization slice.
- `docs/superpowers/specs/2026-06-01-goal-assistant-and-planner-runtime-design.md`: approved design for the Goal assistant substrate and planner/runtime integration phase.
- `docs/superpowers/plans/2026-06-01-goal-assistant-substrate-slice.md`: implementation plan for the first Goal assistant substrate slice.
- `docs/superpowers/specs/2026-06-01-live-goal-assistant-execution-design.md`: approved and implemented design for explicit Goal assistant runtime execution.
- `docs/superpowers/plans/2026-06-01-live-goal-assistant-execution.md`: implementation plan for the live Goal assistant execution slice.
- `docs/superpowers/specs/2026-06-01-goal-assistant-surfacing-and-inspection-design.md`: approved and implemented design for assistant run inspection APIs and Bun UI surfacing.
- `docs/superpowers/plans/2026-06-01-goal-assistant-surfacing-and-inspection.md`: implementation plan for the assistant surfacing and inspection slice.
- `docs/superpowers/specs/2026-06-01-goal-assistant-preferences-and-planning-request-design.md`: approved and implemented design for repo preference editing plus safer assistant planning/preference actions.
- `docs/superpowers/plans/2026-06-01-goal-assistant-preferences-and-planning-request.md`: implementation plan for the preference and planner-request slice.
- `docs/superpowers/specs/2026-06-01-goal-assistant-decision-requests-and-management-design.md`: approved and implemented design for assistant decision requests and direct decision management on the Bun product path.
- `docs/superpowers/plans/2026-06-01-goal-assistant-decision-requests-and-management.md`: implementation plan for the decision-request and management slice.
- `docs/superpowers/specs/2026-06-01-decision-resolution-follow-through-and-reconcile-controls-design.md`: approved and implemented design for immediate decision-unblock follow-through and explicit reconcile controls.
- `docs/superpowers/plans/2026-06-01-decision-resolution-follow-through-and-reconcile-controls.md`: implementation plan for the decision follow-through and reconcile-control slice.
- `docs/superpowers/specs/2026-05-31-merge-execution-and-cleanup-design.md`: approved design for deterministic merger execution and settled-run cleanup.
- `docs/superpowers/plans/2026-05-31-merge-execution-and-cleanup.md`: implementation plan for the merger execution slice.

## Historical Reference

The following documents predate the Phase 1 rebuild and contain obsolete prototype details such as `candidate`, task status `blocked`, `dependencyTaskList`, `todo.mjs`, Express, or execa. Treat them as product background only.

- `docs/hopi-goal-kanban-assistant-unified-design.md`
- `docs/hopi-multi-agent-architecture.md`
- `docs/hopi-multi-agent-implementation-plan.md`
