# Explicit Answer-Source Route Metadata

## Goal

Let one reusable `answerSources` bundle explicitly route leftover entries into:

- brand-new durable decision topics through `inferDecisionTopics`
- brand-new inferred planner-answer rows through `followThrough.inferRemainingAnswers`

without forcing callers to pre-invent durable `decisionKey` or `answerKey` values just to choose a side.

## Constraint

This authority only applies when:

- `sourceResponseFormat` is `pending_answer_sources` or `matching_answer_sources`
- mixed inference is active (`inferDecisionTopics: true` plus `followThrough.inferRemainingAnswers: true`)
- each leftover reusable source entry exposes one explicit route authority:
  - `route: "decision"`
  - `route: "planning"`
  - or the older durable-key authorities (`decisionKey` / `answerKey`)

Anything weaker stays fail-closed.

## Why

The previous mixed-route slice already proved that runtime can safely create both new decision topics and new planner answers in one mutation when leftovers carry explicit durable keys.

That was still too rigid. A caller may know that one snippet belongs on the decision side and another belongs on the planner side, while still not wanting to mint row-identity keys up front. In those cases, forcing `decisionKey` or `answerKey` just to pick a side makes the payload noisier than necessary and couples routing to row identity.

## Required Behavior

When mixed inference is active:

- runtime first consumes explicit decision answers, inferred open decisions, and explicit planner-answer slots exactly as before
- then it inspects the remaining reusable source entries
- `route: "decision"` leftovers materialize on the decision side
- `route: "planning"` leftovers materialize on the planner-answer side
- older `decisionKey` / `answerKey` routing keeps working unchanged

This works for both:

- `pending_answer_sources`
- `matching_answer_sources`

## Merge Semantics

Explicit route alone chooses the side, but it does not imply merge authority.

Adjacent leftovers merge only when they also share a stable grouping authority on that side:

- decision side: same explicit `decisionKey` or same explicit `summaryKey`
- planner side: same explicit `answerKey` or same explicit `summaryKey`

If a routed leftover has no stable grouping key, it materializes as a single row on its own.

## Fail-Closed Rules

Mixed route inference must reject:

- any leftover source entry that has no explicit `route`, `decisionKey`, or `answerKey`
- any leftover source entry that declares both `decisionKey` and `answerKey`
- `route: "decision"` combined with `answerKey`
- `route: "planning"` combined with `decisionKey`
- any non-contiguous repeat of the same stable grouping authority
- any non-answer-source format such as `question_blocks`, `topic_spans`, or `ordered_items`

Runtime must not guess which side a leftover belongs to, and it must not guess whether two routed leftovers should merge.

## Non-Goals

This slice does not:

- broaden mixed inference to raw `summary`, `prompt`, `matchHints`, or suffix-only `answerSourceKey` as route selectors
- weaken the existing fail-closed stance for less-structured raw replies
- introduce new parser families

## Implementation Notes

- Keep route metadata on reusable `answerSources` only; planner-answer rows and decision rows do not persist route because route is consumed during materialization.
- Preserve older durable-key routing so existing payloads stay valid.
- Surface the new `route` field through Bun API and assistant action schemas/guidance.

## Verification

- Runtime tests cover mixed pending-source routing success, mixed matching-source routing success, legacy missing-route failure, and explicit route/key conflict failure.
- API tests cover successful mixed routing through `POST /api/goals/:goalKey/decisions/answers` for both `pending_answer_sources` and `matching_answer_sources`.
- Assistant-run tests cover mixed routing through `record_answers` using explicit `route` metadata.
