# Durable Planner Answer Key Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Add explicit durable `answerKey` authority on planner answers, so later writes can update the same captured planner-answer row by stable identity and reusable `matching_answer_sources` can target known planner answers without relying on summary wording or the previous answer text.

## Why This Slice Exists

The authority stack already had:

- durable planner-answer `summary`
- optional durable planner-answer `summaryKey`
- optional durable planner-answer `prompt`
- optional durable planner-answer `matchHints`
- explicit reusable `answerSources[*].answerSourceKey`
- explicit reusable `answerSources[*].summaryKey`

That still left one real gap:

- planner answers still had no stable row identity equivalent to decision-side `decisionKey`
- durable planner-answer merges still fell back to `(summary, answer)` identity
- later writes that meant “update this same planner-answer slot with a newer answer” could duplicate rows instead of reusing one durable row
- reusable `matching_answer_sources` could target a planner answer by `summaryKey`, prompt, or hints, but not by one explicit stable planner-answer key

The long-term authority path should let planner answers carry one explicit row identity of their own instead of depending on visible summary wording or the previous answer payload.

## Constraints

- keep `planning-requests.yml` as the only durable planner-answer store
- stay deterministic and fail closed
- do not add a second alias registry or fuzzy matching layer
- preserve existing summary, summaryKey, prompt, and match-hint behavior
- reject conflicting durable `answerKey` mutations instead of silently rewriting prior authority

## Implemented Scope

### Durable `answerKey` On Planner Answers

`GoalPlanningRequestAnswer` now supports optional `answerKey`.

This applies across:

- direct planning requests
- grouped planning requests
- workflow-root shared answers
- decision-backed and answer-backed follow-through answers

### Stable Row Reuse For Planner-Answer Merges

Planner-answer merge logic now treats `answerKey` as the strongest row identity.

When an incoming planner answer reuses an existing `answerKey`:

- it updates the same durable row even if the answer text changed
- it can backfill the missing `answerKey` onto an older row that previously matched only by `(summary, answer)`
- it still rejects conflicting `answerKey` writes fail-closed

If the same `answerKey` is reused with a different visible summary, runtime rejects the write instead of guessing whether that is really the same planner-answer slot.

### Shared Interpreter Candidate Expansion

Shared answer interpretation now treats planner-answer `answerKey` values as first-class matching candidates for:

- explicit planner answers
- reusable `matching_answer_sources`

This means `matching_answer_sources` can now deterministically bind a reusable source to a known planner answer by shared `answerKey`, even when the visible summary or prompt text is not the real matching authority.

### Carry-Through On Reusable Source Materialization

Reusable `answerSources` now also support optional `answerKey`.

When a reusable source is used to materialize or match a planner answer through that explicit key, runtime carries the same `answerKey` onto the durable planner-answer row.

## Non-Goals

- adding a new decision-side key beyond the existing `decisionKey`
- inferring `answerKey` from arbitrary loose prose
- replacing durable `summaryKey`, durable prompts, or durable `matchHints`
- adding new raw `sourceResponseFormat` parser surfaces

## Acceptance Criteria

- planner answers can persist optional durable `answerKey`
- later writes can update the same durable planner-answer row by shared `answerKey` even when answer text changes
- conflicting `answerKey` writes fail closed instead of silently replacing prior planner-answer identity
- `matching_answer_sources` can match known planner answers through shared durable `answerKey`
