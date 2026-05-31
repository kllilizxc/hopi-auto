# HOPI Multi-Agent Collaboration: Implementation Plan
Status: Proposed
Date: 2026-05-29

This plan outlines the sequential phases to implement the multi-agent orchestration layer for the HOPI Goal system based on the finalized `hopi-multi-agent-architecture.md` design.

## Phase 1: Core Kanban Skill Hardening
*Ensure the foundation is safe for concurrent autonomous access.*
1. **Implement File Locking in `todo.mjs`:** 
   - Add a robust file-locking mechanism (e.g., `.lock` file with exponential backoff) to `~/.hopi/skills/kanban/todo.mjs`.
   - Update write operations to use temporary files and atomic `fs.renameSync` to prevent corruption during concurrent calls from the Assistant and Reconciler.
2. **Acceptance Criteria Schema:**
   - Update `yaml.mjs` and the `todo.yml` validation logic to require an `acceptance_criteria` array/string in the task `body` for engineering tasks to enforce granularity.

## Phase 2: State Segregation & Worktree Isolation
*Separate durable truth from ephemeral logs.*
1. **Migrate Ephemeral State:**
   - Update the existing backend to route session JSONL logs, runtime DB overlays, and tool traces to the global `~/.hopi/projects/<project-hash>/` directory.
   - Ensure the Web UI API reads session histories from this new global location.
2. **Worktree Provisioning Service:**
   - Create a service utility that executes `git worktree add .hopi/worktrees/task-<ref> <base-branch>`.
   - Implement cleanup logic (`git worktree remove`) to be called after a successful merge or task archive.

## Phase 3: The Deterministic Scheduler (Reconciler)
*Build the brain that orchestrates the agents.*
1. **Event Loop & Watcher:**
   - Implement the long-running Reconciler loop that tails `.hopi/docs/goals/**/todo.yml`.
   - Implement the SSE emitter that notifies connected Web UI clients to execute a REST refetch upon detected YAML changes.
2. **Task Eligibility Engine:**
   - Build the logic that maps task statuses (`planned`, `in_review`, `merging`) to available agent roles.
   - Implement checks for dependencies, blockers, and lane capacities before marking a task as dispatchable.
3. **Attempt Budgeting:**
   - Add DB schema/overlay fields for `attempt_count` and `max_attempts`.
   - Implement logic in the Reconciler to trap tasks reaching their limit and mutate their `todo.yml` state to `blocked: intervention_needed` via `todo.mjs`.

## Phase 3.5: Testing Strategy & Simulation
*Ensure the orchestrator handles race conditions and state management reliably.*
1. **Mock Agent Executable:**
   - Create `mock-agent.ts` with behaviors (`success-fast`, `success-slow`, `crash`, `mutate-board`, `infinite-loop`) to simulate LLM processes without cost or latency.
   - Update `AgentDispatcher` to support a test mode that spawns this mock instead of the real LLM.
2. **Time-Travel Integration Tests:**
   - Implement `tests/scheduler.test.ts` using `bun:test` mock timers.
   - Validate attempt budgets, timeouts, and state transitions (`planned` -> `in_progress` -> `in_review` -> `merging` -> `done`).
3. **End-to-End "Shadow Mode" Testing:**
   - Create a dummy project in `test/fixtures/` to run real LLMs against, verifying worktree isolation and context assembly without modifying the actual HOPI codebase.

## Phase 4: Agent Server Mode Integration
*Connect the workers to the factory.*
1. **Agent Dispatcher:**
   - Implement the adapter layer that spawns/resumes Claude Code (and others) in server mode.
   - Configure the agent execution environment to point its `cwd` to the generated Git worktree.
2. **Context Assembly:**
   - Build the prompt compiler that bundles `goal.md`, `design.md`, the task `body`, and upstream file paths (parsed from `write-trace.jsonl`).
   - Inject the strict boundaries prompt (e.g., "Do not edit .hopi/docs").
3. **Log Tailing:**
   - Ensure agent stdout/JSON-RPC events are seamlessly appended to the global session JSONL file for real-time Web UI streaming.

## Phase 5: The Lifecycle Pipelines
*Implement the specific behaviors for each task state.*
1. **Generator Pipeline (`planned` -> `in_progress`):**
   - Dispatch agent -> Agent completes -> Reconciler verifies zero exit code -> Reconciler calls `todo.mjs` to move task to `in_review`.
2. **Reviewer Pipeline (`in_progress` -> `in_review`):**
   - Dispatch Reviewer agent -> Evaluate worktree diff against Acceptance Criteria.
   - Handle Reject: Increment attempt budget -> Move back to `planned` (or `blocked` if budget exhausted).
   - Handle Accept: Move to `merging`.
3. **Merger Pipeline (`in_review` -> `merging` -> `done`):**
   - Dispatch Merger agent to handle Git merge from worktree to target branch.
   - Handle Conflicts: Increment attempt budget -> Move to `blocked` if exhausted.
   - Handle Success: Call `todo.mjs` to move to `done` and trigger worktree cleanup.

## Phase 6: Meta-Task Planning
*Enable agents to autonomously decompose work.*
1. **Planner Role Support:**
   - Update Reconciler to recognize the `planner` role metadata on `planned` tasks.
2. **Planning Output Adapter:**
   - Configure the Planner agent to propose new tasks within its session history.
   - Implement a specific Reviewer prompt tailored to checking task granularity (1-4 hours, clear acceptance criteria) rather than code logic.
3. **Plan Injection:**
   - Build the final step of the Planner workflow that translates approved task proposals into `todo.mjs` CLI calls to actually populate the kanban board.