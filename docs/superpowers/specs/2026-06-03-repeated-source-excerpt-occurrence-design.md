# Repeated Source-Excerpt Occurrence Authority

## Goal

Strengthen explicit excerpt grounding so one shared `sourceResponse` can safely contain the same exact excerpt text more than once without runtime silently choosing the first match.

## Why

Before this slice, excerpt grounding only enforced:

- `sourceResponse` exists
- `sourceExcerpt` appears somewhere inside it

That was enough for unique excerpts, but it stayed ambiguous for repeated text:

- direct item `sourceExcerpt`
- reusable `answerSources[*].sourceExcerpt`

Both would silently resolve to the first matching occurrence even when the same exact text appeared more than once. That is weaker than the rest of the authority route.

## Required Behavior

### Ambiguous repeated excerpts

If one exact `sourceExcerpt` appears more than once inside the same shared `sourceResponse`:

- runtime must reject the mutation by default
- callers must provide explicit `sourceOccurrence`

`sourceOccurrence` is:

- 1-based
- exact-excerpt-specific
- used only to disambiguate repeated occurrences of that same `sourceExcerpt`

### Direct item excerpts

Direct decision or planner answers that use:

- `sourceExcerpt`

must now fail closed when that excerpt appears multiple times unless the same item also carries:

- `sourceOccurrence`

### Reusable answer-source excerpts

Reusable `answerSources[*]` entries that use:

- `sourceExcerpt`

must now fail closed when that excerpt appears multiple times unless that same reusable source entry also carries:

- `sourceOccurrence`

### Out-of-range occurrences

If a caller provides `sourceOccurrence` greater than the number of exact excerpt matches, runtime must reject the mutation.

## Non-Goals

This slice does not:

- introduce fuzzy excerpt matching
- change the excerpt payload itself; grounded answers still materialize as the exact excerpt text
- require callers to provide `sourceOccurrence` for unique excerpts

## Verification

- Runtime tests cover ambiguous repeated excerpts for direct items and reusable answer sources.
- Runtime tests cover out-of-range `sourceOccurrence`.
- Runtime tests cover successful repeated-excerpt disambiguation.
- API tests cover the same fail-closed and success paths through real HTTP mutation surfaces.
