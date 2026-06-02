# Topic Sentence Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured natural-language reply deterministically feed durable decision answers and planner follow-through answers when each answer already appears in its own sentence and that sentence still names the relevant known topic somewhere inside it.

## Why This Slice Exists

The current system already supported:

- whole-reply reuse through root `sourceResponse`
- reusable named snippets through `answerSources`
- direct and named excerpt grounding
- line-based labeled sections
- ordered-item replies
- inline topic clauses with front-loaded labels
- current-open-decision reuse from structured replies
- remaining labeled or inline-topic inference into new durable decision topics

That still left one narrower authority gap:

- a user reply might already be deterministic enough because each sentence answers one known topic
- but the topic might appear later in the sentence instead of at the front of a labeled line or inline clause
- the missing surface was sentence-level topic matching for already-known topics, not brand-new topic inference from free prose

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not infer brand-new decision topics from unlabeled prose in this slice
- preserve existing labeled-section, ordered-item, inline-topic, excerpt, and explicit-answer paths

## Implemented Scope

### Root `sourceResponseFormat: "topic_sentences"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "topic_sentences"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Sentence Shape

Topic-sentence replies are interpreted as sentences such as:

- `We should use Bun-native auth for auth strategy.`
- `Use a staged rollout for rollout strategy.`
- `Start with five enterprise customers before broader launch for pilot scope.`

Sentences can be separated by:

- sentence boundaries
- semicolons
- newlines

The topic label no longer needs to lead the clause, but it must still appear explicitly somewhere in the sentence so runtime can match it deterministically.

### Deterministic Sentence Matching

Runtime now parses topic-sentence replies into stable sentence entries and matches them by:

- splitting the reply into sentence-like segments
- normalizing each segment plus each known candidate topic label
- matching a segment when it contains exactly one unconsumed known topic candidate
- returning the full matched sentence as the durable answer text instead of inventing a summarized rewrite

Because the full sentence becomes the durable answer, this slice does not introduce fuzzy extraction or paraphrase logic.

### Shared Reuse Across Existing Surfaces

Once parsed, the same topic-sentence surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `followThrough.answers`

That means one reply like:

- `We should use Bun-native auth for auth strategy. Use a staged rollout for rollout strategy. Start with five enterprise customers before broader launch for pilot scope.`

can:

- resolve explicit or open auth and rollout decisions
- keep `Pilot scope` on planner follow-through

without requiring front-loaded inline topic labels or ordered bullets.

### Deterministic Validation

Runtime now rejects topic-sentence interpretation deterministically when:

- `sourceResponseFormat` is `topic_sentences` but `sourceResponse` is missing
- a requested explicit or open decision topic has no matching sentence
- more than one sentence matches the same requested topic

`inferOpenDecisions` now accepts `topic_sentences` alongside `labeled_sections`, `ordered_items`, and `inline_topics`.

### Explicit Non-Goal for This Slice

`inferDecisionTopics` still does not accept `topic_sentences`.

Without an explicit front-loaded label, line label, or other stable topic declaration, this slice does not treat a sentence as authority for creating a brand-new durable decision topic.

## Non-Goals

- inferring brand-new decision topics from loose prose
- embeddings, fuzzy matching, or semantic search
- paraphrasing matched sentences into shorter synthetic answers
- replacing inline-topic interpretation when the topic already leads the clause

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one topic-sentence reply without inline labels or ordered lists
- current open decisions can be resolved from topic sentences without per-topic mapping
- planner follow-through answers can consume the remaining matching topic sentence from the same shared reply
- missing or multiply matched topic sentences fail deterministically
