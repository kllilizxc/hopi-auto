# As-Topic Summary Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let topic-surface answer interpretation infer durable decision-topic summaries and planner-answer summaries from deterministic `... as the <topic>` phrases, instead of depending only on leading phrases like `Auth strategy should ...`, prefixed phrases like `For auth strategy, ...`, or trailing phrases like `... for auth strategy`.

## Why This Slice Exists

The shared topic-summary extractor already supported:

- leading topic phrases like `Auth strategy should use Bun-native auth.`
- prefixed topic phrases like `For auth strategy, use Bun-native auth.`
- trailing topic phrases like `Use Bun-native auth for auth strategy.`

That still left a real deterministic gap in natural prose:

- `Use Bun-native auth as the auth strategy.`
- `Use a staged rollout as the rollout strategy.`
- `Start with five enterprise customers before broader launch as the pilot scope.`

Humans can read those as stable topic-bearing answers immediately, but the shared interpreter still could not:

- infer brand-new durable decision topics from them
- infer remaining planner answers from topic blocks built from them
- use them as fallback topic-block anchors when no stronger explicit candidate label was present

## Constraints

- keep the interpreter deterministic
- reuse the current topic-surface substrate instead of adding a second fuzzy classifier
- require an explicit `as the <topic>` / `as a <topic>` / `as an <topic>` authority near the end of the sentence or paragraph
- preserve existing leading-topic, prefixed-topic, and trailing-topic behavior

## Implemented Scope

### Shared As-Topic Extraction

The shared topic-summary extractor now recognizes deterministic trailing `as` phrases of the form:

- `... as the <summary>`
- `... as a <summary>`
- `... as an <summary>`

This path is intentionally narrow:

- the `as` topic phrase must appear near the end of the sentence or paragraph
- the inferred summary must still pass the same short, non-pronominal topic guardrails as the leading and prefixed paths
- no fuzzy noun-phrase guessing is introduced

### Topic Sentence And Paragraph Summary Inference

`topic_sentences` and `topic_paragraphs` now reuse that shared `as-topic` extractor when materializing:

- remaining inferred decision topics
- remaining inferred planner answers

So `Use Bun-native auth as the auth strategy.` now yields:

- summary: `Auth strategy`
- answer: the original sentence

without requiring `Auth strategy should ...`, `For auth strategy, ...`, or `... for auth strategy`.

### Topic Block Anchor Inference

`topic_blocks` now also reuse the same `as-topic` extractor for fallback anchor detection.

That means a block whose first paragraph begins with:

- `Use Bun-native auth as the auth strategy.`

can become a stable topic block even when it does not repeat the topic later in that paragraph and does not carry a stronger explicit anchor label from another authority.

This directly strengthens both:

- `inferDecisionTopics`
- `followThrough.inferRemainingAnswers`

on topic-block replies.

## Non-Goals

- fuzzy topic inference from generic prose like `Use Bun-native auth to keep the runtime simple.`
- extracting summaries from arbitrary mid-sentence noun phrases that are not explicitly attached through `as`
- removing the need for any explicit topic-bearing phrase at all

## Acceptance Criteria

- `topic_sentences` can infer new durable decision topics from deterministic `as-topic` phrases
- `topic_paragraphs` inherit the same `as-topic` summary inference
- `topic_blocks` can infer remaining planner answers and new durable decision topics from `as-topic` anchor paragraphs
- the shared interpreter preserves the current leading-topic, prefixed-topic, and trailing-topic behavior
