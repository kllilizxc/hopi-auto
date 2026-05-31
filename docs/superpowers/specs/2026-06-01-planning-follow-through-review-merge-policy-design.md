# Planning Follow-Through Review/Merge Policy Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Strengthen planning-task review and merge behavior so it verifies durable follow-through against open planning requests, planning write traces, and prior run evidence instead of relying on planner success alone.

## Why This Slice Exists

Earlier slices already gave HOPI:

- durable `planning-requests.yml`
- planner prompt policy for open planning requests
- engineering reviewer/merger evidence policy for run history, artifacts, transcript summaries, and write traces

What was still missing was parity for planning tasks:

- planning reviewer and merger did not receive planning-request inputs
- no explicit gap surfaced when planning work reached review/merge without durable planning write traces
- reviewer/merger prompt policy was still engineering-specific

That left planning follow-through under-enforced compared with engineering evidence.

## Constraints

- planning review/merge still relies on explicit context and prompt policy, not hidden status mutation
- workflow truth remains `todo.yml`
- planning evidence should stay grounded in existing durable files and runtime overlay rather than a new store

## Implemented Scope

### Planning Inputs For Planning Review/Merge

Planning tasks now receive the same durable planning input surface across planner, reviewer, and merger:

- current `todo.yml`
- `decisions.yml`
- `planning-requests.yml`
- `.hopi/preference.md`
- relevant open planning requests linked to the task

### Planning Evidence Gaps

For planning reviewer/merger steps with no relevant write traces, context now renders:

- `No durable planning write traces were recorded yet for this task.`

Reviewer/merger also continue to receive explicit run-evidence gaps when no prior run-history evidence exists.

### Planning Role Policy

Prompt policy now explicitly tells:

- planning reviewer to verify durable follow-through against open planning requests before accepting
- planning merger to inspect durable planning evidence before returning success
- both roles to avoid blind acceptance when durable planning evidence is missing or inconsistent

## Non-Goals

- deterministic auto-rejection solely from missing planning evidence
- new planning-only runtime stores
- planner direct mutation of review/merge policy files

## Acceptance Criteria

- planning reviewer and merger receive planning-request inputs in context bundles
- planning reviewer/merger contexts explicitly surface missing planning write-trace gaps
- planning reviewer and merger prompts contain explicit durable follow-through evidence policy
