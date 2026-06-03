# Topic Unit Ambiguity Fail-Closed Design

## Problem

`topic_clauses`, `topic_sentences`, and `topic_paragraphs` could still over-consume one reply unit after a known decision or explicit planner answer matched it.

That was especially bad when the same clause, sentence, or paragraph also implied another topic summary that should have remained available for:

- `inferDecisionTopics`
- `followThrough.inferRemainingAnswers`

The stronger anchor families (`topic_*spans`, `topic_*blocks`) had a similar issue one layer earlier: a single anchor unit could mention more than one implied topic, but runtime still treated it as one anchor.

## Design

### 1. Anchor units fail closed on multiple inferred summaries

For `topic_spans`, `topic_middle_spans`, `topic_closing_spans`, `topic_closing_blocks`, `topic_middle_blocks`, and `topic_blocks`:

- explicit candidate matching still decides whether a unit can anchor a known consumer
- inferred topic summaries are used only to detect ambiguity, not to override the matched consumer
- if one anchor unit implies more than one inferred topic summary, parsing fails closed

### 2. Topic unit matching gets the same ambiguity guard when leftover inference is enabled

For `topic_clauses`, `topic_sentences`, and `topic_paragraphs`:

- normal explicit matching behavior stays the same when no leftover inference is requested
- when the caller still needs leftover inference (`inferDecisionTopics` or `inferRemainingAnswers`), a matched unit is rejected if it implies more than one inferred topic summary

This prevents one explicit decision answer or planner answer from silently swallowing another topic that should have remained materializable.

### 3. Topic-summary extraction for anchor disambiguation becomes conjunction-aware

Anchor disambiguation now prefers summary extraction from conjunction-split segments when a unit contains explicit `and` / `then` style chaining.

This keeps the ambiguity detector narrow:

- `Use Bun-native auth for auth strategy and use a staged rollout for rollout strategy.` now yields two summaries
- ordinary single-topic sentences still stay on the previous path

### 4. Leading pronoun false positives are rejected

Leading-summary extraction now rejects `we` as a topic-summary token.

That prevents sentences like `We should use Bun-native auth ...` from manufacturing a bogus summary such as `We`.

## Boundaries

- This does not add any new raw-reply parser family.
- This does not widen brand-new topic inference to fuzzier natural language.
- This does not change question-family parsing.
- This does not make candidate matching depend on inferred summary equality; inferred summaries only act as an ambiguity guard.

## Expected Outcome

The authority path gets stricter in the right place:

- explicit topic-unit matches remain usable
- ambiguous multi-topic units now fail closed instead of over-consuming reply text
- `auto` can no longer silently succeed by falling into a topic unit that already swallowed another inferable topic
