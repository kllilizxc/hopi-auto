# Topic Surface Decision Inference Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let answer-driven `topic_sentences` and `topic_paragraphs` infer brand-new durable decision topics directly from less-structured reply prose, without requiring inline labels, labeled sections, ordered reply structure, or explicit per-topic mapping fields.

## Why This Slice Exists

The prior answer-interpretation work already supported:

- explicit decision answers on `topic_sentences` and `topic_paragraphs`
- open-decision reuse on those same surfaces
- durable prompt matching for known decisions on those surfaces

But remaining topic-bearing sentence and paragraph replies still could not become new durable decision topics. That kept `inferDecisionTopics` artificially gated behind:

- `labeled_sections`
- `inline_topics`
- `question_blocks`
- `question_spans`

This slice closes that gap for sentence and paragraph topic surfaces while staying deterministic.

## Constraints

- keep `decisions.yml` as the only durable decision-topic authority
- do not add a second inferred-topic cache or topic metadata store
- preserve current `topic_sentences` and `topic_paragraphs` matching behavior for explicit answers and open decisions
- stay deterministic
- do not introduce fuzzy topic extraction, embeddings, synonym search, or model-assisted summarization
- keep `topic_blocks` out of scope for brand-new topic inference in this slice

## Implemented Scope

### `inferDecisionTopics` on `topic_sentences`

`inferDecisionTopics` now accepts `sourceResponseFormat: "topic_sentences"`.

For each remaining unreserved sentence:

- explicit answer matches still win first
- inferred open-decision matches still win next
- reserved planner-answer summaries still win after that
- any still-unclaimed sentence may become a new durable decision topic

The summary is inferred deterministically from an explicit trailing topic phrase of the form:

- `... for auth strategy.`
- `... for rollout strategy.`

The durable answer remains the full original sentence text.

### `inferDecisionTopics` on `topic_paragraphs`

`inferDecisionTopics` now also accepts `sourceResponseFormat: "topic_paragraphs"`.

For each remaining unreserved paragraph:

- runtime inspects the paragraph’s sentences
- it extracts exactly one trailing topic phrase such as `for auth strategy`
- that phrase becomes the inferred durable decision summary
- the full paragraph remains the durable answer text

If no summary can be extracted, or more than one summary is inferred from one paragraph, runtime fails deterministically.

### Known Decision Reuse

When an inferred topic-bearing sentence or paragraph already corresponds to one known durable decision, runtime reuses that durable decision instead of creating a duplicate topic.

If more than one existing decision matches the same inferred sentence or paragraph, runtime fails deterministically.

## Non-Goals

- inferring brand-new decision topics from `topic_blocks`
- inferring planner-answer summaries automatically from remaining topic-bearing prose
- extracting topics from sentences or paragraphs that do not contain an explicit trailing topic phrase
- semantic summarization or paraphrase generation

## Acceptance Criteria

- `inferDecisionTopics` accepts `topic_sentences` and can turn remaining topic-bearing sentences into new durable decision topics
- `inferDecisionTopics` accepts `topic_paragraphs` and can turn remaining topic-bearing paragraphs into new durable decision topics
- reserved planner summaries still prevent those same items from being materialized as decisions
- Bun API and Goal assistant both use the same shared interpreter path
- runtime remains deterministic and does not introduce fuzzy topic inference
