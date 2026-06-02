# Pending Answer Source Order Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured reply deterministically materialize onto more than one already-known pending answer consumer by lifting that reply into an ordered reusable `answerSources` bundle, without requiring per-topic mapping.

## Why This Slice Exists

The existing authority path already supported:

- explicit `answerSources` plus per-item `answerSourceKey` mapping
- `single_pending` for exactly one unresolved pending consumer
- `pending_clauses`, `pending_paragraphs`, `pending_sentences`, and `pending_conjunctions` when the reply itself still exposed one deterministic segmentation surface
- ordered, question-shaped, and topic-shaped reply surfaces when the reply itself exposed stronger structure

That still left one narrower gap:

- the assistant may already be able to explicitly extract reusable answer snippets from a raw reply
- current Goal state may already define more than one pending decision or planner-answer consumer
- requiring `answerSourceKey` on every consumer is redundant when the only intended authority is current pending order

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- stay deterministic
- do not introduce fuzzy topic inference or semantic regrouping
- do not infer brand-new durable decision topics from this surface
- do not infer remaining planner answers from this surface
- reuse the existing shared answer-interpretation runtime

## Implemented Scope

### `sourceResponseFormat: "pending_answer_sources"`

Answer-driven assistant and Bun API surfaces now accept:

- `sourceResponseFormat: "pending_answer_sources"`

This surface is also available on direct planning request surfaces that already reuse the shared interpreted planner-answer runtime.

### Authority Shape

`pending_answer_sources` treats the root `answerSources` array itself as the ordered answer substrate.

Each answer source may still be:

- an explicit `answer`
- or a `sourceExcerpt` grounded in one shared `sourceResponse`

The runtime resolves those source entries first, preserves their array order, and then assigns them in deterministic current pending order.

### Supported Pending Consumers

`pending_answer_sources` now works for:

- explicit decision answer entries that omitted both `answer` and `answerSourceKey`
- current open decisions through `inferOpenDecisions`
- explicit planner answers on direct planning surfaces
- explicit planner answers on decision-backed follow-through surfaces

It does not create new decision topics and it does not infer remaining planner answers.

### Deterministic Consumption Order

Runtime consumes ordered answer-source values in the same stable order already implied by the calling surface:

- explicit decision answers in payload order
- inferred open decisions in current durable open-decision order
- explicit planner answers in payload order

Each pending consumer receives the next unresolved answer-source value.

If no answer-source value remains for a pending consumer, runtime fails deterministically.

## Non-Goals

- inferring brand-new durable decision topics from ordered answer-source bundles
- inferring planner-only remaining answers from ordered answer-source bundles
- semantic regrouping or fuzzy reordering of answer-source entries
- replacing explicit `answerSourceKey` mapping when the caller needs non-sequential routing

## Acceptance Criteria

- assistant and Bun API can resolve more than one current open decision from ordered reusable `answerSources` without per-topic mapping
- direct planning request surfaces can materialize more than one explicit planner answer from the same ordered answer-source bundle
- the same shared runtime path powers decision-backed and direct-planning interpretation
- runtime rejects the surface deterministically when pending consumers outnumber the available answer-source values
