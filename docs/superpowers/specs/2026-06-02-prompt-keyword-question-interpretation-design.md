# Prompt-Keyword Question Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let question-based answer interpretation reuse durable decision prompts as deterministic matching authority even when the shared reply question no longer preserves the stored prompt’s exact text or prompt-core token order.

## Why This Slice Exists

The prior prompt-grounded and prompt-core-grounded work already let:

- `question_blocks`
- `question_spans`

match current durable decisions when the shared reply question either:

- repeated the exact stored `prompt`, or
- preserved a contiguous prompt core after stripping leading question scaffolding

That still left one narrower authority gap:

- the shared reply question might restate the same durable prompt with the same meaningful words
- but those words might appear in a different order or with small extra glue words inserted
- exact text and prompt-core containment would then fail even though the durable prompt still clearly provides the matching authority

This slice closes that gap without allowing synonym expansion or semantic similarity search.

## Constraints

- keep `decisions.yml` as the only durable decision-topic authority
- do not add a second prompt-alias, keyword, or normalized-question store
- preserve existing exact-text and prompt-core matching behavior
- stay deterministic
- do not introduce embeddings, fuzzy ranking, model-assisted similarity, or synonym dictionaries

## Implemented Scope

### Deterministic Prompt-Keyword Anchors

Question matching now performs three ordered checks:

1. normalized full-text containment
2. deterministic prompt-core containment
3. deterministic prompt-keyword anchor set matching

The keyword-anchor set is built from normalized question text by removing a fixed set of:

- leading-question scaffolding words already covered by prompt-core parsing
- common glue tokens such as `the`, `and`, `in`, `of`, `or`, `with`

Runtime then compares the remaining normalized tokens as sets and accepts a match only when:

- both sides still retain at least two anchor keywords, and
- one anchor set is a subset of the other

This keeps the surface deterministic while allowing stable restatements such as:

- stored prompt: `Which auth provider should we adopt for the Bun-first product path?`
- shared reply question: `Should we adopt the auth provider for the Bun-first product path?`

and:

- stored prompt: `Should rollout happen in stages or all at once?`
- shared reply question: `Should rollout be all at once or in stages?`

### Shared Question Surfaces

The new keyword-anchor matching applies only to the shared question-based interpreter used by:

- explicit decision answers on `question_blocks`
- explicit decision answers on `question_spans`
- `inferOpenDecisions` on `question_blocks`
- `inferOpenDecisions` on `question_spans`
- known-decision reuse during `inferDecisionTopics` on question-based formats

### Product Path Coverage

Because the behavior lives only inside the shared interpreter, the active product surfaces inherit it automatically:

- Bun decision answer APIs
- Goal assistant answer actions

No product-path-specific keyword side channel is introduced.

## Non-Goals

- synonym matching between question rewrites and durable prompts
- using prompt-keyword anchors for non-question source-response formats
- durable prompt keyword curation or manual alias editing
- probabilistic topic scoring
- broader free-form topic inference from fully loose prose

## Acceptance Criteria

- current durable decisions can be resolved from `question_blocks` when the shared reply question preserves the durable prompt’s meaningful keywords but not its exact core word order
- current durable decisions can be resolved from `question_spans` under the same deterministic keyword-anchor rule
- Bun API and Goal assistant both use the same shared keyword-anchor matcher
- runtime remains deterministic and does not introduce fuzzy prompt matching
