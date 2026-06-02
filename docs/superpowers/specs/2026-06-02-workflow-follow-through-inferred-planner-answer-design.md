# Workflow Follow-Through Inferred Planner Answer Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Extend root `followThrough.inferRemainingAnswers` onto decision-backed and answer-backed `workflow_batch`, so remaining unclaimed structured reply items can become workflow-root shared planner answers without forcing assistant to restate those non-decision summaries manually.

## Why This Slice Exists

The prior inferred-planner-answer slice already covered:

- root `planning` follow-through
- root `planning_batch` follow-through
- deterministic consumption order across explicit decision answers, inferred open decisions, and explicit planner answers

But `workflow_batch` was still weaker than the simpler follow-through surfaces it already shared runtime with:

- root shared workflow answers still required explicit `followThrough.answers[*].summary` mapping
- child explicit workflow answers could consume structured reply items, but leftover shared planner answers could not automatically land on the workflow root
- answer-driven multi-workflow graphs therefore had a manual planner-summary gap that single-workflow follow-through no longer had

## Constraints

- keep `planning-requests.yml` as the only durable planner-answer authority
- keep workflow-root shared answers on the existing workflow graph surface
- preserve explicit root `followThrough.answers` behavior
- preserve explicit child `workflow.answers` behavior
- do not add child-level `inferRemainingAnswers`
- stay deterministic
- keep this disjoint from `inferDecisionTopics`

## Implemented Scope

### Root `workflow_batch.inferRemainingAnswers`

Decision-backed and answer-backed `workflow_batch` now accepts:

```json
{
  "inferRemainingAnswers": true
}
```

at the root shared workflow-follow-through layer.

### Consumption Order

Runtime now materializes structured reply items in this order:

1. explicit decision answers
2. inferred open decisions
3. explicit root shared workflow answers
4. explicit child workflow answers
5. remaining shared workflow answers inferred from the still-unclaimed structured reply items

That keeps child-local explicit answers authoritative while still letting the workflow root capture leftover shared planner context.

### Supported Structured Reply Surfaces

This root workflow-batch inference currently supports the same deterministic surfaces as the earlier root follow-through slice:

- `question_blocks`
- `question_spans`
- `topic_sentences`
- `topic_paragraphs`
- `topic_blocks`

The inferred summary continues to come from the same existing authority already used elsewhere on those surfaces.

## Non-Goals

- adding child-level `inferRemainingAnswers` inside `workflow_batch`
- inferring shared workflow answers from `labeled_sections`, `inline_topics`, `ordered_items`, or `ordered_blocks`
- mixing `inferDecisionTopics` and inferred shared workflow answers in one action
- introducing a second workflow-answer cache or inferred-summary store

## Acceptance Criteria

- root `workflow_batch` can infer shared planner answers from remaining question/topic reply items
- explicit child workflow answers consume their own structured reply items before root inferred shared answers are materialized
- explicit root shared workflow answers still work unchanged
- Bun API and Goal assistant expose the same root `workflow_batch.inferRemainingAnswers` authority
- `inferDecisionTopics` remains disjoint from inferred shared workflow answers
