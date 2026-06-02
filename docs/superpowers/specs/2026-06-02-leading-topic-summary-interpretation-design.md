# Leading Topic Summary Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let topic-surface answer interpretation infer durable decision-topic summaries and planner-answer summaries from leading topic phrases like `Pilot scope should ...` or `Rollback trigger is ...`, instead of only from narrower trailing forms like `... for pilot scope`.

## Why This Slice Exists

The current topic-surface interpretation path already supported:

- `topic_sentences`
- `topic_paragraphs`
- `topic_blocks`

and it could already reuse known decisions when the topic appeared explicitly in the sentence or paragraph.

But for remaining unclaimed items that needed to become:

- brand-new durable decision topics through `inferDecisionTopics`
- inferred planner answers through `followThrough.inferRemainingAnswers`

the summary extractor was still too narrow:

- it mostly depended on trailing `for <summary>` phrasing
- topic-block fallback anchor inference also depended on that same narrow trailing shape
- more natural leading forms like `Auth strategy should ...` or `Pilot scope should ...` could still be visible to humans, yet remain unusable as durable summary authority

## Constraints

- keep the shared interpreter deterministic
- reuse the existing topic-surface authority instead of adding a second freeform NLP path
- avoid fuzzy semantic summary inference
- preserve current trailing-summary behavior and known-topic matching

## Implemented Scope

### Shared Leading Topic-Phrase Extraction

The shared interpreter now extracts summary candidates from leading topic phrases before a constrained verbal clause, such as:

- `Auth strategy should ...`
- `Rollout strategy is ...`
- `Pilot scope starts ...`

This uses one shared deterministic verbal pattern instead of a new semantic model.

Guardrails stay narrow:

- obvious pronoun or article-leading labels are rejected
- implausibly long leading phrases are rejected
- if one sentence implies more than one distinct topic summary, runtime fails deterministically instead of guessing

### Topic Sentence And Paragraph Summary Inference

`topic_sentences` and `topic_paragraphs` now reuse that shared extractor when materializing:

- remaining inferred decision topics
- remaining inferred planner answers

So `Pilot scope should start with five enterprise customers.` can now yield:

- summary: `Pilot scope`
- answer: the original sentence or paragraph

without requiring `... for pilot scope`.

### Topic Block Anchor Inference

`topic_blocks` now reuse the same leading-topic extractor for fallback anchor detection.

That means a block can now start with:

- `Auth strategy should use Bun-native auth.`

and still become a stable topic block even when there is no trailing `for auth strategy` anchor and no earlier explicit candidate label for that block.

This directly strengthens both:

- `inferDecisionTopics`
- `followThrough.inferRemainingAnswers`

on topic-block replies.

### Product Path Coverage

Because the change lives in the shared interpreter, the active Bun API and Goal assistant surfaces both inherit it automatically for:

- `record_answers`
- `record_answer`
- `resolve_decision`

wherever those actions already route through topic-surface interpretation.

## Non-Goals

- fuzzy topic inference from fully generic prose like `We should do this first.`
- removing the need for any visible topic-bearing sentence or paragraph at all
- semantic clustering across multiple unrelated freeform paragraphs
- synonym expansion beyond the existing deterministic candidate and prompt matching rules

## Acceptance Criteria

- `topic_sentences` can infer new durable decision topics from leading topic phrases without trailing `for <summary>` wording
- `topic_paragraphs` inherit the same leading-topic summary inference
- `topic_blocks` can infer remaining planner answers and new durable decision topics from leading-topic anchor paragraphs
- Bun API and Goal assistant both inherit the new behavior through the shared interpreter
