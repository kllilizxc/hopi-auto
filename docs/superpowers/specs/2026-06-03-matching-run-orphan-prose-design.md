# Matching Run Orphan Prose Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Tighten `sourceResponseFormat: "matching_runs"` so it only merges repeated stretches that still belong to the same already-known consumer, and fails closed on orphan prose that sits outside those real runs.

## Why This Slice Exists

The initial `matching_runs` surface correctly solved one authority gap:

- one shared reply could revisit the same already-known decision or planner-answer consumer more than once
- runtime could merge those repeated stretches into one durable answer instead of over-splitting them

But one part of the first implementation was still too permissive:

- unmatched prose before the first matched run could be prepended into that first run
- unmatched prose between two different matched consumers could be absorbed into the earlier run
- unmatched prose after the last matched run could be appended into that last run

That meant unrelated text could hitchhike on a known consumer even though runtime had never established authority for that prose.

The long-term route should keep the useful “same consumer continuation” behavior while failing closed on truly orphaned prose.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not add fuzzy or semantic matching
- do not invent a new parser family
- keep explicit `matching_runs` narrower than topic or question inference

## Implemented Scope

### Same-Consumer Continuation Still Works

`matching_runs` still:

- splits the shared reply into deterministic paragraphs, sentences, clauses, or one whole reply
- registers the eligible known consumer groups
- merges repeated stretches when the next matched unit still belongs to the same consumer

So these cases still succeed:

- one decision answer appears, then a continuation sentence that does not restate the topic, then the same decision answer is mentioned again
- one explicit planner-answer consumer appears, then a continuation paragraph elaborates it, then the same planner-answer consumer is mentioned again

### Orphan Prose Now Fails Closed

Runtime now rejects three cases:

- unmatched prose before the first matched consumer run
- unmatched prose between two different matched consumers
- unmatched prose after the last matched consumer run

Those cases now produce deterministic errors instead of being silently absorbed into the nearest matched run.

### Narrow Buffering Rule

Unmatched units may be buffered only temporarily:

- if the next matched unit belongs to the same current consumer, that buffered prose is merged into the existing run
- if the next matched unit belongs to a different consumer, runtime throws
- if no later matched unit exists, runtime throws

## Example

Given:

- one known `Auth strategy` consumer
- one known `Rollout strategy` consumer
- `sourceResponseFormat: "matching_runs"`

This reply still succeeds:

- `Auth strategy should use Bun-native auth.`
- `That keeps deployment simple for the Bun-first path.`
- `Auth strategy should stay self-hostable.`
- `Rollout strategy should use a staged launch.`

But this reply now fails closed:

- `Auth strategy should use Bun-native auth.`
- `Release codename stays Aurora.`
- `Rollout strategy should use a staged launch.`

because the middle paragraph never established authority for either known consumer.

## Non-Goals

- changing `matching_runs` into brand-new decision-topic inference
- changing `matching_runs` into remaining planner-answer inference
- guessing which neighboring consumer should own unrelated prose
- widening `matching_runs` into fuzzy topical grouping

## Acceptance Criteria

- repeated stretches for the same already-known consumer still merge into one matching run
- unmatched prose before the first matched run fails closed
- unmatched prose between different matched consumers fails closed
- unmatched prose after the last matched run fails closed
- direct Bun API and shared runtime tests cover the new deterministic errors
