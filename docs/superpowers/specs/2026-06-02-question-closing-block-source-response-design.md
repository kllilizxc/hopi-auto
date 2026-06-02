# Question Closing Block Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one answer-first multi-paragraph shared reply deterministically feed durable decision answers, inferred decision topics, and planner follow-through answers when each answer ends with one question paragraph and the earlier paragraphs in that same block stay on that question.

## Why This Slice Exists

The current system already supported:

- question-anchored paragraph blocks through `question_blocks`
- question-anchored inline spans through `question_spans`
- answer-first inline question surfaces through `question_closing_spans`
- topic-closing paragraph blocks through `topic_closing_blocks`

That still left one real deterministic gap:

- a user reply can explain one answer across more than one paragraph first
- the explicit question paragraph can come at the end of that explanation instead of the beginning
- the next answer can then begin in a later paragraph after that closing question paragraph
- but there may still be no front-loaded question anchor

The missing surface was not fuzzy inference. It was deterministic question authority from answer-first paragraph blocks whose final paragraph is the question.

## Constraints

- keep the interpreter deterministic
- reuse the current question-surface substrate instead of adding a second block store
- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- preserve existing `question_blocks`, `question_spans`, `question_closing_spans`, and prompt-grounded question matching behavior

## Implemented Scope

### Root `sourceResponseFormat: "question_closing_blocks"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "question_closing_blocks"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Block Shape

Question-closing-block replies are interpreted as paragraph streams such as:

- `Use Bun-native auth.`
- `That keeps the runtime simple.`
- `Auth strategy?`
- `Use a staged rollout.`
- `That keeps the launch reversible.`
- `Rollout strategy?`

where paragraphs are separated by blank lines and a new durable block closes whenever one paragraph ends with `?`.

The block for a question contains:

- every non-question paragraph since the previous closing question paragraph
- the current question paragraph that names the durable topic
- stopping immediately after that closing question paragraph

The durable answer text is the joined answer paragraphs only. The closing question paragraph itself is preserved as durable `prompt`, not copied into `answer`.

### Deterministic Closing-Question Matching

Runtime now parses question-closing-block replies by:

- splitting the reply into paragraphs
- accumulating non-question answer paragraphs until one paragraph ends with `?`
- closing the current block on that question paragraph
- matching requested durable topics against the normalized closing question text
- returning the collected answer paragraphs as the durable answer text

Because each block still closes on one explicit question paragraph, this slice remains deterministic and does not depend on fuzzy extraction.

### Shared Reuse Across Existing Surfaces

Once parsed, the same question-closing-block surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `inferDecisionTopics`
- `followThrough.answers`
- `followThrough.inferRemainingAnswers`

That means one reply with:

- one auth explanation closed by an auth question paragraph
- one rollout explanation closed by a rollout question paragraph
- one pilot-scope explanation closed by a pilot-scope question paragraph

can resolve known auth and rollout decisions while preserving the remaining pilot answer block on planner follow-through, or create brand-new durable auth and rollout decision topics from the remaining blocks.

### Prompt-Grounded Reuse

Question-closing blocks reuse the same deterministic question-matching authority as the existing question surfaces:

- exact durable `prompt` text
- deterministic prompt-core matching
- deterministic prompt-keyword anchor matching

This lets current open decisions and planner captured answers match a closing question paragraph even when the shorter summary is not repeated verbatim.

### Deterministic Validation

Runtime now rejects question-closing-block interpretation deterministically when:

- `sourceResponseFormat` is `question_closing_blocks` but `sourceResponse` is missing
- a closing question paragraph appears before any answer paragraph
- the reply ends with leftover answer paragraphs that were never closed by a question paragraph
- a requested explicit or open decision topic has no matching closing question block
- more than one closing question block matches the same requested topic
- more than one existing known decision matches one inferred remaining closing question block

## Non-Goals

- inferring topics from answer paragraphs that have no closing question paragraph
- semantic regrouping across non-contiguous paragraphs
- paraphrasing matched blocks into shorter synthetic answers
- replacing `question_blocks` where front-loaded question paragraphs already exist

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one question-closing-block reply without requiring the question paragraph to appear first
- current open decisions can be resolved from question-closing blocks without per-topic mapping
- remaining question-closing blocks can become new durable decision topics
- planner follow-through can consume the remaining question-closing block from the same shared reply
- missing or multiply matched question-closing blocks fail deterministically
