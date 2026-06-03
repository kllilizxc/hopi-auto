# Contiguous Anchor Run Merge Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Strengthen explicit `question_*` and `topic_*` answer-interpretation surfaces so one known consumer can span several adjacent matching units without forcing callers to collapse those units into one sentence, clause, span, or paragraph first.

## Why This Slice Exists

The current explicit anchor surfaces were already strong enough to stay deterministic:

- `question_*` surfaces matched by explicit question prompts
- `topic_*` surfaces matched by explicit topic-bearing text

But one narrow gap remained:

- if the same known consumer matched more than once, runtime always threw `Multiple ... matched ...`
- that was correct for non-contiguous repeats, because a later gap could hide another consumer or orphan prose
- but it was too strict for contiguous repeats where every adjacent unit still clearly belonged to the same already-known consumer

That forced callers to either:

- rewrite the reply into a more collapsed shape
- or switch to a weaker surface

The authority route should instead make the stronger explicit-anchor surfaces more capable, without inventing another parser family.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not add fuzzy or semantic matching
- do not invent a new `sourceResponseFormat`
- keep non-contiguous repeated matches fail-closed
- keep reservation behavior aligned with consumption behavior, so explicit answers and inferred remaining material do not disagree about what one consumer already owns

## Implemented Scope

### Contiguous Repeats Now Merge

When one known consumer matches several adjacent explicit units, runtime now merges them into one answer instead of throwing.

This applies across the existing explicit anchor families:

- `question_blocks`
- `question_clauses`
- `question_spans`
- `question_middle_spans`
- `question_closing_spans`
- `question_closing_blocks`
- `question_middle_blocks`
- `topic_sentences`
- `topic_clauses`
- `topic_spans`
- `topic_middle_spans`
- `topic_closing_spans`
- `topic_closing_blocks`
- `topic_paragraphs`
- `topic_middle_blocks`
- `topic_blocks`

Join rules stay structural:

- sentence, clause, and span surfaces join with a single space
- paragraph and block surfaces join with a double newline

For question surfaces, the merged answer keeps the first matched source question as the surfaced prompt authority.

### Non-Contiguous Repeats Still Fail Closed

Runtime still throws the existing deterministic `Multiple ... matched ...` errors when repeated matches for one consumer are separated by:

- another matched consumer
- another explicit anchor run
- or any other gap that breaks adjacency

So this slice does not widen interpretation authority. It only stops rejecting the obviously contiguous case.

### Reservation Semantics Now Match Consumption

The same contiguous-run rule now also applies when runtime reserves explicit or open-decision matches before inferring remaining decision topics or planner answers.

That means:

- contiguous repeated explicit matches reserve the whole adjacent run
- non-contiguous repeated explicit matches fail closed during reservation too

This prevents one layer from consuming only the first match while another layer later tries to reinterpret the rest as leftover material.

### API Surface Proof

The Bun decision-answer API now has explicit coverage showing:

- contiguous repeated `topic_sentences` for one requested topic succeeds and returns one merged durable answer
- non-contiguous repeated explicit topic and question-closing surfaces still return HTTP 400 with the same `Multiple ... matched ...` errors

## Example

With `sourceResponseFormat: "topic_sentences"` and one known `auth-strategy` consumer:

This now succeeds:

- `Use Bun-native auth for auth strategy.`
- `Document Bun-native fallback decisions for auth strategy.`

and materializes one merged answer.

But this still fails closed:

- `Use Bun-native auth for auth strategy.`
- `Use a staged rollout for rollout strategy.`
- `Document Bun-native fallback decisions for auth strategy.`

because the repeated auth matches are no longer contiguous.

## Non-Goals

- inventing a new format for repeated explicit anchors
- changing `matching_runs`
- changing `inferDecisionTopics` into weaker free-form inference
- allowing repeated matches to skip over unrelated units
- merging non-adjacent repeated anchors by consumer identity alone

## Acceptance Criteria

- contiguous repeated matches for one known consumer merge on explicit `question_*` and `topic_*` surfaces
- non-contiguous repeated matches still throw the existing deterministic `Multiple ... matched ...` errors
- reservation logic uses the same contiguous-run rule as direct answer consumption
- unit coverage proves contiguous success and non-contiguous failure
- Bun API coverage proves the merged behavior is visible on the decision-answer HTTP surface
