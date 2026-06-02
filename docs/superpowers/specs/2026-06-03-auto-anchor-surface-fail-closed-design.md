# Auto Anchor-Surface Fail-Closed Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Strengthen `sourceResponseFormat: "auto"` so explicit `question_*` and `topic_*` anchor surfaces cannot be silently bypassed by weaker generic surfaces after those anchor families have already established deterministic authority and then proven incomplete.

## Why This Slice Exists

The earlier `auto` slices already:

- rejected partially successful unit-based candidates
- failed closed when explicit multi-label `labeled_sections` or `inline_topics` authority was established but left incomplete
- failed closed when explicit reusable `answerSources` authority stayed incomplete after the answer-source family had already been tried

That still left one more authority gap:

- a reply could clearly establish question- or topic-anchor structure
- one of the explicit `question_*` or `topic_*` surfaces could parse anchored units from that reply
- that surface could still fail because not every anchored unit was consumed by the current call
- `auto` could then continue to weaker generic surfaces like `matching_runs`
- those weaker surfaces could succeed only by swallowing the leftover anchored unit into the wrong already-known consumer

The long-term authority route should not let a weaker generic fallback reinterpret a reply after stronger explicit anchor authority has already attached to it.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not add fuzzy or semantic matching
- do not invent a new parser family
- keep explicit concrete `sourceResponseFormat` stronger than `auto`

## Implemented Scope

### Explicit Anchor Families Are Now Terminal

`auto` now treats these explicit anchor families as fail-closed once they have parsed one or more anchored units and still fail:

- `question_blocks`
- `question_clauses`
- `question_spans`
- `question_middle_spans`
- `question_closing_spans`
- `question_closing_blocks`
- `question_middle_blocks`
- `topic_clauses`
- `topic_sentences`
- `topic_spans`
- `topic_middle_spans`
- `topic_closing_spans`
- `topic_closing_blocks`
- `topic_paragraphs`
- `topic_middle_blocks`
- `topic_blocks`

Current rule:

- if one of these surfaces parses at least one anchored unit during an `auto` probe
- and the probe still fails
- `auto` terminates with an error instead of continuing to weaker later surfaces like `matching_runs`, ordered fallbacks, or pending-order fallbacks

### Stronger Generic Surface Still Works When Chosen Explicitly

This slice does not weaken explicit non-`auto` usage:

- callers can still set `sourceResponseFormat: "matching_runs"` directly
- callers can still set any concrete `question_*` or `topic_*` format directly
- the change only affects `auto` fallback after stronger explicit anchor authority has already attached to the reply

## Example

Before this slice, a caller could provide:

- one question-anchored reply like `Auth strategy? ... Rollout strategy? ... Pilot scope? ...`
- explicit decision consumers only for `Auth strategy` and `Rollout strategy`

`auto` could then:

- probe `question_clauses`
- detect three explicit question clauses
- fail completeness because `Pilot scope` was still unconsumed
- continue down to `matching_runs`
- "succeed" by merging the `Pilot scope` clause into the `Rollout strategy` answer

After this slice:

- `question_clauses` still parses first
- the same incompleteness is still detected
- but because explicit question-anchor authority was already established, `auto` fails closed instead of reinterpreting the reply through `matching_runs`

The same rule now applies to explicit `topic_*` anchor families.

## Non-Goals

- changing explicit non-`auto` `question_*` or `topic_*` behavior
- blocking fallback inside the answer-source family
- changing the narrower `inline_topics` threshold introduced by the label-surface slice
- inventing a new generic fallback parser

## Acceptance Criteria

- `auto` no longer falls from incomplete `question_*` anchor authority into weaker generic surfaces
- `auto` no longer falls from incomplete `topic_*` anchor authority into weaker generic surfaces
- direct Bun API decision-answer flows expose the same fail-closed behavior
- explicit concrete `matching_runs` usage still works when the caller asks for it directly
