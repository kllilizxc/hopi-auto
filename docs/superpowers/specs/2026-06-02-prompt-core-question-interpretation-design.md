# Prompt-Core Question Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let question-based answer interpretation reuse the durable decision prompt as a deterministic matching authority even when the shared reply question no longer repeats the full stored prompt text verbatim.

## Why This Slice Exists

The prior prompt-grounded question interpretation already let:

- `question_blocks`
- `question_spans`

match current durable decisions by exact stored `prompt` text.

That still left one narrower authority gap:

- a durable decision prompt might include extra Goal-local framing such as `for the Bun-first product path`
- the shared reply question might restate the same canonical question more tersely
- exact full-prompt containment would then fail even though the question still clearly names the same durable authority surface

This slice closes that gap without introducing fuzzy semantic search.

## Constraints

- keep `decisions.yml` as the only durable decision-topic authority
- do not add a second prompt-alias or prompt-normalization store
- preserve existing exact summary/key/prompt matching semantics
- stay deterministic
- do not introduce embeddings, similarity scores, synonym expansion, or model-assisted interpretation

## Implemented Scope

### Deterministic Prompt-Core Matching

Question-based matching now performs two ordered checks:

1. existing normalized full-text containment against:
   - humanized `decisionKey`
   - concise `summary`
   - exact durable `prompt`
2. deterministic question-core containment

The question core is produced by:

- normalizing to the existing question-text token surface
- stripping only a fixed leading set of question-scaffolding tokens such as:
  - `what`
  - `which`
  - `how`
  - `should`
  - `do`
  - `we`
  - `need`
  - `to`
- preserving the remaining token order exactly

Runtime then accepts a match when either normalized question core contains the candidate core or the candidate core contains the question core.

This allows examples such as:

- stored prompt: `Which auth provider should we adopt for the Bun-first product path?`
- shared reply question: `What auth provider should we adopt?`

and:

- stored prompt: `Should rollout happen in stages or all at once?`
- shared reply question: `How should rollout happen?`

without expanding into synonym or semantic search.

### Shared Question Surfaces

The new prompt-core matching path applies to the same shared question-based interpreter used by:

- explicit decision answers on `question_blocks`
- explicit decision answers on `question_spans`
- `inferOpenDecisions` on `question_blocks`
- `inferOpenDecisions` on `question_spans`
- known-decision reuse during `inferDecisionTopics` on question-based formats

### Product Path Coverage

Because the change lives only in the shared interpreter, the active product paths inherit it automatically:

- Bun decision answer APIs
- Goal assistant answer actions

No product-path-specific side channel or additional durable field is introduced.

## Non-Goals

- synonym matching between reply questions and durable prompts
- prompt-core inference for non-question source-response formats
- prompt alias editing or prompt keyword curation
- semantic question clustering across unrelated decisions
- broader free-form topic inference from fully loose prose

## Acceptance Criteria

- current durable decisions can be resolved from `question_blocks` when the reply question restates the durable prompt core more tersely than the stored prompt
- current durable decisions can be resolved from `question_spans` under the same deterministic prompt-core rule
- Bun API and Goal assistant both use the same shared prompt-core interpreter path
- runtime remains deterministic and does not introduce fuzzy prompt matching
