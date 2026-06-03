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
        'Captured planner answers: 1',
        'Reusable answer sources: 1',
        'Requested durable updates: goal.md, notes/rollout.md',
        'Action source-response format: matching_answer_sources',
      ],
    })
  })

  test('surfaces richer workflow and inferred-answer authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-2',
        createdAt: '2026-06-03T00:00:00.000Z',
        kind: 'action',
        actionType: 'record_answers',
        summary: 'Capture shared rollout answers',
        action: {
          kind: 'record_answers',
          sourceResponseFormat: 'matching_answer_sources',
          inferOpenDecisions: true,
          inferDecisionTopics: true,
          answers: [
            {
              summary: 'Auth strategy',
              decisionKey: 'auth-strategy',
              matchHints: [],
            },
          ],
          answerSources: [
            {
              answerSourceKey: 'source-1',
              route: 'decision',
              decisionKey: 'rollout-strategy',
              answer: 'Use Bun-native auth for the first rollout.',
              matchHints: [],
            },
            {
              answerSourceKey: 'source-2',
              route: 'planning',
              answerKey: 'pilot-scope',
              answer: 'Start with five enterprise customers before broader launch.',
              matchHints: [],
            },
          ],
          followThrough: {
            kind: 'workflow_batch',
            workflowKey: 'auth-rollout-follow-through',
            reuseGroupKey: 'auth-follow-through',
            inferRemainingAnswers: true,
            answers: [
              {
                summary: 'Pilot scope',
                answerKey: 'pilot-scope',
                matchHints: [],
              },
            ],
            workflows: [
              {
                kind: 'planning',
                workflowTaskKey: 'rollout-notes',
                blockedByWorkflowKeys: [],
                title: 'Capture rollout notes',
                description: 'Record rollout decisions.',
                acceptanceCriteria: ['Rollout notes are durable.'],
                answers: [],
                requestedUpdates: ['goal.md', 'notes/rollout.md'],
              },
            ],
          },
        },
      }),
    ).toEqual({
      body: 'record_answers | Capture shared rollout answers',
      details: [
        'Explicit answers: 1',
        'Infer open decisions: yes',
        'Infer decision topics: yes',
        'Reusable answer sources: 2',
        'Action source-response format: matching_answer_sources',
        'Follow-through kind: workflow_batch',
        'Follow-through workflow key: auth-rollout-follow-through',
        'Follow-through reusable group key: auth-follow-through',
        'Follow-through shared planner answers: 1',
        'Follow-through infers remaining answers: yes',
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
