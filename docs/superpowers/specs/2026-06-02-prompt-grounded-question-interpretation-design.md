# Prompt-Grounded Question Interpretation Design

Status: approved and implemented
Date: 2026-06-02

## Goal

Let answer-driven decision interpretation reuse the exact durable decision question when a shared reply is structured as question-and-answer blocks or question-and-answer spans, so runtime no longer depends on topic labels inside those question texts.

## Why This Slice Exists

The prior answer-interpretation work already supported:

- `question_blocks`
- `question_spans`

But those formats still matched current decisions only through:

- `decisionKey`
- humanized `decisionKey`
- concise `summary`

That meant a reply like:

- `Should we use Bun-native auth or an external auth provider?`

could not resolve an existing durable decision whose summary was only:

- `Choose the auth strategy`

even when `decisions.yml` already preserved the exact canonical question through `prompt`.

## Constraints

- keep `decisions.yml` as the only durable decision-topic authority
- do not introduce a second prompt-question lookup store
- preserve existing question-block and question-span semantics for summary-based matches
- keep inference deterministic; exact durable prompt reuse is allowed, fuzzy semantic matching is not

## Implemented Scope

### Shared Question-Match Candidates

Open and known decisions now carry optional `prompt` through the shared answer-interpretation path.

Question-based matching for:

- `inferOpenDecisions` on `question_blocks`
- `inferOpenDecisions` on `question_spans`
- known-decision reuse during `inferDecisionTopics` on question-based formats

now considers:

- humanized `decisionKey`
- concise `summary`
- exact durable `prompt`

### Product Path Coverage

The active product paths now pass decision prompts into the shared interpreter:

- Bun decision answer APIs
- Goal assistant answer actions

That keeps question-based prompt grounding on the same authority route as the rest of answer interpretation instead of adding a special-case side channel.

## Non-Goals

- fuzzy similarity between replies and prompts
- prompt grounding for non-question formats that still need stronger authority design
- automatic prompt inference from assistant-thread history
- broader natural-language topic inference beyond exact repeated question text

## Acceptance Criteria

- current durable decisions can be resolved from `question_blocks` when the question paragraphs repeat their exact stored prompts
- current durable decisions can be resolved from `question_spans` when the question sentences repeat their exact stored prompts
- Bun API and Goal assistant product paths both use the same prompt-grounded shared interpreter
- runtime remains deterministic and does not introduce fuzzy prompt matching
