# Named Answer Source Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let answer-driven assistant and Bun API actions carry a small explicit bundle of reusable extracted answer snippets, so more than one durable decision topic or planner answer can reference those snippets by stable key instead of either repeating the same text everywhere or collapsing everything to one shared raw `sourceResponse`.

## Why This Slice Exists

The current system already supported:

- explicit per-item `answer` when assistant wanted topic-specific extracted text
- one shared raw `sourceResponse` reused across more than one decision topic and follow-through answer
- mixed decision and non-decision answer-driven follow-through on the same durable planner workflow

That still left one authority gap:

- one less-structured user reply often contains more than one reusable durable fact
- if assistant wanted topic-specific extracted snippets, it still had to repeat those snippets on every decision answer and planner answer entry
- if assistant wanted to avoid repetition, the only existing fallback was to reuse the entire raw `sourceResponse`, which lost the distinction between separate extracted answers inside that reply

## Constraints

- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- do not add a durable answer-source registry or second raw-response store
- preserve both existing explicit per-item `answer` and shared `sourceResponse`
- keep invalid interpretation payloads deterministic and reject them clearly

## Implemented Scope

### Root `answerSources` On Answer-Driven Surfaces

Answer-driven assistant actions and Bun API routes now support root:

- `answerSources: [{ answerSourceKey, answer }]`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

These sources are ephemeral interpretation input only. Runtime materializes them into existing durable decision answers and planning-request answers before touching the authoritative stores.

### Per-Item `answerSourceKey`

Decision-answer entries and interpretable planner-answer entries now support:

- `answerSourceKey`

That lets one action explicitly say:

- which reusable extracted answer snippet belongs to which durable decision topic
- which reusable extracted answer snippet should stay only on planner follow-through

without repeating the same snippet text on every item.

### Deterministic Resolution Order

Runtime now resolves answer text in this order:

1. item `answer`
2. item `answerSourceKey`
3. root `sourceResponse`

This keeps the most explicit per-item value authoritative while still allowing:

- reusable extracted snippets through `answerSources`
- whole-reply fallback through `sourceResponse`

### Deterministic Validation

Runtime now rejects invalid answer-source interpretation payloads deterministically when:

- an item references an unknown `answerSourceKey`
- the root `answerSources` bundle repeats the same `answerSourceKey`
- an item has none of `answer`, `answerSourceKey`, or root `sourceResponse`

These failures surface as input errors rather than partial writes or generic system failures.

## Non-Goals

- automatic NLP extraction of snippets from one raw reply
- inferring durable decision topics without assistant naming them
- persisting `answerSources` as a second durable store
- replacing explicit per-item `answer` when callers already know the exact final text they want to store

## Acceptance Criteria

- answer-driven assistant and Bun API actions can define reusable named answer sources once and reference them across more than one decision answer or follow-through answer
- `record_answer`, `record_answers`, and `resolve_decision` all support the same answer-source interpretation model
- unknown or duplicate `answerSourceKey` values fail deterministically
- existing explicit `answer` and shared `sourceResponse` paths continue to work
