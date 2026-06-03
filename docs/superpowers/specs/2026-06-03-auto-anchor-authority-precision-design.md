# Auto Anchor Authority Precision Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Refine the `question_*` / `topic_*` fail-closed rule inside `sourceResponseFormat: "auto"` so runtime only stops when those anchor families have actually established consumer-specific authority, not merely because their parsers could split the reply into generic paragraphs, sentences, clauses, spans, or blocks.

## Why This Slice Exists

The earlier anchor fail-closed slice deliberately tightened `auto`:

- if a stronger `question_*` or `topic_*` surface had already attached to a reply
- and that surface still remained incomplete
- runtime would stop instead of dropping to weaker generic surfaces like `matching_runs`

That was directionally correct, but one detail was too coarse:

- some `question_*` / `topic_*` parsers can always produce generic units from the raw reply
- for example, paragraph and sentence parsers can still split a reply even when none of those units match any current consumer
- treating “generic units were parsed” as equivalent to “anchor authority was established” made `auto` fail closed too early
- that blocked legitimate weaker fallbacks like `ordered_items` or `pending_paragraphs` even though no real question/topic authority had attached to the reply

The long-term authority route should fail closed only after the stronger surface has actually claimed some of the reply for one or more known consumers.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not add fuzzy or semantic matching
- do not invent a new parser family
- keep explicit concrete `sourceResponseFormat` stronger than `auto`

## Implemented Scope

### Consumer-Specific Match Requirement

`auto` now treats `question_*` and `topic_*` surfaces as terminal only after they have consumed at least one consumer-specific unit during the probe.

Current rule:

- if a `question_*` or `topic_*` candidate surface probes successfully far enough to consume at least one mapped unit for a known consumer
- and that same candidate still fails before fully satisfying the call
- `auto` fails closed instead of continuing to weaker later surfaces

But:

- if the candidate only parsed generic reply units
- and never actually matched any consumer-specific unit
- that candidate is not treated as established anchor authority
- `auto` may continue to weaker later surfaces like `ordered_items`, `ordered_blocks`, or pending-order surfaces

### Narrow Runtime Change

This slice does not change parser behavior or matching rules.

It only narrows the terminal-boundary check:

- from “this anchor surface parsed some units”
- to “this anchor surface consumed at least one consumer-specific unit”

## Example

Before this slice, a caller could provide:

- `sourceResponseFormat: "auto"`
- two explicit decision consumers
- one ordered reply like:
  - `1. Use Bun-native auth`
  - `2. Use a staged rollout`

The earlier anchor-terminal rule could stop at `topic_paragraphs` or `topic_sentences` simply because those surfaces parsed generic units, even though neither surface matched any consumer-specific topic authority.

After this slice:

- those generic paragraph or sentence splits no longer count as established anchor authority by themselves
- `auto` continues probing
- `ordered_items` can win and deterministically materialize the two answers

At the same time, the prior stronger safety still holds:

- if `question_clauses` or `topic_clauses` already consume one or more known consumers
- and then remain incomplete
- `auto` still fails closed instead of dropping to weaker generic reinterpretation

## Non-Goals

- weakening explicit non-`auto` `question_*` or `topic_*` behavior
- undoing the earlier anchor fail-closed slice
- allowing weaker fallback after real anchor authority has already consumed one or more units
- changing label-surface or answer-source terminal rules

## Acceptance Criteria

- `auto` still fails closed when `question_*` or `topic_*` surfaces have already consumed at least one consumer-specific unit and then remain incomplete
- `auto` no longer fails closed merely because generic paragraphs, sentences, clauses, spans, or blocks were parsed without matching any consumer
- ordered and pending fallback surfaces remain reachable when no real question/topic authority was ever established
- direct Bun API decision-answer flows expose the same refined behavior
