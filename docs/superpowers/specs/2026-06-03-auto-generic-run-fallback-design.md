# Auto Generic Run Fallback Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Refine `sourceResponseFormat: "auto"` so less-structured replies can deterministically fall through to already-implemented generic run surfaces when earlier topic-family probes only matched by durable consumer keywords and never established explicit topic authority.

## Why This Slice Exists

The authority stack already had:

- explicit `matching_opening_runs`
- explicit `matching_closing_runs`
- explicit `matching_middle_runs`
- auto selection across question/topic/ordered/pending/source-based surfaces

But there was still a real `auto` gap:

- some opening- or closing-anchored generic replies did not need a brand-new parser
- current `auto` probing already touched topic-family surfaces first
- those topic-family probes could partially consume a generic reply only because one sentence matched durable prompt keywords
- once that happened, `auto` treated the topic-family probe as terminal even when the reply never expressed explicit topic authority like `auth strategy`, `pilot scope`, or another inferable topic summary

That meant the runtime failed before it could even try existing deterministic generic run surfaces, despite already having enough durable authority to interpret the reply.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not weaken fail-closed behavior for real explicit authority surfaces
- do not introduce fuzzy or semantic fallback
- do not require `auto` to choose one exact internal surface when several deterministic surfaces fully capture the same reply

## Implemented Scope

### Auto Candidate Coverage

`AUTO_SOURCE_RESPONSE_FORMAT_PRIORITY` now includes:

- `matching_opening_runs`
- `matching_closing_runs`

So `auto` can explicitly probe those generic run surfaces instead of only falling through to weaker pending-order formats.

### Auto Completeness Guards

`assertAutoSourceResponseFormatCompleteness(...)` now also verifies:

- `matching_opening_runs`
- `matching_closing_runs`

using their consumed-run counts against parsed run totals, just like existing ordered/pending/source-based auto surfaces.

### Topic-Family Auto Precision

`shouldAutoSourceResponseProbeFailClosed(...)` is now stricter about what counts as real topic authority.

For topic-family surfaces:

- `topic_clauses`
- `topic_sentences`
- `topic_paragraphs`
- `topic_spans`
- `topic_middle_spans`
- `topic_closing_spans`
- `topic_closing_blocks`
- `topic_middle_blocks`
- `topic_blocks`

`auto` only treats the probe as terminal when at least one consumed unit also yields an explicit topic summary or anchor through the existing topic-summary extraction substrate.

If a topic-family probe only matched by durable prompt keywords and never established explicit topic authority, `auto` may continue probing later deterministic surfaces.

### User-Visible Effect

Less-structured generic replies can now succeed through `auto` when:

- an opening-anchored reply is fully captured by an existing deterministic opening-style surface such as `topic_spans` or `matching_opening_runs`
- a closing-anchored reply is fully captured by an existing deterministic closing-style surface such as `topic_closing_spans` or `matching_closing_runs`

without forcing callers to spell the surface name up front.

Real explicit topic authority still fail-closes exactly as before.

## Non-Goals

- forcing `auto` to prefer `matching_opening_runs` over `topic_spans` when both fully and deterministically capture the same reply
- forcing `auto` to prefer `matching_closing_runs` over `topic_closing_spans` when both fully and deterministically capture the same reply
- changing the durable truth model
- expanding `inferDecisionTopics` or `inferRemainingAnswers`
- making middle-anchored generic replies choose a new exact resolved format in this slice

## Acceptance Criteria

- `auto` can materialize deterministic opening-style generic replies across known decision consumers without requiring explicit `matching_opening_runs`
- `auto` can materialize deterministic closing-style generic replies across known decision consumers without requiring explicit `matching_closing_runs`
- API responses continue surfacing the concrete resolved format
- explicit topic authority still fail-closes instead of silently falling back
- affected answer-interpretation and API suites pass
