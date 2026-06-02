# Topic Clause Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured natural-language reply deterministically feed durable decision answers, inferred decision topics, and planner follow-through answers when that reply contains more than one self-contained natural topic clause inside one longer sentence.

## Why This Slice Exists

The current system already supported:

- inline labeled topic clauses through `inline_topics`
- single topic-bearing sentences through `topic_sentences`
- anchored multi-sentence topic stretches through `topic_spans`

That still left one real deterministic gap:

- a user reply can stay inside one longer sentence
- each comma- or semicolon-separated clause can already be self-contained
- each clause can still explicitly name the durable topic
- but there may be no line break, no label, and no sentence boundary between answers

The missing surface was not fuzzy inference. It was deterministic clause-level topic authority.

## Constraints

- keep the interpreter deterministic
- reuse the current topic-surface substrate instead of adding a second matching authority
- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- preserve existing `inline_topics`, `topic_sentences`, and later topic-span/block behavior

## Implemented Scope

### Root `sourceResponseFormat: "topic_clauses"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "topic_clauses"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Clause Shape

Topic-clause replies are interpreted as clause streams such as:

- `Use Bun-native auth for auth strategy,`
- `use a staged rollout for rollout strategy,`
- `start with five enterprise customers before broader launch for pilot scope.`

where each clause is already a complete answer on its own and explicitly names exactly one known or inferable topic.

### Deterministic Clause Parsing

Runtime now parses topic-clause replies by:

- splitting the shared reply on commas, semicolons, line breaks, or sentence boundaries
- trimming each resulting clause
- matching each clause through the same deterministic topic-text authority already used for topic sentences
- preserving the exact matched clause text as the durable answer instead of rewriting it

This slice intentionally assumes each resulting clause is already self-contained. It does not attempt clause regrouping or fuzzy continuation inference.

### Shared Reuse Across Existing Surfaces

Once parsed, the same topic-clause surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `inferDecisionTopics`
- `followThrough.answers`
- `followThrough.inferRemainingAnswers`

That means one longer comma-separated reply can:

- resolve known auth and rollout decisions
- preserve the remaining pilot clause on planner follow-through
- or create brand-new durable auth and rollout decision topics from the remaining clauses

### Deterministic Validation

Runtime now rejects topic-clause interpretation deterministically when:

- `sourceResponseFormat` is `topic_clauses` but `sourceResponse` is missing
- a requested explicit or open decision topic has no matching topic clause
- more than one topic clause matches the same requested topic
- one remaining clause infers more than one topic summary

## Non-Goals

- regrouping comma fragments into larger semantic answers
- treating arbitrary subordinate clauses as durable answer surfaces
- replacing `topic_sentences` where the reply already has one sentence per answer
- fuzzy topic inference from clauses that do not explicitly name the durable topic

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one topic-clause reply without requiring sentence or paragraph boundaries
- current open decisions can be resolved from topic clauses without per-topic mapping
- remaining topic clauses can become new durable decision topics
- planner follow-through can consume the remaining topic clause from the same shared reply
- missing or multiply matched topic clauses fail deterministically
