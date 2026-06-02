# Auto Label Surface Fail-Closed Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Strengthen `sourceResponseFormat: "auto"` so explicit label-shaped replies do not get reinterpreted by weaker later surfaces after label-based interpretation has already established durable authority.

## Why This Slice Exists

The earlier `auto` completeness slice taught runtime to reject partially successful unit-based candidates and keep searching for a later surface that fully captured the reply.

That still left one authority gap:

- a higher-priority label-shaped surface like `labeled_sections` or `inline_topics` could partially match the reply
- `auto` could reject that partial match for incompleteness
- then a later topic/question surface could reinterpret the same raw text differently
- in the worst case, that later surface could "fully capture" the reply only by swallowing an unclaimed label into the wrong already-known consumer

When a reply already establishes explicit label authority, the long-term authority route should fail closed instead of dropping to a weaker reinterpretation path.

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a second parsed-response store
- do not add fuzzy or semantic matching
- do not invent a new parser family
- keep explicit concrete `sourceResponseFormat` stronger than `auto`

## Implemented Scope

### Durable Consumption Tracking For Label Surfaces

Shared interpretation state now records consumed label authority for:

- `labeled_sections`
- `inline_topics`

The runtime records label consumption when:

- explicit decision answers consume a labeled or inline-topic entry
- `inferOpenDecisions` reuses a labeled or inline-topic entry for one current open decision
- `inferDecisionTopics` materializes one remaining labeled or inline-topic entry into a brand-new durable decision topic

This lets `auto` measure whether a label surface actually consumed all label authority it parsed.

### Auto Completeness For Label Surfaces

`auto` now runs the same completeness check on:

- `labeled_sections`
- `inline_topics`

That means:

- `labeled_sections` is rejected if parsed labels remain unconsumed
- `inline_topics` is rejected if parsed labels remain unconsumed

### Fail-Closed Label Authority

Once a label surface has established explicit label authority, `auto` no longer falls through to weaker later surfaces for that reply.

Current rule:

- `labeled_sections` is fail-closed once it has parsed at least one explicit labeled section
- `inline_topics` is fail-closed once it has parsed more than one explicit inline-topic section

The inline-topic threshold intentionally stays narrower than labeled sections in this slice. A single broad verbal inline-topic parse is still allowed to fall through, so existing `matching_runs` and question/topic auto paths do not get accidentally shadowed by one overly broad inline-topic clause.

## Example

Before this slice, a reply like:

`Auth strategy: Use Bun-native auth`
`Rollout strategy: Use a staged rollout`
`Pilot scope: Start with five enterprise customers before broader launch.`

could let `auto` reject `labeled_sections` for leaving `Pilot scope` unused, then drop to a weaker topic surface that merged the `Pilot scope` text into the `Rollout strategy` answer.

After this slice:

- `labeled_sections` is still rejected for incompleteness
- but because explicit label authority already exists, `auto` fails closed instead of reinterpreting the reply through weaker later surfaces

## Non-Goals

- extending fail-closed semantics to every other interpretation family
- broadening `inline_topics` to terminate on every single successful parse
- changing explicit non-`auto` label-surface semantics

## Acceptance Criteria

- decision-backed `auto` interpretation fails closed when `labeled_sections` parses explicit labels but leaves some labels unconsumed
- Bun API surfaces expose that same fail-closed behavior
- `auto` still allows one broad `inline_topics` parse to fall through when that surface has not established clear multi-label authority
- `inferDecisionTopics` can still let `auto` accept `labeled_sections` once those remaining labels are fully consumed
