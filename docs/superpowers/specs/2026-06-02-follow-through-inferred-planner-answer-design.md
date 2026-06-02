# Follow-Through Inferred Planner Answer Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let answer-driven decision workflows capture the remaining unclaimed question/topic reply items as shared planner answers without requiring explicit `followThrough.answers[*].summary` mapping for every non-decision answer.

## Why This Slice Exists

The prior answer-interpretation work already supported:

- explicit non-decision captured answers on `planning`, `planning_batch`, and `workflow_batch` follow-through
- deterministic reuse of structured replies for explicit planner answers
- brand-new durable decision-topic inference from remaining question/topic reply items

But planner-only answers still had a manual gap: even when decision answers were obvious and the remaining question/topic reply items were structurally clear, assistant still had to restate every non-decision planner summary inside `followThrough.answers`.

This slice closes that gap for the shared follow-through surface while keeping the runtime deterministic.

## Constraints

- keep `planning-requests.yml` as the only durable planner-answer authority
- do not add a second inferred-answer cache or planner-summary store
- preserve existing explicit `followThrough.answers` behavior
- stay deterministic
- do not introduce fuzzy summarization or semantic matching
- do not let the same remaining source item become both a new decision topic and a planner answer in one action
- keep this slice scoped to root `planning` and `planning_batch` follow-through, not `workflow_batch`

## Implemented Scope

### Root `followThrough.inferRemainingAnswers`

Root `planning` and `planning_batch` follow-through now accept:

```json
{
  "inferRemainingAnswers": true
}
```

When enabled, runtime materializes any remaining unclaimed structured reply items as shared planner captured answers after:

- explicit decision answers
- inferred open decisions
- explicit follow-through answers

Those inferred planner answers are then written onto the durable planning requests created by that shared follow-through.

### Supported Structured Reply Surfaces

`followThrough.inferRemainingAnswers` currently supports only reply surfaces that already provide deterministic summary authority plus consumable source-item boundaries:

- `question_blocks`
- `question_spans`
- `topic_sentences`
- `topic_paragraphs`
- `topic_blocks`

The inferred summary comes from the same existing authority that already drives the relevant decision-side interpretation:

- question text without the trailing `?`
- trailing topic summaries such as `for pilot scope`

### Disjoint Authority With `inferDecisionTopics`

`followThrough.inferRemainingAnswers` is intentionally disjoint from `inferDecisionTopics`.

If one action asks runtime to turn the same remaining structured reply items into both:

- new durable decision topics
- shared planner captured answers

runtime now rejects that action deterministically instead of guessing.

## Non-Goals

- inferring planner answers from `labeled_sections`, `inline_topics`, `ordered_items`, or `ordered_blocks`
- inferring child-local planner answers inside `workflow_batch`
- mixing `inferDecisionTopics` and inferred planner answers in the same action
- semantic planner-summary extraction from fully loose prose

## Acceptance Criteria

- root `planning` and `planning_batch` follow-through can infer shared planner answers from remaining question/topic reply items
- explicit decision answers and inferred open decisions still consume their source items first
- explicit follow-through answers still consume their source items first
- `inferDecisionTopics` and `followThrough.inferRemainingAnswers` fail deterministically when combined
- Bun API and Goal assistant both use the same shared runtime path
