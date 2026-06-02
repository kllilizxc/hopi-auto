# Question Closing Span Source Response Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let one inline answer-first shared reply deterministically feed durable decision answers, inferred decision topics, and planner follow-through answers when each answer ends with one question sentence and the earlier sentences in that same span stay on that question.

## Why This Slice Exists

The current system already supported:

- question-anchored paragraph blocks through `question_blocks`
- question-anchored inline spans through `question_spans`
- topic-closing inline spans through `topic_closing_spans`

That still left one real deterministic gap:

- a user reply can explain one answer first
- the explicit question sentence can come at the end of that explanation instead of the beginning
- the next answer can then begin immediately after that closing question sentence
- but there may still be no blank-line paragraph boundary and no front-loaded question anchor

The missing surface was not fuzzy inference. It was deterministic question authority from answer-first spans whose final sentence is the question.

## Constraints

- keep the interpreter deterministic
- reuse the current question-surface substrate instead of adding a second parser family
- keep `decisions.yml` and `planning-requests.yml` as the only durable truth
- preserve existing `question_blocks`, `question_spans`, and prompt-grounded question matching behavior

## Implemented Scope

### Root `sourceResponseFormat: "question_closing_spans"`

Answer-driven assistant actions and Bun API routes now support:

- `sourceResponseFormat: "question_closing_spans"`

on:

- `record_answer`
- `record_answers`
- `resolve_decision`

### Supported Span Shape

Question-closing-span replies are interpreted as sentence streams such as:

- `Use Bun-native auth.`
- `That keeps the runtime simple.`
- `Auth strategy?`
- `Use a staged rollout.`
- `That keeps the launch reversible.`
- `Rollout strategy?`

where a new durable span closes whenever one sentence ends with `?`.

The span for a question contains:

- every non-question sentence since the previous closing question sentence
- the current question sentence that names the durable topic
- stopping immediately after that closing question sentence

The durable answer text is the joined answer sentences only. The closing question sentence itself is preserved as durable `prompt`, not copied into `answer`.

### Deterministic Closing-Question Matching

Runtime now parses question-closing-span replies by:

- splitting the reply into sentences
- accumulating non-question answer sentences until one sentence ends with `?`
- closing the current span on that question sentence
- matching requested durable topics against the normalized closing question text
- returning the collected answer sentences as the durable answer text

Because each span still closes on one explicit question sentence, this slice remains deterministic and does not depend on fuzzy extraction.

### Shared Reuse Across Existing Surfaces

Once parsed, the same question-closing-span surface can feed:

- explicit decision answers
- `inferOpenDecisions`
- `inferDecisionTopics`
- `followThrough.answers`
- `followThrough.inferRemainingAnswers`

That means one reply with:

- one auth explanation closed by an auth question sentence
- one rollout explanation closed by a rollout question sentence
- one pilot-scope explanation closed by a pilot-scope question sentence

can resolve known auth and rollout decisions while preserving the remaining pilot answer span on planner follow-through, or create brand-new durable auth and rollout decision topics from the remaining spans.

### Prompt-Grounded Reuse

Question-closing spans reuse the same deterministic question-matching authority as the existing question surfaces:

- exact durable `prompt` text
- deterministic prompt-core matching
- deterministic prompt-keyword anchor matching

This lets current open decisions and planner captured answers match a closing question sentence even when the shorter summary is not repeated verbatim.

### Deterministic Validation

Runtime now rejects question-closing-span interpretation deterministically when:

- `sourceResponseFormat` is `question_closing_spans` but `sourceResponse` is missing
- a closing question sentence appears before any answer sentence
- the reply ends with leftover answer sentences that were never closed by a question sentence
- a requested explicit or open decision topic has no matching closing question span
- more than one closing question span matches the same requested topic
- more than one existing known decision matches one inferred remaining closing question span

## Non-Goals

- inferring topics from answer sentences that have no closing question sentence
- semantic regrouping across non-contiguous sentences
- paraphrasing matched spans into shorter synthetic answers
- replacing `question_spans` where front-loaded question sentences already exist

## Acceptance Criteria

- assistant and Bun API can materialize more than one durable answer from one question-closing-span reply without requiring the question sentence to appear first
- current open decisions can be resolved from question-closing spans without per-topic mapping
- remaining question-closing spans can become new durable decision topics
- planner follow-through can consume the remaining question-closing span from the same shared reply
- missing or multiply matched question-closing spans fail deterministically
