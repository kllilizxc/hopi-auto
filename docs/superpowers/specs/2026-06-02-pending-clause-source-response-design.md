# Pending Clause Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one less-structured shared reply deterministically materialize onto more than one already-known pending answer consumer without repeating question/topic anchors or relying on ordered-list markers.

## Why This Slice Exists

The existing authority path already supported:

- `single_pending` for exactly one unresolved pending consumer
- `ordered_items` and `ordered_blocks` when the reply itself exposed explicit ordered structure
- question-shaped and topic-shaped formats when the reply repeated a stable question or topic anchor

That still left one narrower but real gap:

- current Goal state may already define more than one pending decision or planner-answer consumer
- the user reply may answer them in a natural compact sentence
- there may be no repeated question text, no repeated topic labels, and no ordered-list markers
- `single_pending` is too narrow, while ordered or anchored formats are too ceremonial

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- stay deterministic
- do not introduce semantic clustering or fuzzy topic inference
- do not infer brand-new decision topics from this surface
- do not infer remaining planner answers from this surface
- reuse the existing shared answer-interpretation runtime

## Implemented Scope

### `sourceResponseFormat: "pending_clauses"`

Answer-driven assistant and Bun API surfaces now accept:

- `sourceResponseFormat: "pending_clauses"`

This surface is also available on direct planning request surfaces that already reuse the shared interpreted planner-answer runtime.

### Authority Shape

`pending_clauses` treats the shared reply as a sequence of natural clause-level answer items.

Clause boundaries are parsed from the existing shared clause splitter:

- commas
- semicolons
- newlines
- sentence boundaries

Those clauses are then assigned in deterministic current pending order.

### Supported Pending Consumers

`pending_clauses` now works for:

- explicit decision answer entries that omitted `answer`
- current open decisions through `inferOpenDecisions`
- explicit planner answers on direct planning surfaces
- explicit planner answers on decision-backed follow-through surfaces

It does not create new decision topics and it does not infer remaining planner answers.

### Deterministic Consumption Order

Runtime consumes pending clauses in the same stable order already implied by the calling surface:

- explicit decision answers in payload order
- inferred open decisions in current durable open-decision order
- explicit planner answers in payload order

Each pending consumer receives the next unresolved clause.

If no clause remains for a pending consumer, runtime fails deterministically.

## Non-Goals

- inferring brand-new durable decision topics from unlabeled clause replies
- inferring planner-only remaining answers from unlabeled clause replies
- semantic matching across clause meaning
- replacing question/topic anchored formats when the reply already exposes stronger authority

## Acceptance Criteria

- assistant and Bun API can resolve more than one current open decision from one less-structured shared clause reply without repeating question/topic anchors
- direct planning request surfaces can materialize more than one explicit planner answer from the same clause reply
- the same shared runtime path powers decision-backed and direct-planning interpretation
- runtime rejects the surface deterministically when pending consumers outnumber the available clauses
