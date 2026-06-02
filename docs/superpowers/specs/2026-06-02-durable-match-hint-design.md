# Durable Match Hint Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Add explicit durable `matchHints` on decision topics and planner answers, so later answer interpretation can reuse stable product-approved phrasing instead of forcing more work onto prompt-keyword heuristics or ever-looser parser rules.

## Why This Slice Exists

The current authority stack already had:

- stable `decisionKey`
- concise decision `summary`
- optional exact decision `prompt`
- durable planner-answer `summary`
- optional planner-answer `prompt`

That still left one real gap:

- some user replies repeat neither the durable topic summary nor the exact question wording
- pushing deeper interpretation forward only by adding more regex surfaces would keep shifting authority toward heuristics
- the long-term path should let product or assistant persist the exact alternative phrasing that is allowed to match a durable decision or planner answer later

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable stores
- do not add a second synonym registry, alias database, or fuzzy embedding layer
- keep matching deterministic and explicit
- preserve current prompt-based and summary-based matching behavior
- merge richer hint metadata into existing durable records instead of duplicating them

## Implemented Scope

### Durable `matchHints` On Decisions

`GoalDecision` now supports optional `matchHints: string[]`.

These hints act as extra durable matching authority alongside:

- `decisionKey`
- `summary`
- `prompt`

Shared decision request, answer, and resolve paths can all create or enrich those hints.

### Durable `matchHints` On Planner Answers

`GoalPlanningRequestAnswer` now supports optional `matchHints: string[]`.

This applies across:

- direct planning requests
- grouped planning requests
- workflow-root shared answers
- decision-backed and answer-backed follow-through answers

Later richer writes merge hints into the existing durable answer row instead of creating duplicates.

### Shared Interpreter Candidate Expansion

Shared answer interpretation now treats durable `matchHints` as first-class source-response candidates for:

- explicit decision answers
- inferred open decisions
- known decision reuse during inferred decision-topic materialization
- explicit planner answers
- workflow-root shared planner answers

This keeps matching on one deterministic substrate while reducing dependence on repeated prompt wording or repeated topic labels.

### Active Product Surfaces

The active Bun API and assistant action surfaces now accept and persist `matchHints` through:

- `request_decision`
- `record_answer`
- `record_answers`
- `resolve_decision`
- captured planner answers on direct planning and follow-through surfaces

## Non-Goals

- fuzzy semantic matching without explicit durable authority
- automatic hint inference from arbitrary loose prose
- a new parser family that bypasses durable prompts, summaries, and hints entirely
- solving brand-new decision-topic inference when the reply exposes no deterministic durable cue at all

## Acceptance Criteria

- decisions can persist optional durable `matchHints`
- planner answers can persist optional durable `matchHints`
- later writes merge richer hints into existing durable records instead of duplicating them
- shared answer interpretation uses those hints as matching authority across assistant and Bun API paths
- the feature reduces dependence on prompt-keyword and topic-label repetition without introducing a second durability store
