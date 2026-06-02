# Pending Sentence Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured shared reply deterministically materialize onto more than one already-known pending answer consumer without repeating question/topic anchors, ordered-list markers, clause-level splitting, or paragraph-level splitting.

## Why This Slice Exists

The existing authority path already supported:

- `single_pending` for exactly one unresolved pending consumer
- `pending_clauses` for more than one pending consumer when the reply naturally split into clause-sized answer units
- `pending_paragraphs` for more than one pending consumer when the reply naturally split into paragraph-sized answer units
- ordered, question-shaped, and topic-shaped reply surfaces when the reply itself exposed stronger structure

That still left one narrower gap:

- current Goal state may already define more than one pending decision or planner-answer consumer
- the user may answer them in ordinary separate sentences
- there may be no repeated question text, no repeated topic labels, no ordered-list markers, and no useful clause or paragraph splitting

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- stay deterministic
- do not introduce fuzzy topic inference or semantic regrouping
- do not infer brand-new durable decision topics from this surface
- do not infer remaining planner answers from this surface
- reuse the existing shared answer-interpretation runtime

## Implemented Scope

### `sourceResponseFormat: "pending_sentences"`

Answer-driven assistant and Bun API surfaces now accept:

- `sourceResponseFormat: "pending_sentences"`

This surface is also available on direct planning request surfaces that already reuse the shared interpreted planner-answer runtime.

### Authority Shape

`pending_sentences` treats the shared reply as a sequence of sentence-level answer units.

Sentence splitting reuses the existing deterministic sentence parser, which already splits on:

- sentence-ending punctuation
- semicolon boundaries
- line breaks

Those sentence units are assigned in deterministic current pending order.

### Supported Pending Consumers

`pending_sentences` now works for:

- explicit decision answer entries that omitted `answer`
- current open decisions through `inferOpenDecisions`
- explicit planner answers on direct planning surfaces
- explicit planner answers on decision-backed follow-through surfaces

It does not create new decision topics and it does not infer remaining planner answers.

### Deterministic Consumption Order

Runtime consumes pending sentences in the same stable order already implied by the calling surface:

- explicit decision answers in payload order
- inferred open decisions in current durable open-decision order
- explicit planner answers in payload order

Each pending consumer receives the next unresolved sentence.

If no sentence remains for a pending consumer, runtime fails deterministically.

## Non-Goals

- inferring brand-new durable decision topics from unlabeled sentence replies
- inferring planner-only remaining answers from unlabeled sentence replies
- semantic regrouping of multiple sentences into one later answer span
- replacing stronger question/topic anchored formats when the reply already exposes more authority

## Acceptance Criteria

- assistant and Bun API can resolve more than one current open decision from one less-structured shared sentence reply without repeating question/topic anchors
- direct planning request surfaces can materialize more than one explicit planner answer from the same sentence reply
- the same shared runtime path powers decision-backed and direct-planning interpretation
- runtime rejects the surface deterministically when pending consumers outnumber the available sentences
