# Contiguous Remaining Pending Answer-Source Merge

## Goal

Extend the explicit reusable-source authority on `sourceResponseFormat: "pending_answer_sources"` so leftover entries can materialize one brand-new durable decision topic or one inferred planner-answer row across more than one adjacent reusable source entry when those leftovers already share the same durable key authority.

## Why

We already let `pending_answer_sources` use explicit durable keys while consuming known pending consumers, and we already let leftover `matching_answer_sources` entries merge when they share one explicit key. Without the same rule on leftover `pending_answer_sources`, runtime still splits one explicit durable topic or planner-answer row into multiple outputs merely because the caller chose ordered reusable sources instead of matching reusable sources.

That split is weaker authority than the payload already provides. If adjacent leftover entries all say the same `decisionKey`, `answerKey`, or `summaryKey`, runtime should preserve that shared identity instead of fabricating two durable outputs.

## Required Behavior

When `inferDecisionTopics` consumes leftover `pending_answer_sources` entries:

- Adjacent leftover entries sharing the same explicit `decisionKey` merge into one inferred durable decision topic.
- Adjacent leftover entries sharing the same explicit `summaryKey` merge into one inferred durable decision topic.
- The merged output keeps the same existing metadata merge rules as contiguous `matching_answer_sources`: answers join with `\n\n`, conflicting metadata fails closed, and compatible metadata is preserved.

When `followThrough.inferRemainingAnswers` or the direct planning equivalent consumes leftover `pending_answer_sources` entries:

- Adjacent leftover entries sharing the same explicit `answerKey` merge into one inferred planner-answer row.
- Adjacent leftover entries sharing the same explicit `summaryKey` merge into one inferred planner-answer row.
- The merged output uses the same answer and metadata merge semantics as contiguous `matching_answer_sources`.

## Fail-Closed Rules

- Non-contiguous repeats of the same explicit durable key still fail closed.
- Anonymous leftover entries without explicit `decisionKey`, `answerKey`, or `summaryKey` keep the old one-entry-per-output behavior.
- This slice does not broaden raw-reply parsing, fuzzy grouping, or any new `sourceResponseFormat`.

## Implementation Notes

- Reuse one shared contiguous answer-source grouping helper for both `matching_answer_sources` and leftover `pending_answer_sources`.
- Keep the existing descriptor split:
  - decision inference groups by `decisionKey` first, then `summaryKey`
  - planner-answer inference groups by `answerKey` first, then `summaryKey`
- Surface-specific error text should name the right source family, so pending leftovers fail with `Non-contiguous pending answerSources repeated ...` instead of reusing matching-only wording.

## Verification

- Runtime tests cover:
  - contiguous leftover pending entries merging into one inferred decision by `decisionKey`
  - non-contiguous leftover pending repeats failing closed
  - contiguous leftover pending entries merging into one inferred planner answer by `answerKey`
- API tests cover:
  - `POST /api/goals/:goalKey/decisions/answers` with `inferOpenDecisions + inferDecisionTopics`
  - direct planning request creation with `inferRemainingAnswers`
