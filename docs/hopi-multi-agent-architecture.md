# HOPI Multi-Agent Collaboration Architecture
Status: Proposed
Date: 2026-05-29

## Overview
This document details the architecture for enabling 24/7 non-stop, autonomous multi-agent collaboration within the file-native HOPI Goal system. It leverages Claude Code (and other coding agents) running in server mode, orchestrated by a deterministic central scheduler, to drive tasks from `planned` to `done` without requiring human intervention, unless explicitly requested or when attempt budgets are exhausted.

## Core Principles
1. **File-Native Truth:** `todo.yml`, `design.md`, and `events.jsonl` located in the project repository (`.hopi/docs/`) remain the absolute source of truth.
2. **Ephemeral Isolation:** Noisy runtime logs, session histories, and databases live globally in `~/.hopi/projects/<project-hash>/`. Agents execute in isolated Git worktrees.
3. **Deterministic Orchestration:** Agents do not self-organize or poll the board. A central Scheduler dictates when agents start, resume, or stop based on the kanban state.
4. **Planning as a Meta-Task:** Planning is modeled as a standard task on the board, subject to the same generation, review, and execution lifecycle as engineering tasks.

## System Components

### 1. The Scheduler (Reconciler)
The Scheduler is a long-running, deterministic Node.js control loop.
- **Responsibilities:**
  - Watches `.hopi/docs/goals/**` for changes to `todo.yml` and `decisions.yml`.
  - Determines task eligibility (dependencies met, not blocked, lane capacity available).
  - Spawns or resumes agent sessions (via MCP/RPC) to execute eligible tasks.
  - Monitors agent completion and invokes the local `todo.mjs` kanban skill to update task statuses (e.g., `in_progress` -> `in_review`).
  - Emits SSE events to the Web UI upon board mutations, triggering a REST refetch.

### 2. Server Mode Agents
Agents (Claude Code, Codex, OpenCode) run as continuous server processes communicating with the Scheduler.
- **Context Injection:** Upon dispatch, the Scheduler provides:
  1. The Goal context (`goal.md`, `design.md`).
  2. The specific Task `title` and `body` (including Acceptance Criteria).
  3. Upstream dependency file contexts (derived from `write-trace.jsonl`).
- **Execution:** The agent's sole directive is to fulfill the task criteria and exit. Agents are strictly forbidden from modifying `.hopi/docs/` directly.

### 3. Worktree Isolation & Ephemeral State
To protect the main repository and prevent concurrent execution conflicts:
- When the Scheduler dispatches an agent for a code-altering task, it creates a temporary Git worktree (e.g., `.hopi/worktrees/task-<ref>`).
- The agent operates exclusively within this worktree.
- Agent stdout/stderr and JSON-RPC session messages are streamed via **File Tailing (JSONL logs)** directly to `~/.hopi/projects/<project-hash>/sessions/<session-id>.jsonl`. The Web UI paginates and streams from these out-of-repo files.

### 4. The Lifecycle Pipeline
Tasks flow through canonical states, each managed by a specific agent role:
- `planned` -> `in_progress`: **Generator Agent** writes code.
- `in_progress` -> `in_review`: **Reviewer Agent** evaluates code against Acceptance Criteria.
- `in_review` -> `merging`: If Reviewer accepts, **Merger Agent** resolves conflicts and merges the worktree back to the target branch.
- `merging` -> `done`: Fully autonomous completion.

### 5. Infinite Loop Prevention (Attempt Budgets)
To prevent endless ping-pong between Generator and Reviewer:
- A `max_attempts` budget (e.g., 3) is tracked in the DB runtime overlay.
- Rejections by the Reviewer or unresolvable conflicts by the Merger increment the counter.
- Upon exhaustion, the Scheduler moves the task to `blocked` (reason: `intervention_needed`), pausing execution on that task and surfacing an intervention to the Goal Assistant for the human to resolve.

### 6. Assistant & Concurrency
- The Goal Assistant (and user quick actions) can mutate the board, but *only* by executing `~/.hopi/skills/kanban/todo.mjs`.
- `todo.mjs` implements strict file-system locking (atomic `fs.renameSync` with exponential backoff retries) to prevent race conditions between the Assistant and the Reconciler.

### 7. Meta-Task Planning
To prevent agents from creating overly broad or infinitely granular tasks, planning is treated as a standard workflow task.
- **Flow:** Assistant creates a task (e.g., "Plan Auth Feature", role: `planner`).
- **Generator (Planner):** Proposes new tasks and updates to `design.md`. The debate and reasoning are captured in this task's underlying session history.
- **Reviewer:** Checks proposed tasks against "Goldilocks" rules (must have clear Acceptance Criteria, 1-4 hours effort).
- **Merger:** Once approved, the meta-task calls `todo.mjs` to inject the new engineering tasks into `todo.yml` and marks the meta-task as `done`.