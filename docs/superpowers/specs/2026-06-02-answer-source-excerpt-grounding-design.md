# Answer Source Excerpt Grounding Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let reusable named answer sources be grounded directly in one shared raw reply through explicit exact excerpts, so assistant can reuse topic-specific extracted snippets without retyping them and runtime can still verify those snippets actually came from the source response.

## Why This Slice Exists

The current system already supported:

- one shared raw `sourceResponse`
- reusable named `answerSources`
- per-item `answerSourceKey` references across durable decision answers and planner follow-through answers

That still left one authority gap:

- assistant could now avoid repeating mappings, but it still had to restate each extracted snippet inside `answerSources`
- that duplicated text which was already present in the shared raw reply
- it also left no deterministic grounding between the named snippet and the actual raw reply that supposedly contained it

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second raw-response store or durable answer-source registry
- preserve explicit `answer`-backed answer sources for cases where the final durable snippet should not be a verbatim excerpt
- keep excerpt validation deterministic and reject invalid payloads clearly

## Implemented Scope

### Excerpt-Backed Answer Sources

Root `answerSources` entries now support two explicit forms:

- `{ answerSourceKey, answer }`
- `{ answerSourceKey, sourceExcerpt }`

When an answer source uses `sourceExcerpt`, runtime materializes that source by lifting the exact excerpt text from the shared root `sourceResponse`.

### Shared Reuse Across Decisions And Planner Answers

Excerpt-backed answer sources work everywhere the existing answer-source model already worked:

- `record_answer`
- `record_answers`
- `resolve_decision`
- non-decision follow-through answers inside `planning`, `planning_batch`, and `workflow_batch`

This means one raw reply can now feed:

- reusable named excerpts
- mapped durable decision answers
- mapped planner-only follow-through answers

without retyping the excerpt text.

### Deterministic Validation

Runtime now rejects excerpt-grounding payloads deterministically when:

- `sourceExcerpt` is used without a root `sourceResponse`
- `sourceExcerpt` is not found inside that `sourceResponse`
- the root `answerSources` bundle repeats one `answerSourceKey`
- an item references an unknown `answerSourceKey`

These remain input errors rather than partial durable writes or generic runtime failures.

## Non-Goals

- fuzzy matching, semantic extraction, or NLP-driven snippet inference
- start/end character offsets or a second positional anchor system
- automatically deciding which excerpt belongs to which durable topic
- replacing explicit `answer`-backed answer sources when assistant intentionally wants cleaned-up or condensed text

## Acceptance Criteria

- answer-driven assistant and Bun API surfaces can materialize reusable answer sources from exact `sourceExcerpt` values inside one shared `sourceResponse`
- excerpt-backed answer sources can be reused across multiple durable decision answers and planner follow-through answers
- missing or mismatched `sourceExcerpt` values fail deterministically
- existing explicit `answer`-backed answer sources continue to work unchanged
