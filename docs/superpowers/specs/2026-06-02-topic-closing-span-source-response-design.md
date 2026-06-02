# Topic Closing Span Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured natural-language reply deterministically feed durable decision answers, inferred decision topics, and planner follow-through answers when each answer ends with one topic-bearing closing sentence and the earlier sentences in that same stretch stay on that topic.

## Why This Slice Exists

The current system already supported:

- single-sentence topic matching through `topic_sentences`
- anchored multi-sentence topic matching through `topic_spans`
- multi-sentence topic matching inside one paragraph through `topic_paragraphs`

That still left one real deterministic gap:

- a user reply can explain one answer first
- the topic-bearing sentence can come at the end of that explanation
- the next answer can then begin immediately after that closing sentence
- but there may still be no blank-line paragraph boundary and no front-loaded topic anchor

The missing surface was not fuzzy inference. It was deterministic topic authority from sentence spans whose final sentence names the topic.

## Constraints

- keep the interpreter deterministic
- reuse the current topic-surface substrate instead of adding a second parser family
- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- preserve existing `topic_sentences`, `topic_spans`, `topic_paragraphs`, and `topic_blocks` behavior

## Implemented Scope

### Root `sourceResponseFormat: "topic_closing_spans"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "topic_closing_spans"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Span Shape

Topic-closing-span replies are interpreted as sentence streams such as:

- `We should use Bun-native auth.`
- `That keeps the runtime simple for auth strategy.`
- `Use a staged rollout.`
- `That keeps the launch reversible for rollout strategy.`

where a new durable span closes whenever one sentence explicitly names one known or inferable topic candidate.

The span for a topic contains:

- every sentence since the previous closing sentence
- the current closing sentence that names the topic
- stopping immediately after that closing sentence

### Deterministic Closing-Span Matching

Runtime now parses topic-closing-span replies by:

- splitting the reply into sentences
- accumulating sentences until one sentence explicitly names exactly one known or inferable topic candidate
- closing the current span on that topic-bearing sentence
- returning the full accumulated span text as the durable answer instead of inventing a rewrite

Because each span still closes on one explicit topic-bearing sentence, this slice remains deterministic and does not depend on fuzzy extraction.

### Shared Reuse Across Existing Surfaces

Once parsed, the same topic-closing-span surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `inferDecisionTopics`
- `followThrough.answers`
- `followThrough.inferRemainingAnswers`

That means one reply with:

- one auth explanation closed by an auth-bearing sentence
- one rollout explanation closed by a rollout-bearing sentence
- one pilot-scope explanation closed by a pilot-scope-bearing sentence

can resolve known auth and rollout decisions while preserving the remaining pilot span on planner follow-through, or create brand-new durable auth and rollout decision topics from the remaining spans.

### Deterministic Validation

Runtime now rejects topic-closing-span interpretation deterministically when:

- `sourceResponseFormat` is `topic_closing_spans` but `sourceResponse` is missing
- the reply ends with leftover sentences that were never closed by a topic-bearing sentence
- a requested explicit or open decision topic has no matching closing span
- more than one closing span matches the same requested topic
- one closing sentence matches more than one known topic candidate

## Non-Goals

- inferring brand-new topics from fully loose prose with no topic-bearing closing sentence
- semantic regrouping across non-contiguous sentences
- paraphrasing matched spans into shorter synthetic answers
- replacing `topic_spans` where front-loaded topic anchors already exist

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one topic-closing-span reply without requiring the topic-bearing sentence to appear first
- current open decisions can be resolved from topic-closing spans without per-topic mapping
- remaining topic-closing spans can become new durable decision topics
- planner follow-through can consume the remaining topic-closing span from the same shared reply
- missing or multiply matched topic-closing spans fail deterministically
