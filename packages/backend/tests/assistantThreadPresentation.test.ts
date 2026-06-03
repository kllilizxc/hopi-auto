import { describe, expect, test } from 'bun:test'
import {
  formatAssistantThreadEntryPresentation,
  renderRecentAssistantThreadMarkdown,
} from '../src/assistant/assistantInspection'

describe('assistant thread presentation', () => {
  test('surfaces structured action authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-0',
        createdAt: '2026-06-03T00:00:00.000Z',
        kind: 'action',
        actionType: 'request_planning',
        summary: 'Request planning: Capture rollout notes',
        action: {
          kind: 'request_planning',
          title: 'Capture rollout notes',
          description: 'Record rollout details before more planning work continues.',
          acceptanceCriteria: ['Rollout notes are durable.'],
          decisionRefs: [],
          sourceResponseFormat: 'matching_answer_sources',
          answers: [
            { summary: 'Early access cohort plan', answerKey: 'pilot-scope', matchHints: [] },
          ],
          requestedUpdates: ['goal.md', 'notes/rollout.md'],
          blockedBy: [],
          answerSources: [
            {
              answerSourceKey: 'source-1',
              answerKey: 'pilot-scope',
              answer: 'Start with five enterprise customers before broader launch.',
              matchHints: [],
            },
          ],
        },
      }),
    ).toEqual({
      body: 'request_planning | Request planning: Capture rollout notes',
      details: [
        'Planning title: Capture rollout notes',
        'Requested durable updates: goal.md, notes/rollout.md',
        'Action source-response format: matching_answer_sources',
      ],
    })
  })

  test('surfaces structured action-result authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-1',
        createdAt: '2026-06-03T00:00:00.000Z',
        kind: 'action_result',
        actionType: 'request_planning',
        summary: 'Requested planning follow-through in PR-1 for P-1.',
        result: {
          kind: 'request_planning',
          requestKey: 'PR-1',
          taskRef: 'P-1',
          resolvedSourceResponseFormat: 'matching_answer_sources',
          summary: 'Requested planning follow-through in PR-1 for P-1.',
        },
      }),
    ).toEqual({
      body: 'request_planning | Requested planning follow-through in PR-1 for P-1.',
      details: ['Resolved source-response format: matching_answer_sources'],
    })
  })

  test('renders structured action-result details in recent assistant thread markdown', () => {
    expect(
      renderRecentAssistantThreadMarkdown([
        {
          entryId: 'entry-1',
          createdAt: '2026-06-03T00:00:00.000Z',
          kind: 'action_result',
          actionType: 'request_planning',
          summary: 'Requested planning follow-through in PR-1 for P-1.',
          result: {
            kind: 'request_planning',
            requestKey: 'PR-1',
            taskRef: 'P-1',
            resolvedSourceResponseFormat: 'matching_answer_sources',
            summary: 'Requested planning follow-through in PR-1 for P-1.',
          },
        },
      ]),
    ).toContain('Resolved source-response format: matching_answer_sources')
  })

  test('renders structured action details in recent assistant thread markdown', () => {
    expect(
      renderRecentAssistantThreadMarkdown([
        {
          entryId: 'entry-0',
          createdAt: '2026-06-03T00:00:00.000Z',
          kind: 'action',
          actionType: 'request_planning',
          summary: 'Request planning: Capture rollout notes',
          action: {
            kind: 'request_planning',
            title: 'Capture rollout notes',
            description: 'Record rollout details before more planning work continues.',
            acceptanceCriteria: ['Rollout notes are durable.'],
            decisionRefs: [],
            sourceResponseFormat: 'matching_answer_sources',
            answers: [
              { summary: 'Early access cohort plan', answerKey: 'pilot-scope', matchHints: [] },
            ],
            requestedUpdates: ['goal.md', 'notes/rollout.md'],
            blockedBy: [],
            answerSources: [
              {
                answerSourceKey: 'source-1',
                answerKey: 'pilot-scope',
                answer: 'Start with five enterprise customers before broader launch.',
                matchHints: [],
              },
            ],
          },
        },
      ]),
    ).toContain('Action source-response format: matching_answer_sources')
  })
})
