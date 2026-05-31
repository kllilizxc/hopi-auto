# Write-Trace-Aware Review And Merge Policy Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Push durable `write-trace.jsonl` beyond passive context attachment by making reviewer and merger prompts explicitly trace-aware, including evidence-gap guidance when engineering work lacks durable file-write evidence.

## Why This Slice Exists

The earlier write-trace slices already added:

- durable `write-trace.jsonl`
- filtered trace reads
- API/UI surfacing
- generic inclusion of relevant traces in role context bundles

What was still missing was deeper policy:

- reviewer prompts did not explicitly treat write traces as execution evidence
- merger prompts did not explicitly warn against blind success when evidence was missing
- empty trace sets for engineering review/merge steps were silent instead of being surfaced as a meaningful gap

## Constraints

- `write-trace.jsonl` remains audit/evidence, not workflow truth
- scheduler semantics stay unchanged
- reviewer and merger behavior should be strengthened through deterministic prompt/context policy, not by introducing hidden orchestration state

## Implemented Scope

### Structured Trace Rendering

Relevant traces in role context bundles now render both:

- the high-level trace summary
- explicit changed-file summaries

This makes the evidence more usable than the old single-line target-path list.

### Evidence-Gap Surfacing

For engineering `reviewer` and `merger` steps with no relevant earlier traces, the context bundle now renders an explicit evidence-gap note instead of omitting the section entirely.

### Role-Specific Prompt Policy

Reviewer prompts now explicitly state:

- use write traces as execution evidence
- prefer `reject` or `fail` over blind acceptance when traces are missing or inconsistent

Merger prompts now explicitly state:

- inspect relevant write traces before returning success
- do not return success blindly when engineering trace evidence is missing

## Non-Goals

- changing scheduler truth or task statuses directly from trace presence alone
- artifact/run-history correlation beyond the current trace-focused slice
- generalized policy engines or scoring systems

## Acceptance Criteria

- reviewer prompts explicitly reference durable write traces as execution evidence
- merger prompts explicitly warn against blind success without engineering write-trace evidence
- engineering review/merge contexts surface trace gaps when none exist
- write traces remain evidence inputs rather than workflow truth
