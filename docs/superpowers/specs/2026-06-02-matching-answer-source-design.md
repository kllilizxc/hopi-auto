# Matching Answer Source Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one explicit reusable `answerSources` bundle deterministically materialize onto more than one already-known pending answer consumer by matching source labels and hints, without requiring current pending order or per-topic `answerSourceKey` mapping on each consumer.

## Why This Slice Exists

The existing authority path already supported:

- explicit `answerSources` plus per-item `answerSourceKey` mapping
- `pending_answer_sources` for more than one pending consumer when source order itself was intended to be the authority
- the earlier `single_pending` / `pending_*` reply surfaces when the raw reply still exposed deterministic segmentation

That still left one narrower gap:

- the assistant may already be able to explicitly extract reusable answer snippets
- current Goal state may already define more than one pending decision or planner-answer consumer
- source order may not match consumer order
- requiring explicit per-consumer `answerSourceKey` mapping is redundant when source labels or hints already identify the intended consumer deterministically

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- stay deterministic
- do not introduce fuzzy topic inference or semantic regrouping
- do not infer brand-new durable decision topics from this surface
- do not infer remaining planner answers from this surface
- reuse the existing shared answer-interpretation runtime

## Implemented Scope

### `sourceResponseFormat: "matching_answer_sources"`

Answer-driven assistant and Bun API surfaces now accept:

- `sourceResponseFormat: "matching_answer_sources"`

This surface is also available on direct planning request surfaces that already reuse the shared interpreted planner-answer runtime.

### Authority Shape

`matching_answer_sources` treats the root `answerSources` array as a reusable set of labeled snippets.

Each source entry may still be:

- an explicit `answer`
- or a `sourceExcerpt` grounded in one shared `sourceResponse`

Each source entry now also contributes deterministic matching candidates from:

- a humanized `answerSourceKey`
- optional `summary`
- optional `prompt`
- optional `matchHints`

Runtime matches those source candidates against the current pending consumer’s existing candidate group and consumes the unique matching source entry.

### Supported Pending Consumers

`matching_answer_sources` now works for:

- explicit decision answer entries that omitted both `answer` and `answerSourceKey`
- current open decisions through `inferOpenDecisions`
- explicit planner answers on direct planning surfaces
- explicit planner answers on decision-backed follow-through surfaces

It does not create new decision topics and it does not infer remaining planner answers.

### Deterministic Matching Rules

Runtime:

- resolves all root answer sources first
- derives deterministic candidate groups from each source entry
- matches unresolved consumers against unresolved source entries by normalized candidate equality
- fails if more than one source entry matches the same consumer
- fails if no source entry matches a consumer

### Non-Goals

- inferring brand-new durable decision topics from reusable source labels
- inferring planner-only remaining answers from reusable source labels
- fuzzy semantic matching between answer sources and consumers
- replacing explicit per-consumer `answerSourceKey` when the caller wants to override the matching authority directly

## Acceptance Criteria

- assistant and Bun API can resolve more than one current open decision from reusable `answerSources` without per-topic mapping and without depending on source order
- direct planning request surfaces can materialize more than one explicit planner answer from the same reusable source bundle without per-answer mapping
- the same shared runtime path powers decision-backed and direct-planning interpretation
- runtime rejects the surface deterministically when source labels or hints match zero or more than one pending consumer
