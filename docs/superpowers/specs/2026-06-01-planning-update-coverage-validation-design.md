# Planning Update Coverage Validation Design

Status: approved and implemented
Date: 2026-06-01

## Goal

Turn requested planning follow-through targets into deterministic runtime checks, so planning work cannot silently complete when durable evidence for requested `design.md` or `todo.yml` updates is missing.

## Why This Slice Exists

The previous slice made planning follow-through requests richer:

- `planning-requests.yml` can carry `decisionRefs`
- `planning-requests.yml` can carry `requestedUpdates`
- planner context and Bun UI can inspect those fields

But that still left one important gap:

- requested update targets were only visible guidance
- reviewer and merger policy depended on prompt compliance alone
- runtime could still mark planning work complete even if no durable evidence showed the requested files changed

That was weaker than the long-term deterministic core should allow.

## Constraints

- `todo.yml` remains the only workflow truth
- no new queue, background service, or hidden planner overlay
- validation must reuse existing file-native evidence: `planning-requests.yml` and `write-trace.jsonl`
- planning tasks without explicit `requestedUpdates` must continue to behave as before

## Implemented Scope

### Shared Planning Follow-Through Coverage Helper

Add one shared runtime helper that combines:

- open planning requests linked to the current task
- durable write traces linked to that same task

It computes:

- requested update targets
- observed update targets
- missing update targets
- merged decision lineage for the relevant requests

This helper is reused by both prompt/context rendering and scheduler validation so the system has one deterministic interpretation of planning follow-through evidence.

### Context-Level Coverage Surfacing

Planning role contexts now render explicit requested-update coverage, including:

- the requested durable targets
- which targets already appear in durable traces
- which requested targets are still missing

This gives planner, reviewer, and merger a shared inspection view instead of relying on implicit trace reading.

### Scheduler Hard Guard

When planning reviewer or planning merger returns `success`, runtime now checks requested update coverage before allowing progress:

- if all requested targets are covered, the task continues normally
- if requested targets are missing, the task is returned to `planned` through the existing retry/budget path
- if the same gap repeats until the budget is exhausted, runtime writes an `intervention` blocker

This keeps the retry model simple while making requested planning follow-through enforceable.

## Non-Goals

- validating arbitrary semantic quality of `design.md` or `todo.yml`
- forcing every planning task to update durable docs when no explicit requested targets exist
- introducing per-file hashes, diff snapshots, or a second verification database
- replacing reviewer and merger prompts with fully automatic planner evaluation

## Acceptance Criteria

- one shared helper computes requested, observed, and missing planning update coverage
- planning contexts surface that coverage deterministically
- planning reviewer or merger success cannot advance work when explicit requested targets lack durable trace evidence
- repeated coverage failures reuse the existing retry/budget model and eventually surface as intervention blockers
- planning work with no explicit requested targets remains unchanged
