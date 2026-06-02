# Prompt-Keyword Topic Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let answer-driven `topic_sentences` and `topic_paragraphs` reuse durable decision prompts as deterministic matching authority, so known open decisions no longer require explicit topic names inside every mapped sentence or paragraph.

## Why This Slice Exists

The prior topic-based answer interpretation already supported:

- `topic_sentences`
- `topic_paragraphs`
- `topic_blocks`

But known-decision matching on those surfaces still depended on direct containment of:

- humanized `decisionKey`
- concise `summary`
- exact durable `prompt`

That meant the sentence or paragraph itself still had to explicitly mention the topic label in most realistic cases, even when it already preserved the meaningful prompt keywords from the durable question.

This slice closes that gap for sentence and paragraph surfaces without expanding into fuzzy topic inference.

## Constraints

- keep `decisions.yml` as the only durable decision-topic authority
- do not add a second prompt-alias or normalized-topic store
- preserve existing exact topic-label matches
- stay deterministic
- do not introduce embeddings, synonym expansion, or semantic similarity ranking
- keep `topic_blocks` out of scope for this slice because its anchor-detection surface is narrower and should evolve separately

## Implemented Scope

### Deterministic Prompt Matching on Topic Sentences

Known-decision matching for `topic_sentences` now reuses the same deterministic candidate ladder already used on question surfaces:

1. normalized full-text containment
2. deterministic prompt-core containment
3. deterministic prompt-keyword anchor matching

This lets a sentence such as:

- `Adopt the Bun-native auth provider for the Bun-first product path.`

match a durable prompt such as:

- `Which auth provider should we adopt for the Bun-first product path?`

even though the sentence never says `auth strategy`.

### Deterministic Prompt Matching on Topic Paragraphs

Known-decision matching for `topic_paragraphs` now uses the same deterministic candidate ladder.

This lets a paragraph such as:

- `Rollout should happen in stages, not once. That keeps the launch reversible.`

match a durable prompt such as:

- `Should rollout happen in stages or all at once?`

without requiring the paragraph to restate `rollout strategy`.

### Shared Product Path Coverage

Because the change lives in the shared topic matcher, the active product surfaces inherit it automatically:

- Bun decision answer APIs
- Goal assistant answer actions

No product-path-specific interpretation branch or extra durable field is introduced.

## Non-Goals

- prompt-keyword matching for `topic_blocks` anchor detection
- brand-new decision-topic inference from topic sentences or paragraphs
- synonym matching between reply prose and durable prompts
- broader free-form answer interpretation from fully loose prose

## Acceptance Criteria

- current durable decisions can be resolved from `topic_sentences` when the sentence preserves the durable prompt’s meaningful keywords but omits the explicit topic label
- current durable decisions can be resolved from `topic_paragraphs` under the same deterministic prompt-keyword rule
- Bun API and Goal assistant both use the same shared topic matcher
- runtime remains deterministic and does not introduce fuzzy prompt matching
