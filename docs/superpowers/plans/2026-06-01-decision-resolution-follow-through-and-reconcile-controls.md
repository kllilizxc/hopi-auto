# Decision Resolution Follow-Through And Reconcile Controls Implementation Plan

Goal: remove dead time after decision answers by unblocking visible work immediately and exposing one explicit scheduler step on the active Bun product path.

Architecture: a shared decision-resolution helper updates both `decisions.yml` and visible board blockers, assistant and manual API routes reuse that helper, and the Bun UI adds an explicit `Reconcile Once` control backed by the existing single-step scheduler route.

Tech Stack: Bun, TypeScript, Bun test, Bun HTML import UI

Completed implementation tasks:

- [x] Add a shared decision-resolution helper that also removes linked visible blockers.
- [x] Route manual decision resolution and assistant `resolve_decision` through that helper.
- [x] Add server coverage proving resolved decisions unblock work immediately and allow next-step planner dispatch on a single reconcile.
- [x] Extend the Bun UI with an explicit `Reconcile Once` control and result summary.
- [x] Verify through failing tests first, full `bun run check`, and local product-path sanity checks.
