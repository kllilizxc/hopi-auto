# Topic Block Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured natural-language reply deterministically feed durable decision answers and planner follow-through answers when each answer starts with one anchor paragraph that names the relevant known topic and then continues through later unlabeled paragraphs until the next anchor paragraph appears.

## Why This Slice Exists

The current system already supported:

- whole-reply reuse through root `sourceResponse`
- reusable named snippets through `answerSources`
- direct and named excerpt grounding
- line-based labeled sections
- ordered-item replies
- inline topic clauses with front-loaded labels
- single-sentence topic matching for already-known topics
- single-paragraph topic matching for already-known topics
- current-open-decision reuse from structured replies
- remaining labeled or inline-topic inference into new durable decision topics

That still left one narrower authority gap:

- a user reply might already be deterministic enough because each answer starts with one paragraph that names the topic
- but the explanation may continue in later paragraphs that never repeat the topic name
- the missing surface was anchored multi-paragraph block matching for already-known topics, not brand-new topic inference from loose prose

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not infer brand-new decision topics from loose multi-paragraph prose in this slice
- preserve existing labeled-section, ordered-item, inline-topic, topic-sentence, topic-paragraph, excerpt, and explicit-answer paths

## Implemented Scope

### Root `sourceResponseFormat: "topic_blocks"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "topic_blocks"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Block Shape

Topic-block replies are interpreted as blank-line-separated paragraphs such as:

- `We should use Bun-native auth for auth strategy.`
- `That keeps the runtime simple.`
- `Use a staged rollout for rollout strategy.`
- `That keeps the launch reversible.`

where a new topic block starts whenever a paragraph explicitly names one known topic candidate.

The block for a topic contains:

- the anchor paragraph that names the topic
- every following paragraph that names no other known topic
- stopping immediately before the next anchor paragraph

### Deterministic Block Matching

Runtime now parses topic-block replies by:

- splitting the reply into blank-line-separated paragraphs
- normalizing each paragraph plus every currently known topic candidate
- treating a paragraph as a block anchor only when it matches exactly one known topic candidate
- appending later non-anchor paragraphs onto that active block until the next anchor paragraph appears
- returning the full block text as the durable answer instead of inventing a summarized rewrite

Because blocks are still anchored by explicit known topics, this slice remains deterministic and does not depend on semantic search or fuzzy extraction.

### Shared Reuse Across Existing Surfaces

Once parsed, the same topic-block surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `followThrough.answers`

That means one reply with:

- one auth anchor paragraph plus follow-up rationale paragraph
- one rollout anchor paragraph plus follow-up rationale paragraph
- one pilot-scope anchor paragraph plus follow-up rationale paragraph

can resolve known auth and rollout decisions while preserving the full pilot block on planner follow-through.

### Deterministic Validation

Runtime now rejects topic-block interpretation deterministically when:

- `sourceResponseFormat` is `topic_blocks` but `sourceResponse` is missing
- a requested explicit or open decision topic has no matching anchored block
- more than one anchored block matches the same requested topic
- one anchor paragraph matches more than one known topic candidate

`inferOpenDecisions` now accepts `topic_blocks` alongside `labeled_sections`, `ordered_items`, `inline_topics`, `topic_sentences`, and `topic_paragraphs`.

### Explicit Non-Goal For This Slice

`inferDecisionTopics` still does not accept `topic_blocks`.

Without an explicit front-loaded label, line label, or other stable topic declaration for brand-new topics, this slice does not treat an anchored block as authority for creating a new durable decision topic.

## Non-Goals

- inferring brand-new decision topics from loose multi-paragraph prose
- embeddings, fuzzy matching, or semantic search
- paraphrasing matched blocks into shorter synthetic answers
- replacing topic-paragraph interpretation when one paragraph already contains the full answer

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one anchored topic-block reply without repeating the topic name in every continuation paragraph
- current open decisions can be resolved from anchored topic blocks without per-topic mapping
- planner follow-through answers can consume the remaining anchored topic block from the same shared reply
- missing or multiply matched anchored topic blocks fail deterministically
