# Topic Block Decision Inference Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let answer-driven `topic_blocks` infer brand-new durable decision topics directly from anchored multi-paragraph reply prose, without requiring every paragraph to restate the topic, and without falling back to line-based labels, ordered structures, or explicit per-topic mapping fields.

## Why This Slice Exists

The prior answer-interpretation work already supported:

- explicit decision answers on `topic_blocks`
- open-decision reuse on `topic_blocks`
- durable prompt keyword reuse on `topic_blocks`
- brand-new decision-topic inference on `topic_sentences` and `topic_paragraphs`

But remaining anchored topic blocks still could not become new durable decision topics. That left multi-paragraph answer prose in an odd split state: assistant could reuse or reserve known block answers, but could not promote the leftover anchored blocks into new durable decisions.

This slice closes that gap while staying deterministic and keeping `decisions.yml` as the only durable decision-topic authority.

## Constraints

- keep `decisions.yml` as the only durable decision-topic authority
- do not add a second inferred-topic cache or topic metadata store
- preserve existing `topic_blocks` behavior for explicit answers, open decisions, and planner follow-through answers
- stay deterministic
- do not introduce fuzzy topic extraction, embeddings, synonym search, or model-assisted summarization
- do not require continuation paragraphs to repeat the topic label

## Implemented Scope

### `inferDecisionTopics` on `topic_blocks`

`inferDecisionTopics` now accepts `sourceResponseFormat: "topic_blocks"`.

For each remaining unreserved block:

- explicit answer matches still win first
- inferred open-decision matches still win next
- reserved planner-answer summaries still win after that
- any still-unclaimed anchored block may become a new durable decision topic

The durable answer remains the full block text, including continuation paragraphs.

### Deterministic Anchor Discovery

`topic_blocks` parsing now accepts two deterministic anchor paths:

1. an anchor paragraph that matches an already-registered candidate label
2. an anchor paragraph whose trailing text contains an explicit topic phrase such as `for auth strategy`

The second path is what allows brand-new durable decision topics to materialize when there is no preexisting open decision surface or explicit `answers[]` mapping.

### Summary Inference

When a remaining block does not match one existing durable decision, runtime infers the new durable decision summary from the block’s anchor paragraph.

That summary must be derivable deterministically from an explicit trailing topic phrase. Continuation paragraphs do not contribute their own summary authority.

### Known Decision Reuse

When a remaining anchored block already corresponds to one known durable decision, runtime reuses that durable decision instead of creating a duplicate topic.

If more than one existing decision matches the same block, runtime fails deterministically.

## Non-Goals

- inferring brand-new decision topics from topic prose that has no anchor paragraph authority
- inferring planner-answer summaries automatically from remaining anchored blocks
- semantic summarization or paraphrase generation
- fuzzy block matching beyond the existing deterministic candidate and prompt-keyword rules

## Acceptance Criteria

- `inferDecisionTopics` accepts `topic_blocks` and can turn remaining anchored blocks into new durable decision topics
- planner reserved summaries still prevent those same blocks from being materialized as decisions
- known durable decisions are still reused when an anchored block already matches one current decision
- Bun API and Goal assistant both use the same shared interpreter path
- runtime remains deterministic and does not introduce fuzzy topic inference
