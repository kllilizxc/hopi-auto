# Labeled Source Response Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one shared raw reply provide more than one durable decision answer or planner-answer value through deterministic labeled sections, so assistant can omit per-topic excerpts and mappings when the reply is already structured as labeled answers.

## Why This Slice Exists

The current system already supported:

- whole-reply reuse through root `sourceResponse`
- reusable named snippets through `answerSources`
- exact grounding through `answerSources[*].sourceExcerpt`
- direct one-off grounding through item-level `sourceExcerpt`

That still left one authority gap:

- a user reply may already be structured as labeled answers such as `Auth strategy: ...`
- callers still had to restate per-topic excerpts or mappings even though the raw reply already contained deterministic label boundaries
- the remaining explicit ceremony was not adding durable authority when the response itself already exposed stable labels

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- avoid fuzzy or semantic inference; only support deterministic labeled-section extraction
- preserve existing explicit `answer`, `sourceExcerpt`, `answerSourceKey`, and whole-reply `sourceResponse` paths

## Implemented Scope

### Root `sourceResponseFormat`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "labeled_sections"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Automatic Per-Item Extraction From Labeled Sections

When `sourceResponseFormat` is `labeled_sections`, runtime extracts per-item answers from labeled lines inside `sourceResponse`.

Decision answers match labels through deterministic candidates such as:

- humanized `decisionKey`
- explicit item `summary`

Planner follow-through answers match labels through:

- item `summary`

That lets one response like:

- `Auth strategy: Use Bun-native auth`
- `Rollout strategy: Use a staged rollout`
- `Pilot scope: Start with five enterprise customers`

materialize three separate durable answers without any per-topic excerpt or mapping fields.

### Deterministic Resolution Order

Runtime now resolves each answer item in this order:

1. item `answer`
2. item `sourceExcerpt`
3. item `answerSourceKey`
4. labeled-section extraction from `sourceResponse`
5. whole-reply `sourceResponse`

This preserves explicit per-item authority first while allowing structured raw replies to remove mapping ceremony.

### Deterministic Validation

Runtime now rejects labeled-section interpretation deterministically when:

- `sourceResponseFormat` is `labeled_sections` but `sourceResponse` is missing
- no labeled section matches one requested durable answer item
- the same normalized labeled section appears more than once in `sourceResponse`

## Non-Goals

- fuzzy label matching, embeddings, or NLP topic inference
- nested section grammars or positional offsets
- automatically deciding which durable topics should exist before the action names them
- replacing named `answerSources` when reusable snippets must feed more than one item outside one labeled response

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one labeled `sourceResponse` without per-topic excerpt or mapping fields
- decision answers and planner follow-through answers both work through the same labeled-section surface
- missing or ambiguous labeled sections fail deterministically
- existing explicit answer and excerpt paths continue to work
