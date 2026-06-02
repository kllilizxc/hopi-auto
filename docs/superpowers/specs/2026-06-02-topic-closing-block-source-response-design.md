# Topic Closing Block Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured natural-language reply deterministically feed durable decision answers, inferred decision topics, and planner follow-through answers when each answer ends with one topic-bearing closing paragraph and the earlier paragraphs in that same block stay on that topic.

## Why This Slice Exists

The current system already supported:

- single-paragraph topic matching through `topic_paragraphs`
- anchored multi-paragraph topic matching through `topic_blocks`
- topic-closing multi-sentence matching through `topic_closing_spans`

That still left one real deterministic gap:

- a user reply can explain one answer across more than one paragraph
- the topic-bearing paragraph can come at the end of that explanation instead of the beginning
- the next answer can then begin in the next paragraph block
- but there may still be no front-loaded anchor paragraph to justify `topic_blocks`

The missing surface was not fuzzy topic inference. It was deterministic topic authority from multi-paragraph blocks whose final paragraph names the topic.

## Constraints

- keep the interpreter deterministic
- reuse the current topic-surface substrate instead of adding a second parser family
- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- preserve existing `topic_paragraphs`, `topic_blocks`, and `topic_closing_spans` behavior

## Implemented Scope

### Root `sourceResponseFormat: "topic_closing_blocks"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "topic_closing_blocks"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Block Shape

Topic-closing-block replies are interpreted as paragraph streams such as:

- `We should keep auth native to the Bun runtime.`
- `That keeps implementation overhead low.`
- `That should be the auth strategy.`
- `Start with five enterprise customers.`
- `Keep rollback simple with a feature flag.`
- `That should be the pilot scope.`

where a new durable block closes whenever one paragraph explicitly names exactly one known or inferable topic candidate.

The block for a topic contains:

- every paragraph since the previous closing paragraph
- the current closing paragraph that names the topic
- stopping immediately after that closing paragraph

### Deterministic Closing-Block Matching

Runtime now parses topic-closing-block replies by:

- splitting the reply into blank-line-separated paragraphs
- accumulating paragraphs until one paragraph explicitly names exactly one known or inferable topic candidate
- closing the current block on that topic-bearing paragraph
- returning the full accumulated block text as the durable answer instead of inventing a rewrite

Because each block still closes on one explicit topic-bearing paragraph, this slice remains deterministic and does not depend on fuzzy extraction.

### Shared Reuse Across Existing Surfaces

Once parsed, the same topic-closing-block surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `inferDecisionTopics`
- `followThrough.answers`
- `followThrough.inferRemainingAnswers`

That means one reply with:

- one auth explanation closed by an auth-bearing paragraph
- one rollout explanation closed by a rollout-bearing paragraph
- one pilot-scope explanation closed by a pilot-scope-bearing paragraph

can resolve known auth and rollout decisions while preserving the remaining pilot block on planner follow-through, or create brand-new durable auth and rollout decision topics from the remaining blocks.

### Deterministic Validation

Runtime now rejects topic-closing-block interpretation deterministically when:

- `sourceResponseFormat` is `topic_closing_blocks` but `sourceResponse` is missing
- the reply ends with leftover paragraphs that were never closed by a topic-bearing paragraph
- a requested explicit or open decision topic has no matching closing block
- more than one closing block matches the same requested topic
- one closing paragraph matches more than one known topic candidate

## Non-Goals

- inferring brand-new topics from fully loose prose with no topic-bearing closing paragraph
- semantic regrouping across non-contiguous paragraphs
- paraphrasing matched blocks into shorter synthetic answers
- replacing `topic_blocks` where front-loaded anchor paragraphs already exist

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one topic-closing-block reply without requiring the topic-bearing paragraph to appear first
- current open decisions can be resolved from topic-closing blocks without per-topic mapping
- remaining topic-closing blocks can become new durable decision topics
- planner follow-through can consume the remaining topic-closing block from the same shared reply
- missing or multiply matched topic-closing blocks fail deterministically
