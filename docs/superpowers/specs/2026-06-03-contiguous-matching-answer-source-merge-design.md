# Contiguous Matching Answer-Source Merge Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Strengthen explicit reusable `answerSources` authority so one already-known decision or planner-answer consumer can be assembled from more than one adjacent reusable source entry without falling back to weaker raw-reply parsing.

## Why This Slice Exists

The reusable-source substrate was already strong in two ways:

- one source entry could target one known decision or planner-answer consumer by explicit durable authority such as `decisionKey`, `answerKey`, `summaryKey`, prompt text, or stable hints
- leftover source entries could already materialize brand-new durable decisions or planner answers when they carried their own explicit authority

But one narrow gap remained:

- if one known consumer needed two adjacent reusable source entries, runtime still treated that as a duplicate-match error instead of one deterministic explicit run

That forced callers to either concatenate snippets up front or leave explicit reusable-source authority for a weaker raw parser surface. Neither is the long-term authority route.

## Constraints

- keep `matching_answer_sources` explicit and fail-closed
- do not invent a new `sourceResponseFormat`
- do not broaden fuzzy or semantic matching
- do not merge non-adjacent repeated source entries across other consumers or leftovers
- preserve existing remaining-source materialization behavior for `inferDecisionTopics` and `inferRemainingAnswers`

## Implemented Scope

### Adjacent Reusable Source Entries Now Merge

When more than one unconsumed reusable source entry matches the same known decision or known planner-answer consumer under `sourceResponseFormat: "matching_answer_sources"`, runtime now accepts that match only when every matching entry is adjacent in reusable-source order.

Those adjacent entries are consumed together and merged into one answer payload with blank-line separation.

Example:

- `source-1 -> decisionKey: "launch-sequencing" -> "Use a staged rollout."`
- `source-2 -> decisionKey: "launch-sequencing" -> "Keep the launch reversible."`

now materializes one resolved decision answer:

- `Use a staged rollout.`
- blank line
- `Keep the launch reversible.`

The same rule also applies to planner answers matched by `answerKey`, `summaryKey`, prompt text, or other existing reusable-source authority.

### Non-Adjacent Repeats Still Fail Closed

If repeated matching entries for the same consumer are separated by:

- another matched consumer
- an unmatched leftover source entry
- or any other gap in reusable-source order

runtime still raises the existing duplicate-match error instead of guessing whether those distant snippets belong to one combined answer.

That keeps reusable-source merging aligned with the existing contiguous-run policy already used elsewhere in answer interpretation.

### Remaining Source Materialization Stays Unchanged

After contiguous reusable-source entries are consumed together, any still-unconsumed entries keep the same behavior they already had:

- `inferDecisionTopics` may materialize brand-new durable decisions from explicit remaining-source authority
- `inferRemainingAnswers` may materialize planner answers from explicit remaining-source authority
- `auto` completeness still counts every consumed reusable source entry, so partially consumed answer-source surfaces remain visible

## Non-Goals

- merging non-adjacent repeated reusable source entries
- introducing a second reusable-source run store
- changing how `pending_answer_sources` works
- widening `matching_answer_sources` into a fuzzy or semantic parser
- relaxing explicit remaining-source authority requirements

## Acceptance Criteria

- `matching_answer_sources` merges adjacent reusable source entries for one known decision consumer
- `matching_answer_sources` merges adjacent reusable source entries for one known planner-answer consumer
- non-adjacent repeated reusable source entries for the same consumer still fail closed
- direct Bun API surfaces inherit the same contiguous merge behavior
- handoff documents the new reusable-source merge authority
