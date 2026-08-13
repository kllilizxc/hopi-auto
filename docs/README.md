# HOPI Documentation

## Current Authority

- [`mvp_design.md`](./mvp_design.md): the Work-preserving product topology, durable concepts,
  deterministic boundaries, UI invariants, and migration order.
- [`mvp_evolution_acceptance.md`](./mvp_evolution_acceptance.md): required regression trajectories
  and implementation gates.

These two documents define one current product model. `mvp_design.md` owns behavior;
`mvp_evolution_acceptance.md` owns proof. A test or implementation note cannot redefine the model.

## Narrow Delegated Contracts

The following existing documents remain authoritative only for the named mechanical boundary and
only where they do not conflict with `mvp_design.md`:

- [`mvp_project_runtime.md`](./mvp_project_runtime.md): existing Project Prepare and Preview
  capability.
- [`multi_vendor_agent_support.md`](./multi_vendor_agent_support.md): provider adapter command,
  event, permission, and transport behavior.
- [`mvp_publish_protocol.md`](./mvp_publish_protocol.md): current single-Coordinator publication
  mechanics until each cross-root side effect moves behind a typed Operation.
- [`e2e_harness.md`](./e2e_harness.md): test process, evidence, cleanup, and cost accounting.

Delegation does not revive fixed Planner/Generator/Reviewer scheduling, Work-count progress,
mandatory Review, synthetic C1 ancestry, or provider Session authority.

## Implementation Baseline

These documents describe the restored Work-based implementation and are useful code-reading maps:

- [`mvp_document_model.md`](./mvp_document_model.md)
- [`mvp_assistant.md`](./mvp_assistant.md)
- [`mvp_project_owner.md`](./mvp_project_owner.md)
- [`mvp_execution.md`](./mvp_execution.md)
- [`mvp_state_machine.md`](./mvp_state_machine.md)
- [`mvp_multi_repo.md`](./mvp_multi_repo.md)
- [`e2e_test_cases.md`](./e2e_test_cases.md)
- [`backend_hopi_core_code_guide.zh-CN.md`](./backend_hopi_core_code_guide.zh-CN.md)

They are deliberately retained while code migrates, but they are not product authority. Statements
that require a fixed delivery workflow are historical implementation facts, not target behavior.
When a migration phase changes a boundary, update or retire its baseline document in the same
change; do not create a second permanent compatibility specification.

## Historical Evidence

- [`local_runtime_problem_catalog.md`](./local_runtime_problem_catalog.md)
- [`runtime_observation_2026-07-25.md`](./runtime_observation_2026-07-25.md)
- [`e2e_test_issues.md`](./e2e_test_issues.md)
- [`e2e_regression_report_2026-07-14.md`](./e2e_regression_report_2026-07-14.md)

Historical evidence explains why a regression exists. It cannot define current storage, lifecycle,
routing, or scheduling behavior.
