# Deterministic E2E Harness

Status: first executable experiment

## Goal

Run fixed HOPI delivery scenarios repeatedly without model calls. The default suite proves system
orchestration and leaves model capability to a separate, explicitly invoked live canary.

The Harness is test infrastructure, not product workflow. It adds no canonical document, Kanban
state, role, queue, scenario DSL, or production fault-injection route.

## Layers

The general HOPI layer owns an isolated Home and fixture Repo, public API input, Coordinator,
canonical publication, stable task worktrees, Attempt logs, C1, and semantic assertions. It replaces
only `AssistantModelRunner` and `RoleRunner` with deterministic test implementations at the existing
dependency-injection seams.

The optional Project layer remains an executable `scripts/hopi/e2e` adapter that can validate a
running Project Preview with the Project's native test stack. The first experiment deliberately
does not add this adapter: it proves the general layer before defining another Project contract.

## Deterministic Agent Boundary

The scripted Assistant must call the real per-turn HOPI tool endpoint using its issued token. It may
not mutate Assistant workspace, Goal packages, or runtime state directly.

The scripted responsibilities obey the same write boundaries as a model Run:

- Planner stages sparse canonical proposals.
- Generator changes only its assigned task worktree.
- Reviewer inspects without writing and returns a responsibility result.
- Coordinator remains the only publisher and Git integration authority.

The script fixes effects required by the scenario, not model wording or incidental tool order.

## First Scenario

`goal-delivery` starts the production HTTP server against a new temporary Home and a clean fixture
Repo, then:

1. links the fixture through the public Project API;
2. posts one ordinary user instruction to `/api/inbox`;
3. lets the deterministic Assistant call `hopi_create_goal`;
4. lets real reconciliation run deterministic Planner, Generator, Reviewer, C1, and final Planner;
5. polls public state until the Goal is `done` without timing sleeps as assertions;
6. verifies the managed integration contains the delivered source while the user checkout remains
   clean and unchanged;
7. verifies the expected responsibility sequence and durable Attempt history.

The scenario consumes zero model tokens. It proves delivery mechanics, not whether a configured
model can infer the same actions from an unseen request.

## Command And Failure Evidence

`bun run e2e` runs only deterministic system E2E scenarios. The ordinary `bun run check` also runs
the scenario so a fixed delivery regression cannot pass the default gate.

The first experiment relies on existing durable Home, Goal, Attempt, and transcript files for
diagnosis. A later iteration may add a concise failure report and retained fixture switch, but must
not copy those facts into another durable test-result model.
