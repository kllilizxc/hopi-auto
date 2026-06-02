# Question Middle Anchor Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one question-driven reply deterministically feed durable decision answers, inferred decision topics, and planner follow-through answers when each answer keeps one explicit question sentence or paragraph in the middle, with leading and trailing answer units around it.

## Why This Slice Exists

The current system already supported:

- front-anchored question surfaces through `question_blocks` and `question_spans`
- closing-anchored question surfaces through `question_closing_spans` and `question_closing_blocks`

That still left one deterministic gap:

- a user can start answering before restating the question
- restate the durable question in the middle of the answer stretch
- continue answering after that question
- and pack adjacent answers into the same reply

This was still explicit question authority, not fuzzy inference.

## Constraints

- keep interpretation deterministic
- reuse the current question-surface substrate instead of inventing a second durable store
- preserve existing `question_blocks`, `question_spans`, `question_closing_spans`, and `question_closing_blocks` behavior
- preserve original question text as durable `prompt` authority whenever runtime materializes planner answers or brand-new decision topics

## Implemented Scope

### New Root `sourceResponseFormat` Values

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "question_middle_spans"`
- `sourceResponseFormat: "question_middle_blocks"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Middle-Anchor Shapes

Question-middle-span replies are interpreted as sentence streams such as:

- `Keep the runtime simple.`
- `Auth strategy?`
- `Use Bun-native auth.`
- `Launch in phases.`
- `Rollout strategy?`
- `Use a staged rollout.`

Question-middle-block replies are interpreted as blank-line-separated paragraph streams with the same shape.

Each answer stretch contains:

- at least one leading answer sentence or paragraph before the question anchor
- exactly one question sentence or paragraph that names the durable topic
- at least one trailing answer sentence or paragraph after that question anchor

### Deterministic Middle-Anchor Splitting

Runtime now parses middle-anchor question replies by:

- splitting the reply into sentences for `question_middle_spans`
- splitting the reply into blank-line paragraphs for `question_middle_blocks`
- detecting question anchors with the same question matching used by existing question surfaces
- requiring at least one leading unit before the first question anchor
- requiring at least one trailing unit after the last question anchor
- when a later question anchor appears, assigning the immediately preceding unit to the next answer stretch as its leading answer unit
- assigning any earlier post-anchor units to the current answer stretch as trailing answer units

This keeps adjacent middle-anchored question answers deterministic without regrouping or guessing.

### Shared Reuse Across Existing Surfaces

Once parsed, the same middle-anchor question surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `inferDecisionTopics`
- `followThrough.answers`
- `followThrough.inferRemainingAnswers`

Question-derived planner answers and inferred decision topics continue to preserve the matched question text as durable `prompt` authority automatically.

### Deterministic Validation

Runtime now rejects middle-anchor question interpretation deterministically when:

- `sourceResponseFormat` is `question_middle_spans` or `question_middle_blocks` but `sourceResponse` is missing
- the reply starts with a question anchor and therefore has no leading answer unit
- the reply ends immediately after a question anchor and therefore has no trailing answer unit
- adjacent question anchors do not leave both one trailing unit for the current answer and one leading unit for the next answer
- a requested explicit or open decision has no matching middle-anchored question stretch
- more than one middle-anchored question stretch matches the same requested decision

## Non-Goals

- inferring decision topics from prose that never contains an explicit question anchor
- fuzzy regrouping across discontinuous answer stretches
- replacing front-anchor or closing-anchor question surfaces when those formats already fit the reply
- synthesizing new shorter answers from matched stretches

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one middle-anchored question reply without forcing the question sentence or paragraph to appear first or last
- current open decisions can be resolved from middle-anchored question replies without per-topic mapping
- remaining middle-anchored question replies can become new durable decision topics
- planner follow-through can consume the remaining middle-anchored question stretch from the same shared reply
- ambiguous adjacent question anchors fail deterministically instead of being guessed
