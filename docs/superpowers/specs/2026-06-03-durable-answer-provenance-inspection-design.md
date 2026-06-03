# Durable Answer Provenance Inspection Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Turn persisted interpreted-answer provenance into a first-class inspection surface, so durable `captureFormat` metadata is visible in planner context and Bun inspection UI instead of living only inside raw durable files.

## Why This Slice Exists

The previous provenance slice closed the storage gap:

- resolved durable decisions now persist `captureFormat`
- materialized durable planner-answer rows now persist `captureFormat`

That made interpreted-answer provenance durable, but not yet truly inspectable.

One authority gap still remained:

- planner role context still summarized captured answers as summary-plus-text only
- parsed planner context did not call out decision-level `captureFormat`
- Bun decision cards did not show how a resolved answer had been captured
- Bun planning request and workflow inspection summaries also hid answer-level `captureFormat`

So the system had durable provenance, but humans and downstream agents still had to read raw YAML or know the store schema to notice it.

The authority route should surface persisted provenance on the same inspection surfaces where durable answers themselves are already reviewed.

## Constraints

- reuse the persisted `captureFormat` on durable rows; do not recompute provenance in UI or context builders
- keep the exact enum string visible instead of replacing it with lossy prose
- do not introduce a separate provenance index or audit log
- keep workflow and planning-request inspection aligned, since workflow shared answers eventually materialize onto request rows

## Implemented Scope

### Planner Role Context

Planner context now exposes interpreted-answer provenance in two places:

- `### Parsed Decisions` now lists each durable decision with status, prompt, task, answer, and `Answer capture format` when present
- relevant planning requests and related planning groups now render both:
  - `Workflow-shared answers`
  - `Captured answers`

for each answer entry with:

- summary
- optional prompt
- exact `captureFormat`
- materialized answer text

That means planner, reviewer, and merger prompts no longer need to infer from raw `planning-requests.yml` whether a captured answer came from `matching_runs`, `question_blocks`, `pending_answer_sources`, or another deterministic surface.

### Bun Decision Inspection

Bun decision cards now surface:

- `Answer capture format: <captureFormat>`

whenever a resolved durable decision carries persisted interpreted-answer provenance.

Open decisions stay unchanged.

### Bun Planning Request And Workflow Inspection

Bun planning request and workflow summaries now include exact `captureFormat` metadata on:

- request-level captured answers
- workflow-shared captured answers

This applies to:

- standalone planning requests
- workflow child requests
- workflow-root shared answers

The same answer-summary helper now carries prompt plus durable provenance instead of flattening everything to summary-plus-text.

### API Readback Guarantees

Readback surfaces already reuse raw durable state, but this slice locks that contract in with explicit tests on:

- `GET /api/goals/:goalKey/decisions`
- `GET /api/goals/:goalKey/planning-requests`
- `GET /api/goals/:goalKey/planning-requests/workflows`
- `GET /api/goals/:goalKey/planning-requests/workflows/:workflowKey`

So inspection surfaces remain covered even if later refactors try to trim or reshape answer payloads.

## Example

If runtime materializes:

- one resolved decision from `matching_closing_runs`
- one planner answer from `matching_runs`
- one workflow-shared planner answer from `question_blocks`

then after this slice:

- the decision card shows `Answer capture format: matching_closing_runs`
- planner context shows the parsed decision with `Answer capture format: matching_closing_runs`
- planner context shows the captured planner answer as `... [captureFormat=matching_runs]: ...`
- workflow inspection shows the shared answer as `... [captureFormat=question_blocks]: ...`

without recomputing any of that from the original reply.

## Non-Goals

- inventing humanized alias labels for capture formats
- changing parser behavior or format selection
- surfacing rejected `auto` candidates
- creating a second provenance-only endpoint

## Acceptance Criteria

- planner role context surfaces persisted decision and planner-answer `captureFormat` metadata in human-readable parsed sections
- Bun decision cards surface resolved decision `captureFormat`
- Bun planning request and workflow summaries surface answer-level `captureFormat`
- API readback tests prove durable provenance survives list/detail inspection for decisions, planning requests, and workflow graphs
