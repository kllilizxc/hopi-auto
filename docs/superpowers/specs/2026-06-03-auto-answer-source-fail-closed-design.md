# Auto Answer-Source Fail-Closed Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Strengthen `sourceResponseFormat: "auto"` so explicit reusable `answerSources` authority cannot be silently bypassed by weaker raw-`sourceResponse` surfaces once the answer-source family has already been selected and found incomplete.

## Why This Slice Exists

The earlier `auto` slices already:

- rejected partially successful unit-based candidates
- failed closed when explicit multi-label `labeled_sections` or `inline_topics` authority was established but left incomplete

That still left one authority gap:

- callers could provide explicit reusable `answerSources`
- `auto` could probe `matching_answer_sources`, then fall back to `pending_answer_sources`
- if the ordered answer-source surface still left one reusable source unconsumed, `auto` could continue probing raw `sourceResponse` surfaces like `labeled_sections`
- that let weaker raw reply interpretation override the stronger explicit reusable-source substrate

The long-term authority route should allow fallback inside the answer-source family, but should fail closed before leaving that family for weaker raw-reply interpretation.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not add fuzzy or semantic matching
- do not invent a new parser family
- keep explicit concrete `sourceResponseFormat` stronger than `auto`

## Implemented Scope

### Internal Answer-Source Fallback Still Allowed

`auto` still allows:

- `matching_answer_sources`
- then `pending_answer_sources`

inside the same explicit reusable-source family.

This preserves the useful deterministic path where:

- label/hint matching is too weak or unavailable for one request
- but current source order can still satisfy the same known consumers

### Pending Answer-Source Terminal Boundary

Once `pending_answer_sources` has established explicit reusable-source authority and still cannot fully satisfy the reply, `auto` now fails closed instead of dropping to weaker raw-`sourceResponse` surfaces.

Current rule:

- if `pending_answer_sources` has parsed one or more reusable source entries during an `auto` probe
- and that probe still fails
- `auto` terminates with an error instead of continuing to `labeled_sections`, `question_*`, `topic_*`, or other raw-reply surfaces

## Example

Before this slice, a caller could provide:

- explicit reusable `answerSources` for `Auth strategy`, `Rollout strategy`, and `Pilot scope`
- raw `sourceResponse` text that only mentioned `Auth strategy` and `Rollout strategy`
- explicit answer consumers only for the first two decisions

`auto` could then:

- probe `matching_answer_sources`
- fall back to `pending_answer_sources`
- discover one reusable source still left over
- then still drop to `labeled_sections` and succeed from the raw reply

After this slice:

- fallback from `matching_answer_sources` to `pending_answer_sources` still works
- but once `pending_answer_sources` proves the reusable-source bundle is incomplete for this call, `auto` fails closed instead of ignoring that stronger authority and reinterpreting weaker raw reply text

## Non-Goals

- blocking fallback from `matching_answer_sources` to `pending_answer_sources`
- extending this slice to every non-answer-source family
- changing explicit non-`auto` answer-source behavior

## Acceptance Criteria

- `auto` can still fall through from `matching_answer_sources` to `pending_answer_sources`
- `auto` no longer falls from incomplete reusable-source authority into weaker raw-`sourceResponse` surfaces
- Bun API decision-answer flows expose the same fail-closed behavior
