# Question Clause Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one longer sentence with more than one self-contained natural question-and-answer clause deterministically feed durable decision answers, planner follow-through answers, and inferred decision topics without requiring separate sentence or paragraph boundaries between clauses.

## Why This Slice Exists

The current system already supported:

- whole-reply reuse through root `sourceResponse`
- reusable named snippets through `answerSources`
- direct and named excerpt grounding
- line-based labeled sections
- ordered-item replies
- ordered multi-paragraph reply blocks
- question-and-answer paragraph blocks
- inline question-and-answer spans
- question-middle and question-closing span or block surfaces
- inline topic clauses with front-loaded labels
- current-open-decision reuse from structured replies
- remaining labeled, inline-topic, or question-span style inference into new durable decision topics

That still left one narrower authority gap:

- a user reply might stay inside one longer sentence
- each comma- or semicolon-separated clause might already contain both the question and the answer
- the question text inside each clause can still anchor the durable topic deterministically
- but there may be no standalone question sentence, no paragraph break, and no sentence boundary between adjacent answers

The missing surface was clause-level question authority, not fuzzy inference from fully loose prose.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- stay deterministic
- preserve existing labeled-section, ordered-item, ordered-block, question-block, question-span, question-middle, question-closing, inline-topic, topic-sentence, topic-block, excerpt, and explicit-answer paths

## Implemented Scope

### Root `sourceResponseFormat: "question_clauses"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "question_clauses"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Clause Shape

Question-clause replies are interpreted as clause-level question and answer turns where:

- each clause contains exactly one question sentence ending with `?`
- that question sentence names the durable topic
- the remainder of the same clause is the answer text for that question
- the next clause starts at a comma, semicolon, or line break

Example:

- `Auth strategy? Use Bun-native auth,`
- `Rollout strategy? Use a staged rollout,`
- `Pilot scope? Start with five enterprise customers before broader launch.`

The durable answer text is the answer portion of the clause only. The question text itself is not copied into the answer.

### Deterministic Matching

Runtime now parses question-clause replies by:

- splitting the shared reply into candidate clauses on commas, semicolons, or line breaks
- trimming each resulting clause
- requiring each clause to contain one question sentence followed by non-empty answer text
- matching requested durable topics against the normalized question text inside that clause
- returning the clause-local answer text as the durable answer

This keeps the surface deterministic while dropping the extra requirement that every answer needs its own sentence boundary or paragraph block.

### Shared Reuse Across Existing Surfaces

Once parsed, the same question-clause surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `followThrough.answers`
- `followThrough.inferRemainingAnswers`

That means one longer clause stream can:

- resolve known auth and rollout decisions
- preserve the remaining pilot clause on planner follow-through
- or capture the remaining clause as a shared inferred planner answer without repeating its summary manually

### Deterministic New Decision Inference

`inferDecisionTopics` now also accepts `question_clauses`.

For this surface:

- reserved explicit decision answers still win first
- reserved inferred current open decisions still win next
- reserved planner-only summaries still win after that
- every remaining question clause becomes a durable decision topic
- the inferred decision summary is the clause question with the trailing `?` removed

Because that summary comes directly from the clause question text, this slice is best suited to concise topic-question anchors such as `Auth strategy?` or `Rollback trigger?`.

### Durable Prompt Preservation

Question-clause interpretation also preserves the matched clause question as durable `prompt` authority whenever runtime materializes:

- explicit decision answers without an overriding item-level prompt
- inferred current open decision answers
- inferred remaining planner answers
- brand-new durable decision topics from remaining question clauses

That keeps later question-based interpretation grounded in canonical user-facing wording instead of collapsing back to summary-only matching.

### Deterministic Validation

Runtime now rejects question-clause interpretation deterministically when:

- `sourceResponseFormat` is `question_clauses` but `sourceResponse` is missing
- one clause does not contain a question sentence
- one clause contains a question sentence but no answer text after it
- a requested explicit or open decision topic has no matching question clause
- more than one question clause matches the same requested topic
- more than one existing known decision matches one inferred remaining question clause

## Non-Goals

- fuzzy regrouping across adjacent clauses
- inferring topics from loose answer fragments that have no explicit question text
- replacing `question_spans` when the reply already has stable sentence boundaries
- semantic search, embeddings, or broader NLP-based question extraction

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one question-clause reply without requiring separate sentence or paragraph boundaries
- current open decisions can be resolved from question clauses without per-topic mapping
- remaining question clauses can become new durable decision topics when planner-only summaries are reserved first
- planner follow-through can consume the remaining question clause from the same shared reply
- malformed or ambiguously matched question clauses fail deterministically
