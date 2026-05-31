# Run-History And Artifact-Aware Review/Merge Policy Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Strengthen reviewer and merger judgment by correlating prior run history, artifact refs, transcript evidence, and durable write traces inside runtime context bundles.

## Why This Slice Exists

The earlier trace-aware slice already made reviewer and merger prompts care about durable write traces. That was a useful step, but it was still incomplete:

- reviewer and merger could see write traces, but not the prior step artifacts that the runtime had already recorded
- transcript evidence such as tool calls and execution summaries stayed isolated in run history instead of informing later review/merge steps
- evidence-gap handling only covered missing write traces, not missing run-history evidence

That left too much runtime evidence siloed away from the review and merge decision boundary.

## Constraints

- run history remains runtime overlay, not workflow truth
- artifacts and transcript summaries remain evidence inputs, not automatic status drivers
- the solution should reuse existing run-history storage instead of inventing a second execution-evidence store

## Implemented Scope

### Relevant Run Evidence Rendering

Reviewer and merger context bundles now render a `Relevant Run Evidence` section for engineering tasks.

This section can include:

- prior step role and outcome
- artifact refs and labels
- transcript summaries
- prepared worktree path when recorded

The current step is excluded, and the section focuses on the same task's prior evidence.

### Evidence-Gap Surfacing

When engineering review/merge work has no prior run-history evidence, the context bundle now renders an explicit gap note instead of silently omitting that surface.

### Role Policy Upgrade

Prompt policy now tells:

- reviewer to correlate prior run history and artifact refs with the claimed work before accepting
- merger to inspect prior run history and artifact evidence before returning success

Existing write-trace policy remains in place, so the reviewer/merger evidence surface is now cumulative rather than replaced.

## Non-Goals

- changing scheduler decisions automatically from transcript or artifact presence alone
- adding generalized evidence scoring
- surfacing full raw run-history dumps in the prompt

## Acceptance Criteria

- reviewer and merger context bundles include prior run evidence when it exists
- engineering review/merge contexts surface an explicit gap when no prior run evidence exists
- reviewer prompt policy references prior run history and artifacts in addition to write traces
- merger prompt policy references prior run history and artifacts in addition to write traces
