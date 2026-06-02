# Ordered Source Response Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one ordered shared raw reply deterministically feed durable decision answers and planner follow-through answers even when the reply does not carry stable labels.

## Why This Slice Exists

The current system already supported:

- whole-reply reuse through root `sourceResponse`
- reusable named snippets through `answerSources`
- exact grounding through `answerSources[*].sourceExcerpt`
- direct one-off grounding through item-level `sourceExcerpt`
- labeled multi-answer extraction through `sourceResponseFormat: "labeled_sections"`
- matching current open decisions from labeled replies through `inferOpenDecisions`

That still left one authority gap:

- a user reply might already be a stable ordered list of answers without carrying explicit labels
- callers still had to add labels, excerpts, or per-topic mapping even when deterministic order already existed
- the missing surface was sequence authority, not fuzzy inference

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not infer new durable topics from free text
- avoid fuzzy matching and NLP
- preserve explicit `answer`, `sourceExcerpt`, `answerSourceKey`, labeled-section, and whole-reply paths

## Implemented Scope

### Root `sourceResponseFormat: "ordered_items"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "ordered_items"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Shared Ordered-Item Cursor

Runtime now creates one ordered-item interpretation state per answer-driven action and reuses it across:

- explicit decision answers
- inferred current open decisions
- planner follow-through answers

That means one reply like:

- `Use Bun-native auth`
- `Use a staged rollout`
- `Start with five enterprise customers before broader launch.`

can deterministically feed:

- first decision answer
- second decision answer
- first follow-through answer

without labels or per-topic excerpt fields.

### Deterministic Parsing

Ordered shared replies are interpreted as non-empty lines, optionally stripping common ordered or bullet prefixes such as:

- `- `
- `* `
- `1. `
- `1) `

Each remaining line becomes one ordered item.

### Compatibility With `inferOpenDecisions`

`record_answers` now also accepts `inferOpenDecisions: true` together with `sourceResponseFormat: "ordered_items"`.

When used together:

- explicit answer entries are materialized first
- any explicit `decisionKey` already supplied is skipped from inference
- remaining current open decisions consume later ordered items in durable open-decision order

This keeps inference anchored to existing durable decision surfaces instead of inventing new topics.

### Deterministic Validation

Runtime now rejects ordered-item interpretation deterministically when:

- `sourceResponseFormat` is `ordered_items` but `sourceResponse` is missing
- there are fewer ordered items than the unresolved answer items that need them
- `inferOpenDecisions` is requested without `sourceResponseFormat` set to either `labeled_sections` or `ordered_items`

## Non-Goals

- inferring brand-new durable decision topics from unlabeled prose
- guessing planner-answer summaries from free text
- cross-item semantic matching
- paragraph clustering or multi-line NLP extraction

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one ordered shared reply without labels
- one action can reuse the same ordered reply across decision answers and follow-through answers
- `inferOpenDecisions` also works with ordered shared replies
- missing ordered items fail deterministically
- existing labeled-section and excerpt paths continue to work
