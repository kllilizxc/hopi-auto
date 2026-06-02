# 2026-06-02 Inferred Question Prompt Persistence Design

Status: approved and implemented

## Goal

Preserve exact user-facing question text as durable `prompt` authority when runtime automatically materializes:

- new durable decision topics from remaining `question_blocks` / `question_spans`
- shared planner captured answers from `followThrough.inferRemainingAnswers` on `question_blocks` / `question_spans`

## Why

We already preserve explicit `prompt` on durable decisions and planner answers, and we already use those prompts as matching authority later. Without this slice, question-derived inferred items still dropped the original question text and kept only a shorter summary. That weakened the long-term substrate exactly where the source reply already contained the canonical question wording.

## Constraints

- No fuzzy NLP
- No new durable store
- No separate compatibility path
- Reuse the shared answer-interpretation runtime so API, assistant, direct follow-through, and workflow-root shared answers all stay aligned

## Implemented Scope

1. `followThrough.inferRemainingAnswers` now writes `prompt` from the matched question when source interpretation comes from `question_blocks` or `question_spans`.
2. `inferDecisionTopics` now writes `prompt` from the matched question when remaining `question_blocks` or `question_spans` become new durable decision topics.
3. Bun UI captured-answer rendering now surfaces planner-answer prompts for planning requests and workflow-shared answers.
4. Assistant guidance and handoff now state that question-derived inferred items preserve prompts automatically.

## Non-Goals

- Extending prompt auto-persistence to non-question formats
- New deeper freeform interpretation formats
- Retrofitting existing stored summaries that were created before this authority existed

## Acceptance Criteria

- Runtime tests prove inferred planner answers from question spans keep `prompt`.
- Runtime tests prove inferred decision topics from question blocks/spans keep `prompt`.
- API and assistant tests prove persisted planning requests and newly created decisions keep those prompts.
- Bun UI surfaces planner-answer prompts instead of hiding them once persisted.
