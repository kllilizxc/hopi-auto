# Matching Opening Run Source Response Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Add `sourceResponseFormat: "matching_opening_runs"` as a deterministic answer-interpretation surface for less-structured shared replies where each already-known consumer appears once at the start of a longer answer stretch and later continuation prose should stay attached to that same consumer.

## Why This Slice Exists

The authority stack already had deterministic surfaces for:

- labeled replies
- question/topic anchored replies
- ordered replies
- pending-order replies
- reusable `answerSources`
- repeated-consumer `matching_runs`
- middle-anchored generic `matching_middle_runs`

That still left one real gap:

- one shared reply could mention a known decision or explicit planner-answer consumer only once
- that consumer-specific anchor could appear at the very start of its answer stretch
- later continuation prose should stay attached to that same answer
- but the reply might not contain explicit topic/question syntax, ordered structure, or reusable `answerSources`

The long-term fix should stay deterministic and reuse current durable consumer authority instead of inventing a fuzzier parser family.

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

- `sourceResponseFormat: "matching_opening_runs"`

across decision-backed and direct-planning answer interpretation surfaces that already support explicit consumer materialization.

### Opening-Run Construction

Shared runtime now:

1. registers the currently eligible consumer candidate groups
2. splits the shared reply into deterministic natural units using this priority:
   - paragraphs when there is more than one paragraph
   - otherwise sentences when there is more than one sentence
   - otherwise clauses when there is more than one clause
   - otherwise the whole reply
3. treats one or more initial contiguous matched units for the same consumer as that run's opening anchor sequence
4. requires each run to end with at least one trailing unmatched unit after the opening anchor sequence
5. ends the current run when a different matched consumer appears after at least one trailing unit
6. starts the next run at that new matched anchor

### Deterministic Validation

Runtime now rejects `matching_opening_runs` when:

- `sourceResponse` is missing
- no candidate groups were registered for the current materialization
- one unit matches more than one consumer
- the reply begins with unmatched leading prose before the first matched anchor
- a different matched consumer appears before the current run has gained any trailing continuation unit
- the same matched consumer reappears after trailing continuation has already started for that run
- the last run ends immediately after its matched anchor sequence and therefore has no trailing continuation unit
- one requested explicit or open decision consumer has no matching opening run
- one requested explicit decision or planner-answer consumer would need more than one non-consumed opening run

### Materialization Rules

- explicit decision answers may resolve from one opening run
- explicit planner answers may resolve from one opening run
- `inferOpenDecisions` may reuse one opening run for the current open durable decision
- continuation prose stays attached to the matched consumer instead of being silently dropped
- this slice still does not create brand-new decision topics or inferred remaining planner answers

### Shared Bundle Contract

Cross-surface reuse matters here too:

- if one shared reply carries explicit decision answers first and explicit planner answers later, runtime must already know the later planner candidate groups before it parses the earlier decision runs
- low-level helper callers can do that through `additionalSourceResponseCandidates`
- higher-level decision bundle and API paths already do it through the existing `reservedAnswerCandidates` substrate

That keeps one earlier decision run from swallowing a later planner run merely because the later consumer had not been registered yet.

## Non-Goals

- auto-selecting `matching_opening_runs` in this slice
- brand-new durable decision-topic inference from `matching_opening_runs`
- remaining planner-answer inference from `matching_opening_runs`
- semantic regrouping across non-contiguous answer stretches
- fuzzy matching between reply text and unknown topics

## Acceptance Criteria

- one shared reply can materialize more than one explicit decision or planner answer when each known consumer appears once at the start of its answer stretch
- `inferOpenDecisions` can reuse opening runs for current open decisions without per-topic mapping
- shared decision/planner replies keep later continuation prose attached to the correct consumer
- adjacent anchors fail deterministically when they do not leave at least one trailing continuation unit for the current run
- API coverage passes
- affected answer-interpretation suites pass
