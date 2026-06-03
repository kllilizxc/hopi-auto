# Mixed Answer-Source Route Inference

## Goal

Allow one reusable `answerSources` bundle to drive both:

- brand-new durable decision topics through `inferDecisionTopics`
- brand-new inferred planner-answer rows through `followThrough.inferRemainingAnswers`

in the same mutation, without falling back to fuzzy routing.

## Constraint

This mixed mode is only valid when:

- `sourceResponseFormat` is `pending_answer_sources` or `matching_answer_sources`
- every leftover reusable source entry is explicitly routed by either one durable `decisionKey` or one durable `answerKey`

Anything weaker stays fail-closed.

## Why

Before this slice, runtime forced a hard mutual exclusion:

- either leftover reusable sources became new decision topics
- or leftover reusable sources became inferred planner answers

That was too weak once the payload already carried explicit durable route authority. If one leftover source entry says `decisionKey: "launch-sequencing"` and another says `answerKey: "rollback-trigger"`, runtime no longer needs to guess which side each leftover belongs to.

## Required Behavior

When `inferDecisionTopics: true` and `followThrough.inferRemainingAnswers: true` are both set:

- runtime first consumes explicit decision answers, inferred open decisions, and explicit planner-answer slots exactly as before
- then it inspects the remaining reusable source entries
- entries routed by explicit `decisionKey` become brand-new durable decision topics
- entries routed by explicit `answerKey` become brand-new inferred planner-answer rows

This works for both:

- `pending_answer_sources`
- `matching_answer_sources`

## Merge Semantics

Adjacent leftover entries with the same explicit route key should merge before materialization:

- adjacent `decisionKey: "launch-sequencing"` leftovers merge into one new decision topic
- adjacent `answerKey: "rollback-trigger"` leftovers merge into one inferred planner-answer row

Merged answers join with `\n\n`, and metadata conflicts still fail closed.

## Fail-Closed Rules

Mixed route inference must reject:

- any leftover source entry that has neither explicit `decisionKey` nor explicit `answerKey`
- any leftover source entry that declares both `decisionKey` and `answerKey`
- any non-contiguous repeat of the same explicit route key
- any non-answer-source format such as `question_blocks`, `topic_spans`, or `ordered_items`

In those cases runtime must not guess whether the leftover belongs on the decision side or the planner side.

## Non-Goals

This slice does not:

- broaden mixed inference to `summary`, `summaryKey`, `prompt`, `matchHints`, or suffix-only `answerSourceKey`
- introduce new parser families
- weaken the existing fail-closed stance for less-structured raw replies

## Implementation Notes

- Move the mixed-inference rule into shared runtime instead of keeping API-only or assistant-only guards.
- Keep the existing non-mixed behavior unchanged.
- For `auto`, only allow the mixed path when the chosen concrete format is `pending_answer_sources` or `matching_answer_sources`; otherwise fail closed with the same shared error.

## Verification

- Runtime tests cover mixed pending-source routing success, mixed matching-source routing success, and ambiguous leftover route failure.
- API tests cover successful mixed routing through `POST /api/goals/:goalKey/decisions/answers` for both `pending_answer_sources` and `matching_answer_sources`.
- Existing API tests still prove non-answer-source formats keep rejecting the mixed flag combination.
