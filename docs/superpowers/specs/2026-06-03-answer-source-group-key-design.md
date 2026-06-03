# Answer-Source Group-Key Authority

## Goal

Strengthen reusable `answerSources` so one materialized answer can span more than one source fragment without requiring those fragments to stay adjacent in the source list.

## Why

Before this slice, reusable `answerSources` only had two grouping modes:

- no grouping at all
- implicit contiguous grouping through adjacent repeated `decisionKey`, `answerKey`, or `summaryKey` authority

That was enough for simple extracted snippets, but it forced a weaker tradeoff for more complex reusable-source bundles:

- either keep all fragments for one answer adjacent
- or fail closed on non-contiguous repeats

That is still better than fuzzy regrouping, but it leaves one explicit authority gap. If the caller already knows that two non-adjacent reusable source entries belong to the same answer, runtime should accept that only when the caller says so explicitly.

## Required Behavior

### Explicit source grouping

Reusable `answerSources[*]` may now carry:

- `sourceGroupKey`

Entries with the same explicit `sourceGroupKey` belong to one materialized answer group even when they are not adjacent.

### What `sourceGroupKey` does not do

`sourceGroupKey` only authorizes merging source fragments together.

It does not choose the decision/planning consumer by itself. Consumer selection must still come from the existing stronger authority already on the grouped entries, such as:

- `decisionKey`
- `answerKey`
- `summaryKey`
- stable prompt authority
- stable hint authority
- explicit `route`
- existing matching consumer context

## Runtime Rules

### Group materialization

When several reusable source entries share one `sourceGroupKey`:

- runtime merges them in original source order
- merged answer text remains separated by blank lines
- merged metadata must stay internally consistent

### Metadata consistency

Grouped entries must fail closed when the same `sourceGroupKey` carries conflicting values for any stable authority field, including:

- `route`
- `decisionKey`
- `answerKey`
- `summaryKey`
- `summary`
- `prompt`

### Known-consumer matching

`matching_answer_sources` and `pending_answer_sources` may now materialize one known decision or planner answer from a non-contiguous reusable-source group when the grouped entries still resolve to that same consumer under existing authority.

### Remaining inference

Grouped reusable sources may also participate in:

- `inferDecisionTopics`
- `followThrough.inferRemainingAnswers`

as long as the merged group still satisfies the same existing explicit-authority rules that would have been required for one single reusable source entry.

## Non-Goals

This slice does not:

- make raw `sourceResponse` parsing looser
- let `sourceGroupKey` pick a consumer by itself
- change `answerSourceKey` references into implicit group references
- relax fail-closed behavior for conflicting grouped metadata

## Verification

- Runtime tests cover grouped known-consumer matching on `matching_answer_sources`.
- Runtime tests cover grouped ordered consumption on `pending_answer_sources`.
- Runtime tests cover grouped remaining decision-topic inference.
- Runtime tests cover grouped remaining planner-answer inference.
- API tests cover direct planning, direct decision, and assistant-run surfaces for the new authority.
