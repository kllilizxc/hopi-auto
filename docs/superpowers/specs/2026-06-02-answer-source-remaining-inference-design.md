# Answer Source Remaining Inference Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let leftover reusable `answerSources` entries directly materialize brand-new durable decision topics or remaining planner answers, without forcing assistant or API callers to restate those same summaries again in `answers[]` or `followThrough.answers[]`.

## Why This Slice Exists

The existing answer-source authority path already supported:

- explicit `answerSources` plus per-item `answerSourceKey` mapping
- `pending_answer_sources` when source order itself was intended to be the authority for more than one already-known pending consumer
- `matching_answer_sources` when source labels or hints were intended to be the authority for more than one already-known pending consumer

That still left one narrower manual gap:

- assistant could already extract reusable answer snippets explicitly
- some of those snippets could feed known pending consumers
- other snippets could already be explicit enough to become new durable decision topics or planner answers on their own
- callers still had to restate those leftover snippet summaries again inside `answers[]` or `followThrough.answers[]`, even though the reusable sources already carried that authority

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- stay deterministic
- do not infer summaries from raw snippet text, source keys, or fuzzy semantic matching
- require explicit `summary` authority on any leftover source entry that should materialize directly
- reuse the existing shared answer-interpretation runtime across assistant, Bun API, and direct planning surfaces

## Implemented Scope

### Remaining Ordered Or Matching Answer Sources

`pending_answer_sources` and `matching_answer_sources` now also support:

- `inferDecisionTopics: true`
- `followThrough.inferRemainingAnswers: true`

when leftover reusable source entries remain after the already-known pending consumers have been materialized.

### Consumption Order

Runtime still consumes reusable source entries in the same existing order:

1. explicit decision answers
2. inferred open decisions
3. explicit planner answers

Only the leftover reusable source entries after that existing consumption step become candidates for:

- new durable decision topics through `inferDecisionTopics`
- remaining planner answers through `followThrough.inferRemainingAnswers`

### Required Source Metadata

Any leftover reusable source entry that should materialize directly must already carry:

- `summary`

and may also carry:

- `prompt`
- `matchHints`

If `prompt` is omitted, runtime synthesizes one canonical prompt from the explicit `summary`.

If `matchHints` are present, runtime carries them through onto the materialized durable decision or planner answer.

### Supported Surfaces

This remaining-source inference now works for:

- answer-driven Bun API decision routes
- answer-driven assistant actions
- direct planning request Bun API routes
- decision-backed follow-through planning surfaces

## Non-Goals

- inferring summaries from raw `answer` text or `sourceExcerpt`
- allowing leftover reusable source entries without explicit `summary`
- fuzzy matching between leftover source entries and brand-new topics
- replacing the earlier structured `question_*`, `topic_*`, `ordered_*`, or labeled reply surfaces

## Acceptance Criteria

- remaining `matching_answer_sources` entries can create new durable decision topics without repeating those summaries in explicit `answers[]`
- remaining `pending_answer_sources` or `matching_answer_sources` entries can create inferred planner answers without repeating those summaries in explicit `followThrough.answers[]`
- assistant and Bun API both accept richer reusable source metadata on `answerSources`
- runtime rejects leftover reusable source entries that omit explicit `summary` when they are asked to materialize directly
