# Ordered Block Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one ordered multi-paragraph reply deterministically feed durable decision answers and planner follow-through answers without requiring labels or repeated topic names, while still preserving more than one paragraph per answer block.

## Why This Slice Exists

The current system already supported:

- whole-reply reuse through root `sourceResponse`
- reusable named snippets through `answerSources`
- direct and named excerpt grounding
- line-based labeled sections
- ordered-item replies
- inline topic clauses with front-loaded labels
- sentence-level topic matching for already-known topics
- paragraph-level topic matching for already-known topics
- anchored topic-block matching for already-known topics
- current-open-decision reuse from structured replies
- remaining labeled or inline-topic inference into new durable decision topics

That still left one narrower authority gap:

- a user reply might already be deterministic enough because the answers are in order
- but each answer may span more than one paragraph
- the missing surface was ordered multi-paragraph blocks, not unordered or inferred topic creation

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not infer brand-new decision topics from ordered blocks in this slice
- preserve existing labeled-section, ordered-item, inline-topic, topic-sentence, topic-paragraph, topic-block, excerpt, and explicit-answer paths

## Implemented Scope

### Root `sourceResponseFormat: "ordered_blocks"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "ordered_blocks"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Block Shape

Ordered-block replies are interpreted as blank-line-separated paragraph groups where:

- one blank line separates paragraphs inside the same answer block
- two blank lines separate one answer block from the next answer block

Example:

- `Use Bun-native auth.` then one blank line then `That keeps the runtime simple.`
- two blank lines
- `Use a staged rollout.` then one blank line then `That keeps the launch reversible.`

### Deterministic Block Consumption

Runtime now parses ordered blocks by:

- splitting the reply into top-level blocks on two blank lines
- preserving single-blank-line-separated continuation paragraphs inside each block
- consuming those blocks in deterministic order across explicit decision answers, inferred open decisions, and follow-through answers
- returning the full block text as the durable answer text

This is the ordered-block analogue of `ordered_items`: still ordered, but able to preserve richer paragraph structure.

### Shared Reuse Across Existing Surfaces

Once parsed, the same ordered-block surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `followThrough.answers`

That means one reply with three ordered blocks can resolve auth and rollout decisions first, then leave the third block for planner follow-through such as `Pilot scope`.

### Deterministic Validation

Runtime now rejects ordered-block interpretation deterministically when:

- `sourceResponseFormat` is `ordered_blocks` but `sourceResponse` is missing
- not enough ordered blocks remain for the requested explicit decisions, inferred open decisions, or follow-through answers

`inferOpenDecisions` now accepts `ordered_blocks` alongside `labeled_sections`, `ordered_items`, `inline_topics`, `topic_sentences`, `topic_paragraphs`, and `topic_blocks`.

### Explicit Non-Goal For This Slice

`inferDecisionTopics` does not accept `ordered_blocks`.

Order alone still does not provide a stable summary for creating a brand-new durable decision topic.

## Non-Goals

- inferring brand-new decision topics from ordered blocks
- embeddings, fuzzy matching, or semantic search
- paraphrasing matched blocks into shorter synthetic answers
- replacing unordered topic-anchored formats when topic anchors already exist

## Acceptance Criteria

- assistant and Bun API can materialize more than one multi-paragraph durable answer from one ordered reply without labels
- current open decisions can be resolved from ordered blocks without per-topic mapping
- planner follow-through answers can consume the remaining ordered block from the same shared reply
- running out of ordered blocks fails deterministically
