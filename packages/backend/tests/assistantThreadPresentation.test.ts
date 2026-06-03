import { describe, expect, test } from 'bun:test'
import {
  formatAssistantThreadEntryPresentation,
  renderRecentAssistantThreadMarkdown,
} from '../src/assistant/assistantInspection'

describe('assistant thread presentation', () => {
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
})
