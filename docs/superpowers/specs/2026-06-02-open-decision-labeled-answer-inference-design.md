# Open Decision Labeled Answer Inference Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one labeled shared reply resolve matching current open durable decisions through `record_answers` without forcing assistant or API callers to repeat those same decision topics inside the action payload.

## Why This Slice Exists

The current system already supported deterministic labeled-section extraction, but it still required callers to restate every relevant durable decision topic inside `answers[]` even when:

- those decision topics already existed durably in `decisions.yml`
- the user reply already exposed stable labeled boundaries for them

That repeated ceremony was not adding new authority. The missing surface was not "infer arbitrary new topics"; it was "reuse the visible open decision surface we already have."

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not infer new durable decision topics in this slice
- do not perform fuzzy or semantic NLP inference
- preserve explicit `answers[]` support for cases that still need manual mapping

## Implemented Scope

### Root `inferOpenDecisions`

`record_answers` on assistant and Bun API now supports:

- `inferOpenDecisions: true`

This capability is intentionally limited to the existing multi-decision answer surface rather than widening every answer-driven action.

### Deterministic Open-Decision Reuse

When `inferOpenDecisions` is true:

- runtime reads the current open decisions for the Goal from `decisions.yml`
- runtime matches those open decisions against labeled sections inside the shared `sourceResponse`
- runtime materializes resolved decision answers only for open decisions whose labels match
- matched decisions are resolved and any follow-through still routes through the existing shared decision/planning runtime

This means a labeled reply like:

- `Auth strategy: Use Bun-native auth`
- `Rollout strategy: Use a staged rollout`
- `Pilot scope: Start with five enterprise customers`

can resolve current open `auth-strategy` and `rollout-strategy` decisions without repeating them inside `answers[]`, while still letting `followThrough.answers` capture `Pilot scope`.

### Explicit Entries Still Work

`inferOpenDecisions` composes with explicit `answers[]`:

- explicit decision answers are materialized first
- inferred open decisions skip any `decisionKey` already supplied explicitly

To keep this deterministic, explicit entries used alongside `inferOpenDecisions` must carry stable `decisionKey`.

### Deterministic Validation

Runtime now rejects this surface deterministically when:

- `inferOpenDecisions` is used without `sourceResponseFormat: "labeled_sections"`
- `inferOpenDecisions` is mixed with explicit `answers[]` entries that omit `decisionKey`
- no explicit or inferred decision answers are materialized at all

## Non-Goals

- inferring brand-new durable decision topics from labels
- resolving arbitrary less-structured free text
- guessing planner-answer summaries from unlabeled prose
- replacing explicit `answers[]` when no current open durable decision surface exists

## Acceptance Criteria

- assistant and Bun API can resolve matching current open decisions from one labeled shared reply without repeating those decision topics inside `answers[]`
- explicit `answers[]` still work and continue to take precedence when keyed by `decisionKey`
- non-decision planner follow-through answers still use the same labeled shared reply in the same action
- invalid or empty inference requests fail deterministically
