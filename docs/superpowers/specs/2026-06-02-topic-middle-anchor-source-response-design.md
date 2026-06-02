# Topic Middle Anchor Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured natural-language reply deterministically feed durable decision answers, inferred decision topics, and planner follow-through answers when each answer keeps one explicit topic-bearing sentence or paragraph in the middle, with leading and trailing continuation units around it.

## Why This Slice Exists

The current system already supported:

- single-sentence topic matching through `topic_sentences`
- front-anchored multi-sentence and multi-paragraph topic matching through `topic_spans` and `topic_blocks`
- closing-anchored multi-sentence and multi-paragraph topic matching through `topic_closing_spans` and `topic_closing_blocks`
- paragraph-local topic matching through `topic_paragraphs`

That still left one deterministic gap:

- a user reply can explain an answer before naming the topic
- continue explaining it after naming the topic
- and place the topic-bearing sentence or paragraph in the middle of that stretch
- while still keeping adjacent answers packed into the same reply

The missing surface was not fuzzy inference. It was deterministic topic authority from stretches whose explicit topic anchor sits between leading and trailing continuation units.

## Constraints

- keep the interpreter deterministic
- reuse the current topic-surface substrate instead of inventing a second durable store
- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- preserve existing `topic_spans`, `topic_closing_spans`, `topic_paragraphs`, `topic_blocks`, and `topic_closing_blocks` behavior

## Implemented Scope

### New Root `sourceResponseFormat` Values

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "topic_middle_spans"`
- `sourceResponseFormat: "topic_middle_blocks"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Middle-Anchor Shapes

Topic-middle-span replies are interpreted as sentence streams such as:

- `Keep the runtime simple.`
- `We should use Bun-native auth for auth strategy.`
- `That avoids extra infra.`
- `Launch in phases.`
- `Use a staged rollout for rollout strategy.`
- `That keeps the launch reversible.`

Topic-middle-block replies are interpreted as paragraph streams with the same shape, but preserving blank-line paragraph boundaries inside each answer block.

Each answer stretch now contains:

- at least one leading sentence or paragraph before the topic-bearing anchor
- exactly one anchor sentence or paragraph that explicitly names one known or inferable topic candidate
- at least one trailing sentence or paragraph after that anchor

### Deterministic Middle-Anchor Splitting

Runtime now parses middle-anchor replies by:

- splitting the reply into sentences for `topic_middle_spans`
- splitting the reply into blank-line paragraphs for `topic_middle_blocks`
- finding anchor units with the same explicit topic matching used by existing topic surfaces
- requiring at least one leading unit before the first anchor
- requiring at least one trailing unit after the last anchor
- when one later anchor appears, assigning the immediately preceding unit to the next answer stretch as its leading continuation unit
- assigning any earlier post-anchor units to the current answer stretch as trailing continuation

This keeps adjacent middle-anchored answers deterministic without introducing fuzzy regrouping.

### Shared Reuse Across Existing Surfaces

Once parsed, the same middle-anchor surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `inferDecisionTopics`
- `followThrough.answers`
- `followThrough.inferRemainingAnswers`

That means one reply can:

- resolve known auth and rollout decisions
- preserve the remaining pilot answer on planner follow-through
- or create brand-new durable auth and rollout decision topics from the remaining middle-anchored stretches

### Deterministic Validation

Runtime now rejects middle-anchor interpretation deterministically when:

- `sourceResponseFormat` is `topic_middle_spans` or `topic_middle_blocks` but `sourceResponse` is missing
- the reply starts with an anchor and therefore has no leading continuation unit
- the reply ends immediately after an anchor and therefore has no trailing continuation unit
- adjacent anchors do not leave both one trailing unit for the current answer and one leading unit for the next answer
- a requested explicit or open decision topic has no matching middle-anchored stretch
- more than one middle-anchored stretch matches the same requested topic
- one anchor unit matches more than one known topic candidate

## Non-Goals

- inferring brand-new topics from fully loose prose with no explicit topic-bearing sentence or paragraph anywhere in the stretch
- fuzzy regrouping of sentences or paragraphs across discontinuous spans
- replacing front-anchor or closing-anchor surfaces where those formats already fit the reply
- paraphrasing matched stretches into shorter synthetic answers

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one middle-anchored topic reply without requiring the topic-bearing sentence or paragraph to appear first or last
- current open decisions can be resolved from middle-anchored topic replies without per-topic mapping
- remaining middle-anchored topic replies can become new durable decision topics
- planner follow-through can consume the remaining middle-anchored topic stretch from the same shared reply
- ambiguous adjacent anchors fail deterministically instead of being guessed
