# Labeled Decision Topic Inference Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one labeled shared raw reply create or reuse durable decision topics directly through `record_answers` even when there is no preexisting open decision surface and no explicit `answers[]` mapping.

## Why This Slice Exists

The current system already supported:

- explicit `answers[]` mapping
- grounded excerpts and named answer sources
- labeled multi-answer extraction
- current-open-decision reuse through `inferOpenDecisions`
- ordered-item interpretation

That still left one authority gap:

- a reply might already expose stable labeled decision topics such as `Auth strategy: ...`
- callers still had to either pre-create open decisions or restate those topics in `answers[]`
- the missing surface was not fuzzy topic inference; it was deterministic topic creation from already-labeled reply structure

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not infer topics from unlabeled or fuzzy prose
- preserve existing explicit `answers[]`, `inferOpenDecisions`, and planner-answer surfaces

## Implemented Scope

### Root `inferDecisionTopics`

`record_answers` on assistant and Bun API now supports:

- `inferDecisionTopics: true`

This capability is intentionally limited to `sourceResponseFormat: "labeled_sections"`.

### Remaining Labeled Sections Become Durable Decision Topics

When `inferDecisionTopics` is true:

- runtime parses the labeled shared reply once
- labeled sections already claimed by explicit decision answers are reserved
- labeled sections already claimed by `inferOpenDecisions` matches are reserved
- labeled sections already claimed by planner follow-through answers are reserved
- every remaining labeled section becomes a durable decision answer entry

That means one reply like:

- `Auth strategy: Use Bun-native auth`
- `Rollout strategy: Use a staged rollout`
- `Pilot scope: Start with five enterprise customers`

can create two durable decision topics from `Auth strategy` and `Rollout strategy` while preserving `Pilot scope` as a planner follow-through answer.

### Deterministic Decision Reuse

When a remaining labeled section already matches an existing durable decision summary exactly after normalization:

- runtime reuses that existing decision topic if the match is unique
- runtime creates a brand-new durable decision topic only when no existing durable decision summary matches

If more than one existing durable decision matches the same inferred label, runtime rejects the action deterministically instead of guessing.

### Summary Authority

For newly created durable decision topics:

- the raw labeled section title becomes the durable decision summary

This preserves user-facing authority from the reply instead of inventing a second naming rule.

## Deterministic Validation

Runtime now rejects this surface deterministically when:

- `inferDecisionTopics` is used without `sourceResponseFormat: "labeled_sections"`
- more than one existing durable decision matches the same inferred label

## Non-Goals

- inferring decision topics from unlabeled prose
- guessing planner-answer summaries
- semantic clustering or embeddings
- replacing `inferOpenDecisions` for cases that already have the right open decision surface

## Acceptance Criteria

- assistant and Bun API can create new durable decision topics from remaining labeled reply sections without explicit `answers[]`
- planner-only labeled sections remain available for `followThrough.answers`
- existing durable decisions are reused deterministically when the inferred label matches exactly
- invalid or ambiguous inference requests fail deterministically
