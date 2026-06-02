# 2026-06-02 Inferred Topic Prompt Synthesis Design

## Goal

When runtime infers brand-new durable decision topics or brand-new planner captured answers from topic-shaped source responses, persist a canonical durable `prompt` automatically instead of leaving those artifacts with only a summary.

## Why

Today question-shaped reply surfaces already preserve exact question text as durable `prompt` authority, but topic-shaped reply surfaces usually only leave behind:

- a short inferred `summary`
- the captured `answer`

That weakens later answer interpretation:

- later question-shaped replies cannot reuse an exact durable question because none was persisted
- runtime falls back to summaries, prompt-keyword reuse, or explicit `matchHints` sooner than necessary

The long-term authority path is to preserve one canonical question surface as early as possible, not to keep widening parser heuristics.

## Decision

For inferred topic-backed materialization, runtime now synthesizes a canonical prompt from the inferred summary:

- `Auth strategy` -> `What should the auth strategy be?`
- `Pilot scope` -> `What should the pilot scope be?`
- `Rollback trigger` -> `What should the rollback trigger be?`

This applies only where runtime is already inferring a topic summary and no stronger question authority exists.

## Scope

### Inferred Durable Decision Topics

When `inferDecisionTopics` materializes a brand-new durable decision topic from:

- `labeled_sections`
- `inline_topics`
- `topic_sentences`
- `topic_spans`
- `topic_closing_spans`
- `topic_closing_blocks`
- `topic_paragraphs`
- `topic_blocks`

the shared interpreter now also synthesizes `prompt`.

Question-shaped formats keep using the actual matched question text instead of a synthesized prompt.

Existing known decisions are not force-upgraded here if runtime reused them by key/summary and no stronger prompt was already available.

### Inferred Planner Answers

When `followThrough.inferRemainingAnswers` materializes planner captured answers from:

- `topic_sentences`
- `topic_spans`
- `topic_closing_spans`
- `topic_closing_blocks`
- `topic_paragraphs`
- `topic_blocks`

the shared interpreter now also synthesizes `prompt`.

Question-shaped formats keep using the original matched question text.

## Consequences

- topic-backed inferred durable artifacts now gain the same later question-reuse authority that question-backed artifacts already had
- later answer interpretation can stay deterministic while leaning less often on summaries or explicit `matchHints`
- no new durable store is introduced
- no fuzzy NLP or synonym expansion is introduced

## Non-Goals

- synthesizing prompts for arbitrary explicit summaries such as `Choose the auth strategy`
- rewriting existing persisted prompts
- adding a second alias or ontology store
- expanding parser interpretation to looser non-deterministic natural language
