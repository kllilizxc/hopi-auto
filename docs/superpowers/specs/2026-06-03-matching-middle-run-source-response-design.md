# Matching Middle Run Source Response Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Add `sourceResponseFormat: "matching_middle_runs"` as a deterministic answer-interpretation surface for less-structured shared replies where each already-known consumer appears once in the middle of a longer answer stretch, with leading and trailing continuation prose around that anchor.

## Why This Slice Exists

The authority stack already had deterministic surfaces for:

- labeled replies
- question/topic anchored replies
- ordered replies
- pending-order replies
- reusable `answerSources`
- repeated-consumer `matching_runs`

That still left one narrow but real gap:

- one shared reply could mention a known decision or explicit planner-answer consumer only once
- the important consumer-specific sentence could sit in the middle of that answer, not at the start or end
- earlier and later continuation prose should stay attached to that same answer instead of being dropped or forcing a topic/question-shaped surface that does not actually fit the reply

The long-term fix should stay deterministic and reuse existing durable consumer authority, not invent another fuzzy parser family.

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

- `sourceResponseFormat: "matching_middle_runs"`

across decision-backed and direct-planning answer interpretation surfaces that already support explicit consumer materialization.

### Middle-Run Construction

Shared runtime now:

1. registers the currently eligible consumer candidate groups
2. splits the shared reply into deterministic natural units using this priority:
   - paragraphs when there is more than one paragraph
   - otherwise sentences when there is more than one sentence
   - otherwise clauses when there is more than one clause
   - otherwise the whole reply
3. treats one unit as the consumer-specific anchor when it matches exactly one candidate group
4. requires each run to have:
   - at least one leading unit before the anchor
   - exactly one matched anchor unit
   - at least one trailing unit after the anchor
5. when a later anchor appears, assigns the unit immediately before that later anchor to the next run as its leading unit
6. assigns any earlier post-anchor units to the current run as trailing continuation

### Deterministic Validation

Runtime now rejects `matching_middle_runs` when:

- `sourceResponse` is missing
- no candidate groups were registered for the current materialization
- one unit matches more than one consumer
- the first matched anchor has no leading unit
- the last matched anchor has no trailing unit
- adjacent anchors do not leave both one trailing unit for the current run and one leading unit for the next run
- one requested explicit or open decision consumer has no matching middle run
- one requested explicit decision or planner-answer consumer would need more than one non-consumed middle run

### Materialization Rules

- explicit decision answers may resolve from one middle run
- explicit planner answers may resolve from one middle run
- `inferOpenDecisions` may reuse one middle run for the current open durable decision
- continuation prose stays attached to the matched consumer instead of being silently dropped
- this slice still does not create brand-new decision topics or inferred remaining planner answers

### Shared Bundle Contract

Cross-surface reuse matters here:

- if one shared reply carries explicit decision answers first and explicit planner answers later, the runtime must already know the later planner candidate groups before it parses the early decision runs
- low-level helper callers can do that through `additionalSourceResponseCandidates`
- higher-level decision bundle and API paths already do it through the existing `reservedAnswerCandidates` substrate

That keeps one earlier decision run from swallowing a later planner run merely because the later consumer had not been registered yet.

## Non-Goals

- auto-selecting `matching_middle_runs` ahead of stronger question/topic surfaces in this slice
- brand-new durable decision-topic inference from `matching_middle_runs`
- remaining planner-answer inference from `matching_middle_runs`
- semantic regrouping across non-contiguous answer stretches
- fuzzy matching between reply text and unknown topics

## Acceptance Criteria

- one shared reply can materialize more than one explicit decision or planner answer when each known consumer appears once in the middle of its answer stretch
- `inferOpenDecisions` can reuse middle runs for current open decisions without per-topic mapping
- shared decision/planner replies keep surrounding continuation prose attached to the correct consumer
- adjacent anchors fail deterministically when they do not leave both trailing and leading continuation units
- API coverage passes
- affected answer-interpretation suites pass
