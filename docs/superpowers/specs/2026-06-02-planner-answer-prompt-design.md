# Planner Answer Prompt Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Give durable planning-request answers the same exact-question substrate that durable decisions already have, so planner-side answer interpretation does not have to rely only on short summary text.

## Why This Slice Exists

The current system already let assistant and API persist:

- durable decision prompts on `decisions.yml`
- durable planning answers on `planning-requests.yml`
- prompt-aware matching for known decisions across question/topic reply surfaces

That still left planner answers weaker than decision answers:

- captured planning answers only preserved `summary` plus `answer`
- shared interpreter could only match planner answers by summary text
- if a user replied with the exact planner question or a closer question-form restatement, planner answers still could not reuse that authority unless the summary happened to be repeated verbatim

## Constraints

- keep `planning-requests.yml` as the only durable planner-answer store
- do not add a second prompt registry for planning answers
- preserve existing summary-based planner-answer behavior
- preserve stable answer merging instead of duplicating the same summary/answer pair

## Implemented Scope

### Durable `prompt` On Planning Answers

`GoalPlanningRequestAnswer` now supports optional:

```json
{
  "summary": "Pilot scope",
  "prompt": "Which customers should pilot first before broader launch?",
  "answer": "Start with five enterprise customers."
}
```

This field is accepted and preserved across:

- direct planning requests
- grouped planning requests
- direct workflow-root shared answers
- decision-backed and answer-backed follow-through answers

### Prompt-Aware Planner Interpretation

Shared answer interpretation now treats planner prompts as first-class source-response candidates alongside planner summaries.

So when a planning answer supplies:

- `summary`
- optional exact `prompt`

runtime can match structured reply surfaces through either authority, including:

- `question_blocks`
- `question_spans`
- `topic_sentences`
- `topic_paragraphs`
- `topic_blocks`

This reuses the same existing deterministic question/topic matching rules that already power decision prompts.

### Stable Merge Upgrade

When the same planner answer already exists with the same `summary` plus `answer`, and a later update supplies a richer `prompt`, runtime upgrades that existing durable answer in place instead of appending a duplicate.

## Non-Goals

- inferring brand-new planner prompts from loose reply prose
- adding fuzzy semantic planner matching beyond the current deterministic question/topic rules
- introducing a second planning-answer alias or synonym store

## Acceptance Criteria

- durable planning-request answers can preserve optional exact `prompt` text
- answer-driven planning follow-through can match planner answers by prompt when summary text is not repeated
- the same planner answer can be upgraded later with richer prompt metadata instead of duplicating the answer row
- assistant, API, runtime, and durable store all share the same planner prompt surface
