# Prefixed Topic Summary Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let topic-surface answer interpretation infer durable decision-topic summaries and planner-answer summaries from prefixed topic phrases like `For auth strategy, ...` or `About pilot scope, ...`, instead of depending only on leading subject phrases like `Auth strategy should ...` or trailing phrases like `... for auth strategy`.

## Why This Slice Exists

The current topic-surface interpretation path already supported:

- leading topic phrases like `Auth strategy should ...`
- trailing topic phrases like `... for auth strategy`

That still left a real deterministic gap in more natural prose:

- `For auth strategy, use Bun-native auth.`
- `Regarding rollout strategy, use a staged rollout.`
- `About pilot scope, start with five enterprise customers before broader launch.`

Humans can read those as stable topic-bearing answers immediately, but the shared interpreter still could not:

- infer brand-new durable decision topics from them
- infer remaining planner answers from topic blocks built from them
- use them as fallback topic-block anchors when no stronger explicit candidate label was present

## Constraints

- keep the interpreter deterministic
- reuse the current topic-surface substrate instead of adding a second fuzzy classifier
- require explicit prefixed-topic punctuation boundaries, not broad semantic guessing
- preserve existing leading-topic and trailing-topic behavior

## Implemented Scope

### Shared Prefixed Topic-Phrase Extraction

The shared topic-summary extractor now recognizes prefixed topic phrases of the form:

- `For <summary>, ...`
- `About <summary>, ...`
- `Regarding <summary>, ...`
- `On <summary>, ...`

This path is intentionally narrow:

- the prefixed topic phrase must appear at the start of the sentence or paragraph
- it must include an explicit separator like `,`, `:`, or `-`
- implausibly long or empty summaries are rejected

### Topic Sentence And Paragraph Summary Inference

`topic_sentences` and `topic_paragraphs` now reuse that prefixed-topic extractor when materializing:

- remaining inferred decision topics
- remaining inferred planner answers

So `For auth strategy, use Bun-native auth.` now yields:

- summary: `Auth strategy`
- answer: the original sentence

without requiring `Auth strategy should ...` or `... for auth strategy`.

### Topic Block Anchor Inference

`topic_blocks` now reuse the same prefixed-topic extractor for fallback anchor detection.

That means a block whose first paragraph begins with:

- `For auth strategy, use Bun-native auth.`

can become a stable topic block even when it does not repeat the topic later in that paragraph and does not carry a stronger explicit anchor label from another authority.

This directly strengthens both:

- `inferDecisionTopics`
- `followThrough.inferRemainingAnswers`

on topic-block replies.

### Ambiguity Guard

The earlier leading-topic extractor now explicitly rejects prefixed-topic starters like `regarding` or `about`, so one sentence cannot materialize two competing summaries through both paths.

## Non-Goals

- fuzzy topic inference from generic prose like `Use Bun-native auth to keep the runtime simple.`
- removing the need for any explicit topic-bearing phrase at all
- inferring summaries from arbitrary sentence-internal noun phrases without a stable prefix or suffix authority

## Acceptance Criteria

- `topic_sentences` can infer new durable decision topics from prefixed topic phrases
- `topic_paragraphs` inherit the same prefixed-topic summary inference
- `topic_blocks` can infer remaining planner answers and new durable decision topics from prefixed topic anchor paragraphs
- the shared interpreter does not double-infer conflicting summaries from one prefixed topic sentence
