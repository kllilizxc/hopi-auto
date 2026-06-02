# Auto Source Response Format Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Add `sourceResponseFormat: "auto"` as a deterministic meta-surface, so assistant and Bun API callers can reuse the strongest successful existing answer-interpretation surface without hard-coding one concrete format name up front.

## Why This Slice Exists

The authority stack already had many deterministic answer-interpretation surfaces:

- reusable `answerSources` ordered or matched by durable authority
- labeled sections
- ordered items and ordered blocks
- question-shaped spans and blocks
- topic-shaped clauses, spans, paragraphs, and blocks
- pending-order whole-reply, clause, sentence, paragraph, and conjunction surfaces

That still left one real ergonomics gap:

- callers often already had a reply or reusable `answerSources` bundle that clearly fit one of those existing deterministic surfaces
- but they still had to spell out the concrete format name like `question_spans`, `topic_paragraphs`, or `matching_answer_sources`
- that repeated parser knowledge at every call site
- and it encouraged weaker long-term choices like guessing one low-authority surface too early instead of letting shared runtime apply one fixed authority order

The long-term authority route should let runtime pick from already-approved deterministic surfaces before inventing another parser family.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not add fuzzy or semantic matching
- choose only among already-implemented deterministic surfaces
- fail closed when no existing surface fits
- preserve explicit concrete `sourceResponseFormat` as the stronger caller authority when the intended interpretation must be pinned

## Implemented Scope

### Root `sourceResponseFormat: "auto"`

Assistant and Bun API surfaces now support:

- `sourceResponseFormat: "auto"`

across:

- `record_answer`
- `record_answers`
- `resolve_decision`
- direct `request_planning`
- direct `request_planning_batch`
- direct `request_planning_workflows`

### Shared Runtime Resolution

Shared runtime now resolves `auto` before creating interpretation state.

It does this by:

- listing the currently eligible deterministic candidate surfaces
- filtering candidates by available authority inputs like `sourceResponse`, `answerSources`, `inferOpenDecisions`, `inferDecisionTopics`, and `inferRemainingAnswers`
- trying candidates in one fixed authority order
- selecting the first candidate that materializes successfully and fully consumes its own structured units when that candidate has unit-level completeness checks
- failing closed instead of falling through when a higher-priority label surface has already established explicit label authority but still leaves some labels unconsumed
- failing closed if no candidate succeeds

`auto` therefore remains a meta-surface over existing deterministic interpreters, not a new parser family. Later authority slices may strengthen the completeness checks for more existing surfaces, but `auto` still never invents a new parser family of its own.

### Fixed Authority Priority

Current priority intentionally prefers stronger reusable or context-preserving surfaces first:

1. `matching_answer_sources`
2. `pending_answer_sources`
3. `labeled_sections`
4. `inline_topics`
5. `question_blocks`
6. `question_closing_blocks`
7. `question_middle_blocks`
8. `question_spans`
9. `question_middle_spans`
10. `question_closing_spans`
11. `question_clauses`
12. `topic_closing_blocks`
13. `topic_middle_blocks`
14. `topic_blocks`
15. `topic_paragraphs`
16. `topic_spans`
17. `topic_middle_spans`
18. `topic_closing_spans`
19. `topic_sentences`
20. `topic_clauses`
21. `ordered_blocks`
22. `ordered_items`
23. `single_pending`
24. `pending_paragraphs`
25. `pending_sentences`
26. `pending_conjunctions`
27. `pending_clauses`

This keeps runtime from discarding richer context too early by falling into a weaker clause or pending-order surface first.

### Decision And Planning Parity

Decision-backed answer flows and direct planning flows now both use the same `auto` resolution path.

That means:

- one decision bundle with follow-through resolves `auto` once and shares the resulting interpretation state
- direct planning requests and workflow batches resolve `auto` through the same shared runtime substrate
- assistant and Bun API no longer need separate ad hoc `auto` logic

## Non-Goals

- inventing new raw reply parser shapes
- inferring brand-new meaning through semantic similarity
- guessing between two equally plausible deterministic surfaces
- overriding an explicit concrete `sourceResponseFormat`

## Acceptance Criteria

- assistant and Bun API can set `sourceResponseFormat: "auto"` on decision-backed and direct planning answer flows
- runtime deterministically chooses the strongest successful existing interpretation surface by fixed priority
- `auto` rejects partially successful existing surfaces once they leave their own structured units unconsumed and a later existing surface can fully capture the reply
- `auto` does not let weaker later surfaces reinterpret a reply once higher-priority explicit label authority has already been established and then left incomplete
- richer context-preserving surfaces outrank weaker clause-only or pending-order fallbacks
- runtime fails closed when no existing deterministic surface fits
- explicit concrete `sourceResponseFormat` still bypasses `auto` selection
