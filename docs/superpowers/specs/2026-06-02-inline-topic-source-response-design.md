# Inline Topic Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured natural-language reply with inline topic clauses deterministically feed durable decision answers and planner follow-through answers without requiring line-based labeled sections or ordered-list structure.

## Why This Slice Exists

The current system already supported:

- whole-reply reuse through root `sourceResponse`
- reusable named snippets through `answerSources`
- direct and named excerpt grounding
- line-based labeled sections
- ordered-item replies
- current-open-decision reuse from structured replies
- remaining labeled-section inference into new durable decision topics

That still left one authority gap:

- a reply may already be structured enough because it explicitly names the topics inline
- but it may not be formatted as one label per line or one item per list entry
- the missing surface was clause-level topic authority, not fuzzy NLP

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not infer topics from unlabeled prose in this slice
- preserve existing labeled-section, ordered-item, excerpt, and explicit-answer paths

## Implemented Scope

### Root `sourceResponseFormat: "inline_topics"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "inline_topics"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Clause Shape

Inline topic replies are interpreted as clauses such as:

- `Auth strategy should use Bun-native auth`
- `Rollout strategy should use a staged rollout`
- `Pilot scope should start with five enterprise customers`

Clauses can be separated by:

- semicolons
- sentence boundaries
- newlines

The topic label stays explicit in the reply, but no longer needs its own line or numbered list slot.

### Deterministic Clause Parsing

Runtime now parses inline topic clauses into stable `{ label, value }` pairs by:

- matching punctuation-delimited pairs like `Topic: answer`, `Topic = answer`, `Topic -> answer`, or `Topic - answer`
- matching verbal clause pairs like `Topic should ...`, `Topic is ...`, `Topic uses ...`, `Topic means ...`, `Topic requires ...`, or `Topic starts ...`

This is still deterministic because the topic label must appear explicitly at the front of the clause.

### Shared Reuse Across Existing Surfaces

Once parsed, the same inline topic surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `followThrough.answers`
- `inferDecisionTopics`

That means one reply like:

- `Auth strategy should use Bun-native auth; rollout strategy should use a staged rollout; pilot scope should start with five enterprise customers before broader launch.`

can:

- resolve explicit or open auth and rollout decisions
- keep `Pilot scope` on planner follow-through
- or infer new durable decision topics from the remaining unclaimed clauses

### Deterministic Validation

Runtime now rejects inline topic interpretation deterministically when:

- `sourceResponseFormat` is `inline_topics` but `sourceResponse` is missing
- a requested explicit or open decision topic has no matching inline clause
- the same inline topic label appears more than once

`inferOpenDecisions` now accepts `inline_topics` alongside `labeled_sections` and `ordered_items`.

`inferDecisionTopics` now accepts `inline_topics` alongside `labeled_sections`.

## Non-Goals

- inferring topics from unlabeled prose
- embeddings, fuzzy matching, or semantic search
- replacing ordered-item interpretation
- replacing labeled-section interpretation when one label per line is already available

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one inline-topic reply without line-based labeled sections or ordered lists
- current open decisions can be resolved from inline topic clauses without per-topic mapping
- remaining inline topic clauses can become new durable decision topics when `inferDecisionTopics` is set
- missing or duplicate inline topic clauses fail deterministically
