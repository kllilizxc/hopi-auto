import { describe, expect, test } from 'bun:test'
import {
  formatAssistantActionPresentation,
  formatAssistantActionResultDetails,
} from '../src/assistant/assistantInspection'

describe('formatAssistantActionResultDetails', () => {
  test('surfaces the resolved source-response format for interpreted assistant actions', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'record_answers',
        summary: 'Captured shared answers.',
        createdDecisionKeys: ['D-1'],
        blockerRemoved: true,
        resolvedSourceResponseFormat: 'topic_closing_blocks',
        followThrough: {
          kind: 'planning_batch',
          groupKey: 'auth-rollout-follow-through',
          requestKeys: ['PR-1', 'PR-2'],
          taskRefs: ['P-1', 'P-2'],
          blockerTaskRefs: ['P-2'],
        },
      }),
    ).toEqual([
      'Created decision keys: D-1',
      'Decision blocker removed: yes',
      'Resolved source-response format: topic_closing_blocks',
      'Follow-through kind: planning_batch',
      'Follow-through group key: auth-rollout-follow-through',
      'Follow-through requests: PR-1, PR-2',
      'Follow-through tasks: P-1, P-2',
      'Follow-through blockers: P-2',
    ])
  })

  test('surfaces durable ids and grouped workflow metadata for structured action results', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'request_planning_workflows',
        workflowKey: 'auth-rollout-follow-through',
        groupKeys: ['auth-follow-through', 'rollout-follow-through'],
        workflows: [
          {
            kind: 'planning',
            workflowTaskKey: 'rollout-notes',
            requestKeys: ['PR-1'],
            taskRefs: ['P-1'],
            blockerTaskRefs: ['P-1'],
          },
          {
            kind: 'planning_batch',
            groupKey: 'auth-follow-through',
            requestKeys: ['PR-2', 'PR-3'],
            taskRefs: ['P-2', 'P-3'],
            blockerTaskRefs: ['P-3'],
          },
        ],
        requestKeys: ['PR-1', 'PR-2', 'PR-3'],
        taskRefs: ['P-1', 'P-2', 'P-3'],
        blockerTaskRefs: ['P-1', 'P-3'],
        resolvedSourceResponseFormat: 'matching_answer_sources',
        summary: 'Opened auth rollout workflows.',
      }),
    ).toEqual([
      'Workflow key: auth-rollout-follow-through',
      'Workflow group keys: auth-follow-through, rollout-follow-through',
      'Workflow children: 2',
      'Request keys: PR-1, PR-2, PR-3',
      'Task refs: P-1, P-2, P-3',
      'Blocker task refs: P-1, P-3',
      'Resolved source-response format: matching_answer_sources',
    ])
  })

  test('surfaces durable preference result authority', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'record_preference',
        preferenceKey: 'prefer-bun-native-services',
        retiredPreferenceKeys: ['prefer-deterministic-workflows'],
        summary:
          'Recorded durable preference: Prefer Bun-native services when they meet the Goal requirements.',
      }),
    ).toEqual([
      'Preference key: prefer-bun-native-services',
      'Retired preference keys: prefer-deterministic-workflows',
    ])
  })

  test('surfaces structured action authority for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
        kind: 'request_planning_workflows',
        workflowKey: 'auth-rollout-follow-through',
        reuseGroupKey: 'auth-follow-through',
        decisionRefs: ['auth-strategy'],
        sourceResponseFormat: 'matching_answer_sources',
        inferRemainingAnswers: true,
        answers: [{ summary: 'Pilot scope', answerKey: 'pilot-scope', matchHints: [] }],
        answerSources: [
          {
            answerSourceKey: 'source-1',
            answerKey: 'pilot-scope',
            answer: 'Start with five enterprise customers before broader launch.',
            matchHints: [],
          },
        ],
        workflows: [
          {
            kind: 'planning',
            workflowTaskKey: 'rollout-notes',
            blockedByWorkflowKeys: [],
            title: 'Capture rollout notes',
            description: 'Record rollout details before more planning work continues.',
            acceptanceCriteria: ['Rollout notes are durable.'],
            decisionRefs: [],
            answers: [],
            requestedUpdates: ['goal.md', 'notes/rollout.md'],
            blockedBy: [],
          },
        ],
      }),
    ).toEqual({
      body: 'request_planning_workflows | Update planning workflow auth-rollout-follow-through.',
      details: [
        'Workflow count: 1',
        'Workflow key: auth-rollout-follow-through',
        'Reuse group key: auth-follow-through',
        'Linked decisions: auth-strategy',
        'Shared planner answers: 1',
        'Reusable answer sources: 1',
        'Infer remaining answers: yes',
        'Action source-response format: matching_answer_sources',
      ],
    })
  })
})
