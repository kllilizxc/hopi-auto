# Matching Run Source Response Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Add `sourceResponseFormat: "matching_runs"` as a deterministic answer-interpretation surface for repeated stretches that keep revisiting the same already-known answer consumer.

## Why This Slice Exists

The authority stack already had deterministic surfaces for:

- labeled replies
- question/topic anchored replies
- ordered replies
- pending-order replies
- reusable `answerSources` matched by order or labels

That still left one real gap:

- one shared reply could revisit the same already-known decision or explicit planner-answer consumer more than once
- existing narrower surfaces could over-split that reply into duplicate answer items or truncate trailing continuation prose
- the long-term fix should stay deterministic and reuse current durable consumer authority instead of inventing a fuzzier parser family

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not add fuzzy or semantic matching
- only support explicit answer consumers plus `inferOpenDecisions`
- do not widen this slice into `inferDecisionTopics`
- do not widen this slice into `followThrough.inferRemainingAnswers`
- fail closed when one reply unit ambiguously matches more than one consumer

## Implemented Scope

### New Explicit Surface

Assistant and Bun API now accept:

- `sourceResponseFormat: "matching_runs"`

across decision-backed and direct-planning answer interpretation surfaces that already support explicit consumer materialization.

### Run Construction

Shared runtime now:

1. registers the currently eligible consumer candidate groups
2. splits the shared reply into deterministic natural units using this priority:
   - paragraphs when there is more than one paragraph
   - otherwise sentences when there is more than one sentence
   - otherwise clauses when there is more than one clause
   - otherwise the whole reply
3. walks those units in order
4. merges contiguous units into one run when they keep matching the same consumer
5. allows unmatched continuation units to stay attached only while the next matched unit still belongs to that same consumer
6. fails closed when unmatched prose appears before the first matched run, between different matched consumers, or after the last matched run
7. starts a new run only when the matched consumer changes

### Materialization Rules

- explicit decision answers may resolve from one merged matching run
- explicit planner answers may resolve from one merged matching run
- `inferOpenDecisions` may reuse one merged matching run for the current open durable decision
- a unit that matches more than one consumer fails closed
- a consumer that would need more than one non-consumed run fails closed
- orphan prose that does not stay inside one consumer's repeated run fails closed instead of being silently absorbed into the nearest known consumer

### Auto Interaction

`matching_runs` is also available to `sourceResponseFormat: "auto"` as a later generic fallback when no stronger explicit label, reusable-source, or question/topic-anchor authority has already attached to the same reply and then remained incomplete.

This slice does **not** change the broader `auto` success heuristic. It only adds one more already-implemented deterministic surface that `auto` may choose after stronger existing surfaces fail.

## Non-Goals

- brand-new durable decision-topic inference from `matching_runs`
- remaining planner-answer inference from `matching_runs`
- semantic grouping across non-contiguous answer stretches
- fuzzy matching between reply text and unknown topics

## Acceptance Criteria

- repeated contiguous mentions of one already-known decision consumer can materialize as one merged answer run
- repeated contiguous mentions of one already-known planner-answer consumer can materialize as one merged answer run
- `inferOpenDecisions` can reuse merged runs without duplicating one open decision
- API coverage passes
- affected answer-interpretation suites pass
