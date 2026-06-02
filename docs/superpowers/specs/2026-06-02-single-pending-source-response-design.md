# Single Pending Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured shared reply deterministically materialize onto exactly one unresolved pending answer consumer without requiring explicit question/topic anchors or ordered reply structure.

## Why This Slice Exists

The current system already supported:

- whole-reply reuse through root `sourceResponse`
- reusable named snippets through `answerSources`
- direct and named excerpt grounding
- labeled sections
- ordered items and ordered blocks
- question-shaped and topic-shaped structured reply surfaces
- current-open-decision reuse from structured replies
- remaining structured-item inference into new durable decision topics or planner answers

That still left one narrower authority gap:

- sometimes current Goal state already narrows the answer target down to exactly one unresolved decision or one unresolved explicit planner-answer slot
- the user reply may be completely less-structured and not repeat the original question text
- there may be no labels, no ordered list, and no topic-bearing anchor sentence at all
- the missing surface was not fuzzy interpretation of many answers, but deterministic capture of one already-known pending answer

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- stay deterministic
- reject ambiguity instead of guessing which pending consumer should receive the reply
- preserve existing labeled, ordered, question-shaped, and topic-shaped answer surfaces

## Implemented Scope

### Root `sourceResponseFormat: "single_pending"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "single_pending"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Authority Shape

`single_pending` is not a new parser shape. It is an authority declaration:

- the shared reply should be treated as one whole answer
- exactly one unresolved pending answer consumer is allowed to materialize from that shared reply
- if more than one consumer remains, runtime fails deterministically instead of guessing

That consumer can be:

- one explicit decision answer entry that omitted `answer`
- one inferred current open decision through `inferOpenDecisions`
- one explicit planner answer inside `followThrough.answers`

### Deterministic Consumption Rules

Runtime now handles `single_pending` by:

- trimming the whole shared `sourceResponse`
- assigning it to the first unresolved pending consumer
- marking the shared reply as consumed
- throwing if any second unresolved consumer also tries to consume it

This means the whole less-structured reply stays intact as durable answer text, but only when the current Goal state makes the target unambiguous.

### Shared Reuse Across Existing Surfaces

`single_pending` now works for:

- explicit decision answers
- `inferOpenDecisions`
- explicit planner follow-through answers

Example:

- one current open decision asks `Which auth provider should we adopt for the Bun-first product path?`
- user replies `Use Bun-native auth. That keeps the runtime simple.`
- assistant/API can set `sourceResponseFormat: "single_pending"` plus `inferOpenDecisions: true`
- runtime resolves that one open decision with the full shared reply as its durable answer

### Deterministic Rejection

Runtime now rejects `single_pending` deterministically when:

- `sourceResponse` is missing
- more than one explicit decision answer entry would consume the shared reply
- more than one current open decision would consume the shared reply
- one explicit consumer already consumed the shared reply and another decision or planner answer tries to consume it afterward

This slice intentionally prefers a hard boundary over heuristics.

## Non-Goals

- inferring brand-new durable decision topics from anchorless freeform replies
- inferring more than one pending answer from one anchorless freeform reply
- replacing ordered or anchored reply surfaces when more than one answer still needs to be split out
- fuzzy matching, semantic clustering, or paraphrase-based topic inference

## Acceptance Criteria

- assistant and Bun API can resolve exactly one current open decision from a less-structured shared reply without repeating its question
- explicit answer consumers can also opt into the same single-consumer whole-reply authority
- any second pending consumer causes deterministic rejection instead of guesswork
- no new durable parsed-response store or fuzzy inference layer is introduced
