# Answer Source Decision Key Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Strengthen reusable `answerSources` with one explicit durable decision identity, so they can target known decisions or materialize new durable decision topics by `decisionKey` instead of relying on summary wording, prompt wording, or extra parser heuristics.

## Why This Slice Exists

The current explicit reusable-source substrate was already strong on two fronts:

- planner-side reusable sources could target known planner answers by durable `answerKey`
- decision-side reusable sources could target known decisions by `summaryKey`, prompt text, match hints, or humanized labels

But one asymmetry remained:

- decisions already had a true durable row identity, `decisionKey`
- reusable `answerSources` could not directly use that same identity

That left two avoidable gaps:

- a reusable source that obviously belonged to an existing known decision still had to rely on summary or prompt authority
- a reusable source that should explicitly create a new durable decision topic with one product-approved key still had to restate summary text or rely on a weaker derived key path

The long-term authority route should let the strongest durable decision identity participate directly.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not add a new parser family
- do not widen fuzzy or semantic matching
- keep planner-side `answerKey` semantics unchanged
- keep remaining reusable-source materialization fail-closed when there is no explicit durable authority

## Implemented Scope

### Reusable Sources Can Target Known Decisions by `decisionKey`

`InterpretableAnswerSource` now accepts:

- `decisionKey`

When `sourceResponseFormat` is `matching_answer_sources`, runtime now treats that field as first-class matching authority alongside the existing summary-, prompt-, and hint-based candidates.

This means one reusable source can now resolve a known open decision directly through the same durable key already stored in `decisions.yml`, without repeating the human-facing summary.

### Remaining Reusable Sources Can Materialize New Decisions by `decisionKey`

When one reusable source entry remains unclaimed and `inferDecisionTopics` is enabled, runtime can now derive a brand-new durable decision topic from explicit `decisionKey` authority.

That path now:

- humanizes the explicit `decisionKey` into a durable summary
- synthesizes the canonical prompt from that summary when no stronger prompt already exists
- persists the new durable decision using that same explicit `decisionKey`

So one source entry like:

- `decisionKey: "launch-sequencing"`

can now directly produce:

- decision key `launch-sequencing`
- summary `Launch sequencing`
- prompt `What should the launch sequencing be?`

without restating summary text.

### Existing Known Decisions Still Reuse the Durable Row

If a remaining reusable source entry carries `decisionKey` that already exists in known decisions, runtime now reuses that existing durable row instead of creating a duplicate decision topic by summary lookup.

That makes `decisionKey` the strongest reusable-source identity for decisions.

### Assistant and API Surfaces

The following surfaces now accept `answerSources[*].decisionKey`:

- decision-answer API
- assistant decision actions via `record_answer`, `record_answers`, and `resolve_decision`
- direct planning/decision shared answer-source schema where reusable sources already flow through the common interpreter

Assistant guidance now explicitly documents `decisionKey` as the decision-side row-identity analogue to planner-side `answerKey`.

## Example

Given one existing durable decision:

- `decisionKey: "launch-sequencing"`
- summary `Choose the launch sequencing`

this now works:

- `answerSources: [{ answerSourceKey: "source-1", decisionKey: "launch-sequencing", answer: "Use a staged rollout." }]`
- `sourceResponseFormat: "matching_answer_sources"`
- `inferOpenDecisions: true`

Runtime resolves that decision directly without needing `summaryKey` or prompt matching.

And this now works for new-topic materialization:

- `answerSources: [{ answerSourceKey: "source-2", decisionKey: "launch-sequencing", answer: "Use a staged rollout." }]`
- `sourceResponseFormat: "matching_answer_sources"`
- `inferDecisionTopics: true`

Runtime creates a new durable decision topic keyed by `launch-sequencing`.

## Non-Goals

- adding planner-side `decisionKey`
- changing `answerKey` semantics for planner answers
- inventing a new answer-source format
- adding fuzzy key aliases
- allowing arbitrary remaining reusable sources to materialize decisions without explicit durable authority

## Acceptance Criteria

- reusable `answerSources` can match existing known decisions by explicit `decisionKey`
- remaining reusable `answerSources` can materialize new durable decision topics by explicit `decisionKey`
- existing decision rows are reused when the supplied `decisionKey` already exists
- assistant and Bun API schemas accept `answerSources[*].decisionKey`
- assistant guidance documents `decisionKey` as reusable-source decision identity authority
