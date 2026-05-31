# hopi-claude

HOPI is a file-native autonomous goal orchestration prototype being rebuilt around a Bun-first deterministic core.

## Start Here

For a zero-context handoff, read:

`docs/agent-handoff.md`

The docs index is:

`docs/README.md`

## Phase 1

Phase 1 backend is implemented and verified, and the active Bun-served UI now reads the backend directly. The completed stabilization plan is:

`docs/superpowers/plans/2026-05-31-hopi-takeover-stabilization-plan.md`

The Phase 1 authority note is:

`docs/hopi-phase-1-authority.md`

The run-history design and implementation slice is documented in:

- `docs/superpowers/specs/2026-05-31-run-history-and-bun-ui-design.md`
- `docs/superpowers/plans/2026-05-31-run-history-and-bun-ui.md`

The execution-runtime and process-runner slices are documented in:

- `docs/superpowers/specs/2026-05-31-execution-runtime-adapter-design.md`
- `docs/superpowers/plans/2026-05-31-execution-runtime-adapter.md`
- `docs/superpowers/specs/2026-05-31-process-runner-and-worktree-design.md`
- `docs/superpowers/plans/2026-05-31-process-runner-and-worktree.md`

The durable write-trace slice is documented in:

- `docs/superpowers/specs/2026-05-31-write-trace-recorder-design.md`
- `docs/superpowers/plans/2026-05-31-write-trace-recorder.md`

The write-trace consumers slice is documented in:

- `docs/superpowers/specs/2026-05-31-write-trace-consumers-design.md`
- `docs/superpowers/plans/2026-05-31-write-trace-consumers.md`

The configured role-process adapter slice is documented in:

- `docs/superpowers/specs/2026-05-31-role-process-adapters-design.md`
- `docs/superpowers/plans/2026-05-31-role-process-adapters.md`

The vendor transport adapter slice is documented in:

- `docs/superpowers/specs/2026-05-31-vendor-transport-adapters-design.md`
- `docs/superpowers/plans/2026-05-31-vendor-transport-adapters.md`

The vendor transcript normalization slice is documented in:

- `docs/superpowers/specs/2026-05-31-vendor-transcript-normalization-design.md`
- `docs/superpowers/plans/2026-05-31-vendor-transcript-normalization.md`

The Goal assistant and planner-runtime design plus the first implemented substrate slice are documented in:

- `docs/superpowers/specs/2026-06-01-goal-assistant-and-planner-runtime-design.md`
- `docs/superpowers/plans/2026-06-01-goal-assistant-substrate-slice.md`

The live Goal assistant execution slice is documented in:

- `docs/superpowers/specs/2026-06-01-live-goal-assistant-execution-design.md`
- `docs/superpowers/plans/2026-06-01-live-goal-assistant-execution.md`

The Goal assistant surfacing and inspection slice is documented in:

- `docs/superpowers/specs/2026-06-01-goal-assistant-surfacing-and-inspection-design.md`
- `docs/superpowers/plans/2026-06-01-goal-assistant-surfacing-and-inspection.md`

The Goal assistant preference and planner-request slice is documented in:

- `docs/superpowers/specs/2026-06-01-goal-assistant-preferences-and-planning-request-design.md`
- `docs/superpowers/plans/2026-06-01-goal-assistant-preferences-and-planning-request.md`

The Goal assistant decision-request and management slice is documented in:

- `docs/superpowers/specs/2026-06-01-goal-assistant-decision-requests-and-management-design.md`
- `docs/superpowers/plans/2026-06-01-goal-assistant-decision-requests-and-management.md`

The decision follow-through and explicit reconcile-control slice is documented in:

- `docs/superpowers/specs/2026-06-01-decision-resolution-follow-through-and-reconcile-controls-design.md`
- `docs/superpowers/plans/2026-06-01-decision-resolution-follow-through-and-reconcile-controls.md`

The trace-aware review and merge policy slice is documented in:

- `docs/superpowers/specs/2026-06-01-write-trace-aware-review-and-merge-policy-design.md`
- `docs/superpowers/plans/2026-06-01-write-trace-aware-review-and-merge-policy.md`

The Goal docs inspection and planner doc-status slice is documented in:

- `docs/superpowers/specs/2026-06-01-goal-docs-inspection-and-planner-doc-status-design.md`
- `docs/superpowers/plans/2026-06-01-goal-docs-inspection-and-planner-doc-status.md`

The deterministic merge execution slice is documented in:

- `docs/superpowers/specs/2026-05-31-merge-execution-and-cleanup-design.md`
- `docs/superpowers/plans/2026-05-31-merge-execution-and-cleanup.md`

## Commands

Install dependencies:

```sh
bun install
```

Run the backend and Bun UI:

```sh
bun run dev
```

Run all Phase 1 checks:

```sh
bun run check
```

Start the backend:

```sh
cd packages/backend
bun run start
```

Then open:

```text
http://localhost:3000
```
