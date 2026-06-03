# Contiguous Remaining Matching Answer-Source Merge Design

Status: approved and implemented
Date: 2026-06-03

## Goal

Strengthen leftover `matching_answer_sources` authority so adjacent reusable source entries can materialize one brand-new durable decision topic or one inferred planner-answer row when they already share explicit key-based authority.

## Why This Slice Exists

The reusable-source substrate already had two adjacent capabilities:

- one known consumer could now merge adjacent `matching_answer_sources` entries while being matched explicitly
- leftover `matching_answer_sources` entries could already materialize new decisions or inferred planner answers one entry at a time

But one asymmetry remained:

- once entries moved from "known-consumer matching" into "leftover materialization", runtime still dropped back to one-entry-per-answer behavior

That left a gap where a caller could explicitly supply two adjacent reusable source snippets for the same new decision topic or the same inferred planner-answer row, yet runtime would either split them into duplicate outputs or force one of the snippets to carry redundant summary metadata.

The long-term authority route should let explicit reusable-source keys carry that grouping directly.

## Constraints

- keep `matching_answer_sources` explicit and fail-closed
- do not invent a new parser family
- do not broaden grouping to prompt-only or summary-only heuristics in this slice
- only merge adjacent leftover entries
- reject non-adjacent repeats of the same explicit grouping authority
- preserve existing single-entry leftover materialization behavior

## Implemented Scope

### Leftover Decision Topics Can Merge by Explicit `decisionKey` or `summaryKey`

When `inferDecisionTopics` runs on leftover `matching_answer_sources`, adjacent entries now merge into one new materialized decision topic when they share:

- explicit `decisionKey`, or
- explicit `summaryKey`

The merged answer text keeps blank-line separation between the adjacent snippets.

This means one answer-source sequence like:

- `launch-sequencing-part-1` with `decisionKey: "launch-sequencing"`
- `launch-sequencing-part-2` with `decisionKey: "launch-sequencing"`

now materializes one new decision:

- decision key `launch-sequencing`
- summary `Launch sequencing`
- answer `"Use a staged rollout.\n\nKeep the launch reversible."`

### Leftover Planner Answers Can Merge by Explicit `answerKey` or `summaryKey`

When `inferRemainingAnswers` runs on leftover `matching_answer_sources`, adjacent entries now merge into one inferred planner-answer row when they share:

- explicit `answerKey`, or
- explicit `summaryKey`

This keeps planner-side row identity aligned with the already durable `answerKey` substrate.

The merged planner answer still requires explicit summary authority somewhere in that grouped leftover entry set, just as single-entry leftover planner materialization already did.

### Metadata Merges Stay Conservative

When adjacent leftover entries are merged, runtime:

- concatenates answer text with blank lines
- reuses one explicit key-based authority group
- unions `matchHints`
- preserves explicit prompt / summary / keys only when they are compatible

If adjacent entries in the same explicit key group disagree on metadata like:

- `decisionKey`
- `answerKey`
- `summaryKey`
- `summary`
- `prompt`

runtime fails closed instead of guessing which metadata should win.

### Non-Contiguous Repeats Still Fail Closed

If the same explicit grouping authority reappears later after another leftover entry has intervened, runtime now raises an explicit error instead of silently materializing duplicate rows.

Examples:

- `decisionKey "launch-sequencing"` left over, then another leftover entry, then `decisionKey "launch-sequencing"` again
- `answerKey "rollback-trigger"` left over, then another leftover entry, then `answerKey "rollback-trigger"` again

Both remain invalid in this slice.

## Non-Goals

- merging leftover `pending_answer_sources`
- grouping by prompt-only or summary-only authority
- fuzzy regrouping across separated reusable source entries
- relaxing explicit summary authority requirements for inferred planner answers
- changing how known-consumer matching works

## Acceptance Criteria

- leftover `matching_answer_sources` can merge adjacent entries into one new decision topic when they share explicit `decisionKey` or `summaryKey`
- leftover `matching_answer_sources` can merge adjacent entries into one inferred planner-answer row when they share explicit `answerKey` or `summaryKey`
- grouped leftover entries preserve explicit metadata only when it is compatible
- non-contiguous repeats of the same explicit leftover grouping authority fail closed
- direct Bun API surfaces inherit the same grouped leftover materialization behavior
