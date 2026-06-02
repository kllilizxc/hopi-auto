# 2026-06-02 Summary Prompt Synthesis Design

## Goal

When assistant or API creates durable decision topics or durable planner answers without an explicit `prompt`, synthesize one canonical question from the stable summary instead of leaving the durable artifact prompt-less.

## Why

The current system already treats durable `prompt` as the strongest reusable answer-interpretation authority.

That authority is currently strong when:

- callers explicitly provide `prompt`
- question-shaped source responses preserve real question text
- some inferred topic-shaped responses now synthesize prompt during materialization

But many durable artifacts are still created from stable summaries alone:

- `request_decision` with `summary: "Choose the auth strategy"`
- `record_answer` / `record_answers` with summary-only explicit entries
- captured planner answers like `Pilot scope`

Leaving those prompt-less forces later replies to fall back to weaker surfaces such as summary matching, prompt-keyword anchors, or explicit `matchHints` earlier than necessary.

## Decision

Introduce one shared deterministic helper that synthesizes a canonical prompt from a stable summary when no explicit prompt exists.

The same helper also defines upgrade authority:

- explicit incoming `prompt` always wins when there is no current prompt yet
- a later explicit `prompt` may replace an earlier synthesized default
- a richer existing explicit `prompt` is never downgraded back to the synthesized default

Examples:

- `Choose the auth strategy` -> `What should the auth strategy be?`
- `Auth strategy` -> `What should the auth strategy be?`
- `Pilot scope` -> `What should the pilot scope be?`
- `Rollback trigger` -> `What should the rollback trigger be?`

This is deliberately narrower than fuzzy NLP:

- only a small set of imperative prefixes is stripped
- only short summary-shaped phrases are accepted
- question-like or sentence-like summaries that do not fit the deterministic shape remain unsynthesized

## Scope

### Durable Decisions

On decision create / enrich / resolve:

- keep a richer existing explicit `prompt` unchanged when present
- synthesize `prompt` from `summary` when no explicit prompt exists and the summary fits the deterministic helper
- if only a synthesized default exists and a later explicit `prompt` arrives, upgrade to that explicit prompt

This also lets later mutations backfill legacy decisions that still lack prompt.

### Durable Planner Answers

When planning-request answers are created or merged:

- keep a richer existing explicit `prompt` unchanged when present
- synthesize `prompt` from `summary` when no explicit prompt exists and the summary fits the deterministic helper
- if only a synthesized default exists and a later explicit `prompt` arrives, upgrade to that explicit prompt

This applies to:

- direct planning request answers
- grouped planning answers
- workflow-root shared answers
- child workflow answers

## Non-Goals

- synthesizing prompts from arbitrary long prose
- rewriting existing explicit prompts
- introducing a second alias store
- adding fuzzy or semantic summary interpretation
