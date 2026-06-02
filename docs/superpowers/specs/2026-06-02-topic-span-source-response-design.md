# Topic Span Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured natural-language reply deterministically feed durable decision answers, inferred decision topics, and planner follow-through answers when each answer starts with one anchor sentence that names the topic and the following sentences stay on that same topic until the next anchor sentence appears.

## Why This Slice Exists

The current system already supported:

- single-sentence topic matching through `topic_sentences`
- single-paragraph topic matching through `topic_paragraphs`
- anchored multi-paragraph topic matching through `topic_blocks`

That still left one real deterministic gap:

- a user reply might already be organized as consecutive topic-specific sentences
- the first sentence can name the topic explicitly
- the following one or more sentences can stay on that same topic without repeating it
- but there may be no blank-line paragraph or block boundaries to promote the reply into `topic_paragraphs` or `topic_blocks`

The missing surface was not fuzzy topic inference. It was anchored multi-sentence span authority without requiring paragraph breaks.

## Constraints

- keep the interpreter deterministic
- reuse the current topic-surface substrate instead of adding a second parser family
- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- preserve existing `topic_sentences`, `topic_paragraphs`, and `topic_blocks` behavior

## Implemented Scope

### Root `sourceResponseFormat: "topic_spans"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "topic_spans"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Span Shape

Topic-span replies are interpreted as sentence streams such as:

- `We should use Bun-native auth for auth strategy.`
- `That keeps the runtime simple.`
- `Use a staged rollout for rollout strategy.`
- `That keeps the launch reversible.`

where a new topic span starts whenever a sentence explicitly names one known or inferable topic candidate.

The span for a topic contains:

- the anchor sentence that names the topic
- every following sentence that names no other topic
- stopping immediately before the next anchor sentence

### Deterministic Span Matching

Runtime now parses topic-span replies by:

- splitting the reply into sentences
- normalizing each sentence plus every currently known topic candidate
- treating a sentence as a span anchor only when it matches exactly one known topic candidate or deterministically yields one inferable topic summary
- appending later non-anchor sentences onto that active span until the next anchor sentence appears
- returning the full span text as the durable answer instead of inventing a rewrite

Because spans are still anchored by explicit topic-bearing sentences, this slice remains deterministic and does not depend on fuzzy extraction.

### Shared Reuse Across Existing Surfaces

Once parsed, the same topic-span surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `inferDecisionTopics`
- `followThrough.answers`
- `followThrough.inferRemainingAnswers`

That means one reply with:

- one auth anchor sentence plus rationale sentence
- one rollout anchor sentence plus rationale sentence
- one pilot-scope anchor sentence plus rationale sentence

can resolve known auth and rollout decisions while preserving the remaining pilot span on planner follow-through, or create brand-new durable auth and rollout decision topics from the remaining spans.

### Deterministic Validation

Runtime now rejects topic-span interpretation deterministically when:

- `sourceResponseFormat` is `topic_spans` but `sourceResponse` is missing
- the reply does not start with a topic anchor sentence
- a requested explicit or open decision topic has no matching anchored span
- more than one anchored span matches the same requested topic
- one anchor sentence matches more than one known topic candidate

## Non-Goals

- inferring brand-new topics from fully loose prose with no topic-bearing anchor sentence
- semantic grouping across unrelated sentences
- replacing `topic_blocks` where paragraph boundaries already provide better authority
- paraphrasing matched spans into shorter synthetic answers

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one anchored topic-span reply without requiring blank-line paragraph or block boundaries
- current open decisions can be resolved from anchored topic spans without per-topic mapping
- remaining anchored topic spans can become new durable decision topics
- planner follow-through can consume the remaining anchored topic span from the same shared reply
- missing or multiply matched topic spans fail deterministically
