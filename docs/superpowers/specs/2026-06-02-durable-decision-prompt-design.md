# Durable Decision Prompt Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Preserve the exact user-facing question for a durable decision topic directly in `decisions.yml`, so later assistant and runtime behavior can ground against a first-class decision prompt instead of inferring that question from thread history or summary text alone.

## Why This Slice Exists

The decision substrate already had:

- stable `decisionKey`
- concise `summary`
- optional linked `taskRef`
- durable resolved `answer`

What it still lacked was the precise question authority behind that topic.

That gap matters because:

- `summary` is intentionally short and may not capture the exact wording or scope of the missing answer
- assistant thread history is durable but is not the right source of truth for a decision topic definition
- later answer-interpretation work should be able to ground against one canonical decision question without scraping prior chat turns

## Constraints

- `decisions.yml` remains the only durable decision-topic source of truth
- do not introduce a second question store or prompt registry
- do not silently rewrite resolved answers or workflow follow-through semantics
- keep prompt capture optional so existing flows remain valid

## Implemented Scope

### Decision Store Prompt Field

`GoalDecision` now supports optional `prompt`.

That field is stored directly in `decisions.yml`, validated on read, and preserved across later resolution updates.

### Shared Decision Request And Answer Creation Paths

The shared runtime helpers now accept `prompt` when they create a durable decision topic:

- `requestGoalDecision(...)`
- `answerGoalDecision(...)`
- `answerGoalDecisions(...)`

If the decision already exists, runtime keeps the current topic and does not create a second prompt store.

### Assistant Surfaces

Assistant actions can now preserve exact question authority when they open or create decision topics:

- `request_decision.prompt`
- `record_answer.prompt`
- explicit `record_answers.answers[*].prompt`

Assistant prompt guidance now tells the model to include `prompt` when the exact user-facing question matters for later authority or answer interpretation.

### Bun API And UI Surfaces

The active Bun product path now supports prompt capture and inspection through the same decision surface:

- `POST /api/goals/:goalKey/decisions`
- `POST /api/goals/:goalKey/decisions/answer`
- `POST /api/goals/:goalKey/decisions/answers`
- `GET /api/goals/:goalKey/decisions`
- decision creation form and decision cards in the Bun UI

This keeps decision-question authority on the live product path instead of pushing operators back to manual file edits.

## Non-Goals

- freeform prompt editing for already-created decision topics
- prompt inference from prior assistant-thread text
- a second durable store for unresolved user questions
- deeper answer interpretation that already consumes prompts automatically

## Acceptance Criteria

- `decisions.yml` can persist an optional exact question prompt per decision topic
- request-driven and answer-driven decision creation paths can write that prompt through shared runtime helpers
- assistant, API, and Bun UI can all surface the same prompt field on the active product path
- resolution preserves the prompt without introducing a second decision-authority store
