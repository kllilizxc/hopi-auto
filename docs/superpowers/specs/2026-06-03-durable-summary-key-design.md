# Durable Summary Key Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Add explicit durable `summaryKey` authority on decision topics and planner answers, so later reusable `answerSources` can deterministically target known consumers without relying on exact summary wording, exact prompt reuse, or extra parser heuristics.

## Why This Slice Exists

The authority stack already had:

- stable `decisionKey`
- durable decision `summary`
- optional durable decision `prompt`
- optional durable decision `matchHints`
- durable planner-answer `summary`
- optional durable planner-answer `prompt`
- optional durable planner-answer `matchHints`
- explicit reusable `answerSources[*].summaryKey`

That still left one real gap:

- `answerSources[*].summaryKey` could help leftover source entries materialize brand-new topics or planner answers
- but known pending consumers still could not persist the same explicit noun-phrase key on their own durable rows
- so matching reusable answer sources against existing consumers still had to fall back to visible summaries, prompts, durable hints, or consumer keys
- the long-term authority path should let both sides share one stable explicit key when visible wording is not the real matching authority

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable stores
- stay deterministic and fail closed
- do not add a second alias registry or fuzzy matching layer
- preserve existing decision-key, summary, prompt, and match-hint behavior
- reject conflicting durable `summaryKey` mutations instead of silently rewriting prior authority

## Implemented Scope

### Durable `summaryKey` On Decisions

`GoalDecision` now supports optional `summaryKey`.

This key is persisted through:

- `request_decision`
- `record_answer`
- `record_answers`
- `resolve_decision`

If a decision already has a `summaryKey`, later conflicting writes are rejected instead of silently overwriting it.

### Durable `summaryKey` On Planner Answers

`GoalPlanningRequestAnswer` now supports optional `summaryKey`.

This applies across:

- direct planning requests
- grouped planning requests
- workflow-root shared answers
- decision-backed and answer-backed follow-through answers

Later richer writes can backfill a missing `summaryKey`, but conflicting keys on the same durable answer row are rejected.

### Shared Interpreter Candidate Expansion

Shared answer interpretation now treats durable consumer `summaryKey` values as first-class matching candidates for:

- explicit decision answers
- inferred open-decision reuse
- explicit planner answers
- known-decision reuse during leftover `answerSources` materialization

This means `matching_answer_sources` can now deterministically bind a reusable source to an existing durable consumer by shared `summaryKey`, even when the visible summary or prompt text is different.

### Carry-Through On Remaining Source Materialization

When a leftover `pending_answer_sources` or `matching_answer_sources` entry materializes directly from explicit `summaryKey` authority, runtime now carries that `summaryKey` onto the resulting durable decision topic or planner answer.

This keeps the authority loop closed:

- explicit reusable source key on the source side
- explicit durable summary key on the consumer side
- later matching can reuse that same shared key without new parser rules

## Non-Goals

- inferring `summaryKey` from arbitrary loose prose
- replacing durable prompts or durable match hints
- introducing fuzzy summary-key equivalence beyond the existing deterministic humanization rules
- adding new raw `sourceResponseFormat` parser surfaces

## Acceptance Criteria

- decisions can persist optional durable `summaryKey`
- planner answers can persist optional durable `summaryKey`
- conflicting `summaryKey` writes fail closed instead of silently replacing prior durable authority
- `matching_answer_sources` can match known decisions and planner answers through shared durable `summaryKey`
- leftover source entries that materialize via `summaryKey` carry that authority onto the resulting durable record
