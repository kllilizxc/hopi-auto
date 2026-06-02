# Copular Topic Summary Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let topic-surface answer interpretation infer durable decision-topic summaries and planner-answer summaries from deterministic answer-first copular phrases like `Bun-native auth should be the auth strategy.` or `Five enterprise customers should be the pilot scope.`, instead of misreading the answer phrase itself as the durable topic summary.

## Why This Slice Exists

The shared topic-summary extractor already supported:

- leading topic phrases like `Auth strategy should use Bun-native auth.`
- prefixed topic phrases like `For auth strategy, use Bun-native auth.`
- trailing topic phrases like `Use Bun-native auth for auth strategy.`
- `as-topic` phrases like `Use Bun-native auth as the auth strategy.`

That still left one deterministic gap in answer-first prose:

- `Bun-native auth should be the auth strategy.`
- `A staged rollout should be the rollout strategy.`
- `Five enterprise customers should be the pilot scope.`

Humans read those as stable topic-bearing answers immediately, but the shared interpreter still preferred the leading answer phrase:

- summary: `Bun-native auth`
- summary: `Staged rollout`
- summary: `Five enterprise customers`

instead of the intended durable topics:

- `Auth strategy`
- `Rollout strategy`
- `Pilot scope`

## Constraints

- keep the interpreter deterministic
- reuse the current topic-surface substrate instead of introducing fuzzy topic inference
- require one explicit copular authority like `should be the <topic>` or `is the <topic>`
- preserve the current leading-topic, prefixed-topic, trailing-topic, and `as-topic` behavior

## Implemented Scope

### Shared Copular Topic Extraction

The shared topic-summary extractor now recognizes deterministic copular topic phrases of the form:

- `... should be the <summary>`
- `... will be the <summary>`
- `... must be the <summary>`
- `... is the <summary>`
- `... serves as the <summary>`

with the same short-summary guardrails already used by the other topic-summary extractors.

This path is intentionally narrow:

- one explicit article-backed topic phrase must appear in predicate position
- the inferred summary must still be short and non-pronominal
- no synonym expansion or semantic similarity search is introduced

### Topic Sentence And Paragraph Summary Inference

`topic_sentences` and `topic_paragraphs` now reuse that shared copular extractor when materializing:

- remaining inferred decision topics
- remaining inferred planner answers

So `Bun-native auth should be the auth strategy.` now yields:

- summary: `Auth strategy`
- answer: the original sentence

instead of incorrectly elevating `Bun-native auth` to the durable topic summary.

### Topic Block Anchor Inference

`topic_blocks` now also reuse the same copular extractor for fallback anchor detection.

That means a block whose first paragraph begins with:

- `Five enterprise customers should be the pilot scope.`

can become a stable topic block even when the continuation paragraphs no longer restate the topic.

This directly strengthens both:

- `inferDecisionTopics`
- `followThrough.inferRemainingAnswers`

on topic-block replies.

## Non-Goals

- fuzzy topic inference from generic prose like `Bun-native auth keeps the runtime simple.`
- inferring topics from sentences that never explicitly place a topic phrase in predicate position
- removing the need for any explicit topic-bearing phrase at all

## Acceptance Criteria

- `topic_sentences` can infer new durable decision topics from deterministic copular topic phrases
- `topic_paragraphs` inherit the same copular summary inference
- `topic_blocks` can infer remaining planner answers and new durable decision topics from copular anchor paragraphs
- the shared interpreter preserves the current leading-topic, prefixed-topic, trailing-topic, and `as-topic` behavior
