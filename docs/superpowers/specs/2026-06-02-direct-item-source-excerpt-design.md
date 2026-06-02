# Direct Item Source Excerpt Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one decision answer or planner follow-through answer ground itself directly in an exact excerpt from a shared raw reply, without first forcing assistant or API callers to define a reusable named `answerSources` bundle when that excerpt is only needed once.

## Why This Slice Exists

The current system already supported:

- whole-reply reuse through root `sourceResponse`
- reusable named extracted snippets through `answerSources`
- exact grounding of named answer sources through `answerSources[*].sourceExcerpt`

That still left one authority gap:

- when a snippet only needed to feed one durable decision topic or one planner answer, callers still had to introduce root `answerSources` just to ground that single item
- that made small answer-driven actions more verbose than necessary
- the remaining explicit ceremony was not giving additional durable authority when no cross-item reuse was needed

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second excerpt store, extraction registry, or positional anchor system
- preserve named `answerSources` for real reuse across multiple items
- keep direct excerpt grounding deterministic and reject invalid payloads clearly

## Implemented Scope

### Direct `sourceExcerpt` On Interpretable Answer Items

Decision-answer items and interpretable planner-answer items now support:

- `sourceExcerpt`

This works on:

- `record_answer`
- `record_answers`
- `resolve_decision`
- non-decision follow-through answers inside `planning`, `planning_batch`, and `workflow_batch`

### Deterministic Resolution Order

Runtime now resolves one item’s answer text in this order:

1. item `answer`
2. item `sourceExcerpt`
3. item `answerSourceKey`
4. root `sourceResponse`

This keeps the most local per-item interpretation authoritative while still preserving reusable named sources and whole-reply fallback.

### Deterministic Validation

Runtime now rejects direct item excerpts deterministically when:

- `sourceExcerpt` is present but root `sourceResponse` is missing
- `sourceExcerpt` is not found inside `sourceResponse`

These stay input errors rather than becoming partial writes or generic runtime failures.

## Non-Goals

- semantic or fuzzy excerpt matching
- inferring which excerpt belongs to which durable topic
- replacing named `answerSources` when the same snippet should feed more than one item
- collapsing direct excerpts into a new durable store

## Acceptance Criteria

- answer-driven assistant and Bun API surfaces can ground one decision answer or planner answer directly in `sourceResponse` through `sourceExcerpt`
- direct item excerpts work without defining root `answerSources`
- missing or mismatched direct item excerpts fail deterministically
- named `answerSources` and whole-reply `sourceResponse` behavior continue to work
