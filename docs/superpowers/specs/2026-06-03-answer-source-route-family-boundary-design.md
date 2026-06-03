# Answer-Source Route Family Boundary

## Goal

Promote explicit reusable `answerSources[*].route` from a mixed-leftover routing hint into a real family boundary for known consumer matching.

Once a reusable source entry says:

- `route: "decision"`
- or `route: "planning"`

runtime should stop treating that source as eligible for the opposite consumer family during implicit answer-source interpretation.

## Why

The earlier route-metadata slice let leftovers choose the decision side or planner side when one mutation simultaneously used:

- `inferDecisionTopics: true`
- `followThrough.inferRemainingAnswers: true`

That still left a weaker gap: before runtime ever reached leftover inference, known open decisions and explicit planner-answer consumers could still implicitly match a reusable source entry from the wrong family.

That meant explicit route metadata was not yet a full authority surface. It only mattered after other implicit matching had already happened.

## Required Behavior

### Matching answer sources

Under `sourceResponseFormat: "matching_answer_sources"`:

- decision consumers only see entries whose `route` is absent or `"decision"`
- planner consumers only see entries whose `route` is absent or `"planning"`

This applies to:

- explicit decision answers
- `inferOpenDecisions`
- explicit planner answers on planning follow-through or direct planning surfaces

### Pending answer sources

Under `sourceResponseFormat: "pending_answer_sources"`:

- route metadata becomes an explicit family-order boundary
- if the next ordered reusable source entry is routed to the wrong family for the current consumer, runtime fails closed instead of silently consuming it

Pending route metadata does **not** become a grouping identity by itself. It only selects the family. Adjacent merge still requires the stronger durable authorities that already exist:

- `decisionKey`
- `answerKey`
- `summaryKey`

So two adjacent `route: "decision"` entries without stronger grouping keys remain two separate ordered decision-side entries, not one merged answer.

## Fail-Closed Rules

Runtime must reject:

- a decision consumer encountering the next pending reusable source entry with `route: "planning"`
- a planner consumer encountering the next pending reusable source entry with `route: "decision"`
- any attempt to use route metadata as an implicit same-consumer grouping key on `pending_answer_sources`

Runtime must not silently reinterpret one family’s explicitly routed source as belonging to the other family.

## Non-Goals

This slice does not:

- change explicit `answerSourceKey` mapping semantics; direct per-item `answerSourceKey` still overrides family inference
- broaden mixed leftover inference beyond the already-approved `route` / `decisionKey` / `answerKey` substrate
- introduce new parser families

## Verification

- Runtime tests cover route-aware `matching_answer_sources` success across overlapping decision/planner consumers.
- Runtime tests cover `pending_answer_sources` fail-closed behavior when explicit route order conflicts with the current consumer family.
- API and assistant tests cover the same boundary through real mutation surfaces.
