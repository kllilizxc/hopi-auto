# Topic Paragraph Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured natural-language reply deterministically feed durable decision answers and planner follow-through answers when each answer already lives in its own multi-sentence paragraph and that paragraph still names the relevant known topic at least once.

## Why This Slice Exists

The current system already supported:

- whole-reply reuse through root `sourceResponse`
- reusable named snippets through `answerSources`
- direct and named excerpt grounding
- line-based labeled sections
- ordered-item replies
- inline topic clauses with front-loaded labels
- single-sentence topic matching for already-known topics
- current-open-decision reuse from structured replies
- remaining labeled or inline-topic inference into new durable decision topics

That still left one narrower authority gap:

- a user reply might already be deterministic enough because each answer sits in its own paragraph
- but only one sentence in that paragraph may bother to repeat the topic name
- the missing surface was paragraph-level topic matching for already-known topics, not brand-new topic inference from loose prose

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not infer brand-new decision topics from paragraph prose in this slice
- preserve existing labeled-section, ordered-item, inline-topic, topic-sentence, excerpt, and explicit-answer paths

## Implemented Scope

### Root `sourceResponseFormat: "topic_paragraphs"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "topic_paragraphs"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Paragraph Shape

Topic-paragraph replies are interpreted as blank-line-separated paragraphs such as:

- `We should use Bun-native auth for auth strategy. That keeps the runtime simple.`
- `Use a staged rollout for rollout strategy. That keeps the launch reversible.`
- `Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.`

Paragraphs are separated by one or more blank lines.

The topic label no longer needs to appear in every sentence, but it must still appear somewhere inside the paragraph so runtime can match that paragraph deterministically.

### Deterministic Paragraph Matching

Runtime now parses topic-paragraph replies into stable paragraph entries and matches them by:

- splitting the reply into blank-line-separated paragraphs
- normalizing each paragraph plus each known candidate topic label
- matching a paragraph when it contains exactly one unconsumed known topic candidate
- returning the full matched paragraph as the durable answer text instead of inventing a summarized rewrite

Because the full paragraph becomes the durable answer, this slice still avoids fuzzy extraction or paraphrase logic.

### Shared Reuse Across Existing Surfaces

Once parsed, the same topic-paragraph surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `followThrough.answers`

That means one reply with three blank-line-separated paragraphs can:

- resolve explicit or open auth and rollout decisions
- keep `Pilot scope` on planner follow-through

without requiring the topic name to reappear in every sentence.

### Deterministic Validation

Runtime now rejects topic-paragraph interpretation deterministically when:

- `sourceResponseFormat` is `topic_paragraphs` but `sourceResponse` is missing
- a requested explicit or open decision topic has no matching paragraph
- more than one paragraph matches the same requested topic

`inferOpenDecisions` now accepts `topic_paragraphs` alongside `labeled_sections`, `ordered_items`, `inline_topics`, and `topic_sentences`.

### Explicit Non-Goal for This Slice

`inferDecisionTopics` still does not accept `topic_paragraphs`.

Without an explicit front-loaded label, line label, or other stable topic declaration, this slice does not treat a paragraph as authority for creating a brand-new durable decision topic.

## Non-Goals

- inferring brand-new decision topics from paragraph prose
- embeddings, fuzzy matching, or semantic search
- paraphrasing matched paragraphs into shorter synthetic answers
- replacing topic-sentence interpretation when one sentence per answer is already sufficient

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one topic-paragraph reply without repeating the topic name in every sentence
- current open decisions can be resolved from topic paragraphs without per-topic mapping
- planner follow-through answers can consume the remaining matching topic paragraph from the same shared reply
- missing or multiply matched topic paragraphs fail deterministically
