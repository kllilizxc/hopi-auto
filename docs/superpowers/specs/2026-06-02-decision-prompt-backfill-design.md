# Decision Prompt Backfill Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let stronger later authority surfaces backfill a missing canonical question onto an existing durable decision, without ever overwriting a prompt that has already been recorded.

## Why This Slice Exists

The current system already preserved `prompt` when a decision was first created or when a question-derived answer created a brand-new durable decision topic.

That still left one durability hole:

- existing decisions without `prompt` stayed prompt-less forever
- later `request_decision`, `record_answer`, `record_answers`, and explicit `resolve_decision` flows could carry a stronger canonical question
- runtime would reuse the existing decision key and answer it correctly, but `decisions.yml` would still drop that richer prompt authority

This especially weakened the newer question-grounded interpretation work, because an inferred question could resolve the current decision once but fail to strengthen the durable decision topic for the next turn.

## Constraints

- keep `decisions.yml` as the only durable decision-topic store
- do not add a parallel prompt registry or patch log
- never overwrite an existing decision prompt with a later variant
- keep behavior deterministic and narrow: this slice only backfills missing prompts

## Implemented Scope

### Store-Level Prompt Backfill

`DecisionStore` now exposes a narrow enrichment path for existing decisions:

- if `prompt` is missing and a non-empty prompt arrives later, persist it
- if `prompt` already exists, keep the original value

`resolveDecision(...)` also accepts optional `prompt` and applies the same backfill rule before persisting the resolved answer.

### Shared Runtime Coverage

The shared decision runtime now uses the same durable rule across all reuse paths:

- `requestGoalDecision(...)` backfills a missing prompt when reusing an existing decision key
- `answerGoalDecision(...)` and `answerGoalDecisions(...)` pass materialized prompts into durable resolution
- `resolveGoalDecision(...)` accepts optional `prompt` so explicit resolution can strengthen the durable decision topic too

### Product Surface Coverage

The product-facing entry points now preserve this substrate instead of dropping it:

- Bun API `POST /api/goals/:goalKey/decisions/:decisionKey/resolve`
- Goal assistant `resolve_decision`

Both surfaces now pass prompt authority all the way through materialization and into durable decision persistence.

## Non-Goals

- overwriting an existing prompt with a newer wording variant
- fuzzy prompt merging or prompt-history retention
- backfilling summaries, task refs, or other decision fields in this slice
- inferring brand-new prompts from looser prose without explicit or materialized question authority

## Acceptance Criteria

- an existing prompt-less durable decision can persist a later prompt during explicit resolution
- an existing prompt-less durable decision can persist a later prompt during `request_decision` reuse
- answer-driven reuse paths persist materialized prompts onto existing durable decisions
- once a decision already has a prompt, later resolutions do not overwrite it
