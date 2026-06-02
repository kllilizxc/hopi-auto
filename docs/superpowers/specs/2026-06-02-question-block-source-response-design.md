# Question Block Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one question-and-answer style shared reply deterministically feed durable decision answers, planner follow-through answers, and inferred decision topics even when the answer blocks themselves no longer repeat the topic name.

## Why This Slice Exists

The current system already supported:

- whole-reply reuse through root `sourceResponse`
- reusable named snippets through `answerSources`
- direct and named excerpt grounding
- line-based labeled sections
- ordered-item replies
- ordered multi-paragraph reply blocks
- inline topic clauses with front-loaded labels
- sentence-level topic matching for already-known topics
- paragraph-level topic matching for already-known topics
- anchored topic-block matching for already-known topics
- current-open-decision reuse from structured replies
- remaining labeled or inline-topic inference into new durable decision topics

That still left one narrower authority gap:

- a user reply might already be structured as alternating question paragraphs and answer paragraphs
- the question paragraph may name the topic clearly enough
- but the answer paragraphs may never repeat that topic name again
- the missing surface was question-anchored answer blocks, not fuzzy topic inference from fully loose prose

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- stay deterministic
- preserve existing labeled-section, ordered-item, ordered-block, inline-topic, topic-sentence, topic-paragraph, topic-block, excerpt, and explicit-answer paths

## Implemented Scope

### Root `sourceResponseFormat: "question_blocks"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "question_blocks"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Block Shape

Question-block replies are interpreted as blank-line-separated paragraphs where:

- a question paragraph ends with `?`
- that question paragraph names the durable topic
- every following non-question paragraph belongs to that question's answer block
- the answer block ends immediately before the next question paragraph

Example:

- `Auth strategy?`
- blank line
- `Use Bun-native auth.`
- blank line
- `That keeps the runtime simple.`
- blank line
- `Rollout strategy?`
- blank line
- `Use a staged rollout.`

The durable answer text is the answer block only. The question paragraph itself is not copied into the answer.

### Deterministic Matching

Runtime now parses question-block replies by:

- splitting the reply into blank-line-separated paragraphs
- treating paragraphs that end with `?` as question anchors
- requiring each question anchor to have at least one following answer paragraph
- matching requested durable topics against the normalized question paragraph text
- returning the full collected answer block as the durable answer text

This keeps the surface deterministic while allowing the answer paragraphs themselves to stop repeating the topic name.

### Shared Reuse Across Existing Surfaces

Once parsed, the same question-block surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `followThrough.answers`

That means one reply with:

- `Auth strategy?` plus a multi-paragraph answer block
- `Rollout strategy?` plus a multi-paragraph answer block
- `Pilot scope?` plus a multi-paragraph answer block

can resolve known auth and rollout decisions first, then preserve the remaining pilot answer block on planner follow-through.

### Deterministic New Decision Inference

`inferDecisionTopics` now also accepts `question_blocks`.

For this surface:

- reserved explicit decision answers still win first
- reserved inferred current open decisions still win next
- reserved planner-only summaries still win after that
- every remaining question block becomes a durable decision topic
- the inferred decision summary is the question paragraph with the trailing `?` removed

Because that summary comes directly from the question paragraph, this slice is best suited to concise topic-question anchors such as `Auth strategy?` or `Rollback trigger?`.

### Deterministic Validation

Runtime now rejects question-block interpretation deterministically when:

- `sourceResponseFormat` is `question_blocks` but `sourceResponse` is missing
- `sourceResponse` does not start with a question paragraph
- a matched question paragraph has no answer block
- a requested explicit or open decision topic has no matching question block
- more than one question block matches the same requested topic
- more than one existing known decision matches one inferred remaining question block

`inferOpenDecisions` now accepts `question_blocks` alongside `labeled_sections`, `ordered_items`, `ordered_blocks`, `inline_topics`, `topic_sentences`, `topic_paragraphs`, and `topic_blocks`.

## Non-Goals

- inferring topics from answer paragraphs that have no question anchor
- semantic search, embeddings, or fuzzy topic extraction
- synthesizing shorter paraphrased answers from the collected answer blocks
- inferring planner-answer summaries from fully loose prose with no explicit question paragraphs

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one question-block reply without repeating the topic name inside the answer paragraphs
- current open decisions can be resolved from question blocks without per-topic mapping
- remaining question blocks can become new durable decision topics when planner-only summaries are reserved first
- planner follow-through answers can consume the remaining question-block answer from the same shared reply
- malformed or ambiguously matched question blocks fail deterministically
