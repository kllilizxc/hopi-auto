# Auto Source Response Completeness Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Strengthen `sourceResponseFormat: "auto"` so it no longer accepts a candidate surface just because that surface did not throw. `auto` should keep searching when an earlier existing surface only partially consumes the reply.

## Why This Slice Exists

The original `auto` substrate already provided one deterministic priority order across existing surfaces.

That still left one real authority gap:

- an earlier candidate could "succeed" while only consuming part of the reply
- shared runtime would stop there and never try a later existing surface that fully captured the same reply
- this showed up most clearly when topic/question/ordered surfaces consumed the anchor units but silently dropped continuation clauses, sentences, or paragraphs

The long-term authority route should prefer the strongest existing surface that both:

- succeeds deterministically
- fully consumes the structured units that surface claims as its own

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not add fuzzy or semantic matching
- do not invent a new parser family
- keep explicit concrete `sourceResponseFormat` stronger than `auto`

## Implemented Scope

### Completeness Guards For Unit-Based Surfaces

When `auto` probes an existing candidate surface, shared runtime now rejects that candidate if it leaves unconsumed units behind for these families:

- `labeled_sections`
- `inline_topics`
- `matching_runs`
- `ordered_items`
- `ordered_blocks`
- `single_pending`
- `pending_clauses`
- `pending_paragraphs`
- `pending_sentences`
- `pending_conjunctions`
- `pending_answer_sources`
- `matching_answer_sources`
- `question_*` unit surfaces when this slice is not simultaneously relying on `inferDecisionTopics`
- `topic_*` unit surfaces when this slice is not simultaneously relying on `inferDecisionTopics`

The check is deterministic:

- probe the candidate
- inspect the interpretation state that candidate produced
- compare consumed-unit counts with total-unit counts for that same candidate family
- reject the candidate if any units remain unconsumed
- continue trying later existing candidates by the same fixed authority priority

### Current Boundary

This slice intentionally stays narrow around unit-based completeness.

It does **not** yet add the same completeness guard to every other family. In particular:

- unit-based `inferDecisionTopics` surfaces beyond label-based reply families

still keep their prior `auto` behavior for now.

## Example

Before this slice, a reply like:

`Auth strategy should use Bun-native auth, that keeps the runtime close to Bun primitives, rollout strategy should use a staged launch, that keeps rollback simple.`

could let `auto` stop at `topic_clauses`, because that candidate matched the two anchor clauses and did not throw.

After this slice:

- `topic_clauses` is rejected because it leaves the two continuation clauses unconsumed
- `auto` continues probing
- `matching_runs` is allowed to win because it fully captures both repeated-consumer runs

For explicit label surfaces, later slices now additionally treat established label authority as fail-closed instead of letting weaker later surfaces reinterpret the same reply after a label-surface completeness failure.

## Non-Goals

- inventing new deeper-reply parser shapes
- semantic scoring between two valid candidates
- making `auto` infer brand-new topics more aggressively

## Acceptance Criteria

- decision-backed auto interpretation can fall through from a partially successful earlier unit-based candidate to a later fully consuming existing candidate
- direct planning auto interpretation can do the same
- unit-based `auto` no longer stops on a candidate that silently leaves its own reply units behind
- label-based `auto` no longer accepts replies that leave explicit labels unconsumed
- existing explicit `sourceResponseFormat` still bypasses `auto`
