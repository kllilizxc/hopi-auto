# Question Span Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one inline question-and-answer style shared reply deterministically feed durable decision answers, planner follow-through answers, and inferred decision topics even when the answer sentences themselves no longer repeat the topic name or sit in separate question paragraphs.

## Why This Slice Exists

The current system already supported:

- whole-reply reuse through root `sourceResponse`
- reusable named snippets through `answerSources`
- direct and named excerpt grounding
- line-based labeled sections
- ordered-item replies
- ordered multi-paragraph reply blocks
- question-and-answer paragraph blocks
- inline topic clauses with front-loaded labels
- sentence-level topic matching for already-known topics
- paragraph-level topic matching for already-known topics
- anchored topic-block matching for already-known topics
- current-open-decision reuse from structured replies
- remaining labeled, inline-topic, or question-block inference into new durable decision topics

That still left one narrower authority gap:

- a user reply might already be written as inline question and answer turns
- the question sentence may name the durable topic clearly enough
- but the answer sentences may never repeat that topic name again
- the missing surface was question-anchored answer spans, not fuzzy topic inference from fully loose prose

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- stay deterministic
- preserve existing labeled-section, ordered-item, ordered-block, question-block, inline-topic, topic-sentence, topic-paragraph, topic-block, excerpt, and explicit-answer paths

## Implemented Scope

### Root `sourceResponseFormat: "question_spans"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "question_spans"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Span Shape

Question-span replies are interpreted as sentence-level question and answer turns where:

- a question sentence ends with `?`
- that question sentence names the durable topic
- every following non-question sentence belongs to that question's answer span
- the answer span ends immediately before the next question sentence

Example:

- `Auth strategy?`
- `Use Bun-native auth.`
- `That keeps the runtime simple.`
- `Rollout strategy?`
- `Use a staged rollout.`

The durable answer text is the joined answer span only. The question sentence itself is not copied into the answer.

### Deterministic Matching

Runtime now parses question-span replies by:

- splitting the reply into sentences
- treating sentences that end with `?` as question anchors
- requiring each question anchor to have at least one following non-question answer sentence
- matching requested durable topics against the normalized question sentence text
- returning the full collected answer span as the durable answer text

This keeps the surface deterministic while dropping the extra requirement that each question turn must be separated into its own paragraph block.

### Shared Reuse Across Existing Surfaces

Once parsed, the same question-span surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `followThrough.answers`

That means one reply such as:

- `Auth strategy? Use Bun-native auth. That keeps the runtime simple.`
- `Rollout strategy? Use a staged rollout. That keeps the launch reversible.`
- `Pilot scope? Start with five enterprise customers before broader launch. That keeps early support manageable.`

can resolve known auth and rollout decisions first, then preserve the remaining pilot answer span on planner follow-through.

### Deterministic New Decision Inference

`inferDecisionTopics` now also accepts `question_spans`.

For this surface:

- reserved explicit decision answers still win first
- reserved inferred current open decisions still win next
- reserved planner-only summaries still win after that
- every remaining question span becomes a durable decision topic
- the inferred decision summary is the question sentence with the trailing `?` removed

Because that summary comes directly from the question sentence, this slice is best suited to concise topic-question anchors such as `Auth strategy?` or `Rollback trigger?`.

### Deterministic Validation

Runtime now rejects question-span interpretation deterministically when:

- `sourceResponseFormat` is `question_spans` but `sourceResponse` is missing
- `sourceResponse` does not start with a question sentence
- a matched question sentence has no answer sentence
- a requested explicit or open decision topic has no matching question span
- more than one question span matches the same requested topic
- more than one existing known decision matches one inferred remaining question span

`inferOpenDecisions` now accepts `question_spans` alongside `labeled_sections`, `ordered_items`, `ordered_blocks`, `question_blocks`, `inline_topics`, `topic_sentences`, `topic_paragraphs`, and `topic_blocks`.

## Non-Goals

- inferring topics from answer sentences that have no question anchor
- semantic search, embeddings, or fuzzy topic extraction
- synthesizing shorter paraphrased answers from the collected answer spans
- inferring planner-answer summaries from fully loose prose with no explicit question sentences

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one inline question-span reply without repeating the topic name inside the answer sentences
- current open decisions can be resolved from question spans without per-topic mapping
- remaining question spans can become new durable decision topics when planner-only summaries are reserved first
- planner follow-through answers can consume the remaining question-span answer from the same shared reply
- malformed or ambiguously matched question spans fail deterministically
