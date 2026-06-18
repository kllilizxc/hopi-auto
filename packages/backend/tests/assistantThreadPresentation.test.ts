import { describe, expect, test } from 'bun:test'
import {
  formatAssistantThreadEntryPresentation,
  renderRecentAssistantThreadMarkdown,
} from '../src/assistant/assistantInspection'

describe('assistant thread presentation', () => {
  test('surfaces unified request_planning and resolve_decisions action authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-unified-planning',
        createdAt: '2026-06-03T00:00:00.000Z',
        kind: 'action',
        actionType: 'request_planning',
        summary: 'Request grouped planning: auth-follow-through',
        action: {
          kind: 'request_planning',
          mode: 'batch',
          attachmentAssetPaths: [],
          groupKey: 'auth-follow-through',
          decisionRefs: ['auth-strategy'],
          answers: [{ summary: 'Pilot scope', answerKey: 'pilot-scope', matchHints: [] }],
          answerSources: [],
          requests: [
            {
              taskKey: 'task-graph',
              title: 'Decompose auth task graph',
              description: 'Reshape todo.yml after the goal context is stable.',
              acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
              requestedUpdates: ['todo.yml'],
              blockedBy: [],
              blockedByTaskKeys: [],
            },
          ],
        },
      }),
    ).toEqual({
      body: 'request_planning | Request grouped planning: auth-follow-through',
      details: [
        'Planning mode: batch',
        'Planning group key: auth-follow-through',
        'Grouped requests: 1',
        'Linked decisions: auth-strategy',
        'Shared planner answers: 1',
        'Shared planner answer detail: Pilot scope [answerKey=pilot-scope]',
        'Grouped request: task-graph -> updates todo.yml',
        'Grouped request task-graph title: Decompose auth task graph',
        'Grouped request task-graph description: Reshape todo.yml after the goal context is stable.',
        'Grouped request task-graph acceptance: The auth task graph is visible in todo.yml.',
      ],
    })

    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-unified-decisions',
        createdAt: '2026-06-03T00:00:00.000Z',
        kind: 'action',
        actionType: 'resolve_decisions',
        summary: 'Resolve 1 durable decisions.',
        action: {
          kind: 'resolve_decisions',
          attachmentAssetPaths: [],
          inferOpenDecisions: true,
          inferDecisionTopics: false,
          sourceResponseFormat: 'matching_answer_sources',
          answers: [{ summary: 'Auth strategy', decisionKey: 'auth-strategy', matchHints: [] }],
          answerSources: [],
        },
      }),
    ).toEqual({
      body: 'resolve_decisions | Resolve 1 durable decisions.',
      details: [
        'Explicit answers: 1',
        'Explicit answer detail: Auth strategy [decisionKey=auth-strategy]',
        'Infer open decisions: yes',
        'Action source-response format: matching_answer_sources',
      ],
    })
  })

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
          attachmentAssetPaths: [],
          title: 'Capture rollout notes',
          description: 'Record rollout details before more planning work continues.',
          acceptanceCriteria: ['Rollout notes are durable.'],
          decisionRefs: [],
          sourceResponseFormat: 'matching_answer_sources',
          answers: [
            { summary: 'Early access cohort plan', answerKey: 'pilot-scope', matchHints: [] },
          ],
          requestedUpdates: ['goal.md', 'notes/rollout.md'],
          blockedBy: [{ kind: 'decision', ref: 'rollout-approval' }],
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
        'Planning description: Record rollout details before more planning work continues.',
        'Planning acceptance: Rollout notes are durable.',
        'Captured planner answers: 1',
        'Planner answer detail: Early access cohort plan [answerKey=pilot-scope]',
        'Planning blockers: decision:rollout-approval',
        'Reusable answer sources: 1',
        'Reusable answer source detail: source-1 [answerKey=pilot-scope]: Start with five enterprise customers before broader launch.',
        'Requested durable updates: goal.md, notes/rollout.md',
        'Action source-response format: matching_answer_sources',
      ],
    })
  })

  test('surfaces grouped planning request authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-batch',
        createdAt: '2026-06-03T00:00:00.000Z',
        kind: 'action',
        actionType: 'request_planning_batch',
        summary: 'Request grouped planning: auth-follow-through',
        action: {
          kind: 'request_planning_batch',
          attachmentAssetPaths: [],
          groupKey: 'auth-follow-through',
          decisionRefs: ['auth-strategy'],
          answers: [{ summary: 'Pilot scope', answerKey: 'pilot-scope', matchHints: [] }],
          answerSources: [
            {
              answerSourceKey: 'source-1',
              answerKey: 'pilot-scope',
              answer: 'Start with five enterprise customers before broader launch.',
              matchHints: [],
            },
          ],
          requests: [
            {
              taskKey: 'goal-docs',
              title: 'Clarify auth goal context',
              description: 'Refresh durable Goal context before decomposition.',
              acceptanceCriteria: ['Goal context captures the auth direction.'],
              requestedUpdates: ['goal.md', 'design.md'],
              blockedBy: [],
              blockedByTaskKeys: [],
            },
            {
              taskKey: 'task-graph',
              title: 'Decompose auth task graph',
              description: 'Reshape todo.yml after the goal context is stable.',
              acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
              requestedUpdates: ['todo.yml'],
              blockedBy: [{ kind: 'decision', ref: 'auth-approval' }],
              blockedByTaskKeys: ['goal-docs'],
            },
          ],
        },
      }),
    ).toEqual({
      body: 'request_planning_batch | Request grouped planning: auth-follow-through',
      details: [
        'Planning group key: auth-follow-through',
        'Grouped requests: 2',
        'Linked decisions: auth-strategy',
        'Shared planner answers: 1',
        'Shared planner answer detail: Pilot scope [answerKey=pilot-scope]',
        'Reusable answer sources: 1',
        'Reusable answer source detail: source-1 [answerKey=pilot-scope]: Start with five enterprise customers before broader launch.',
        'Grouped request: goal-docs -> updates goal.md, design.md',
        'Grouped request goal-docs title: Clarify auth goal context',
        'Grouped request goal-docs description: Refresh durable Goal context before decomposition.',
        'Grouped request goal-docs acceptance: Goal context captures the auth direction.',
        'Grouped request: task-graph -> updates todo.yml',
        'Grouped request task-graph title: Decompose auth task graph',
        'Grouped request task-graph description: Reshape todo.yml after the goal context is stable.',
        'Grouped request task-graph acceptance: The auth task graph is visible in todo.yml.',
        'Grouped request task-graph blockers: decision:auth-approval',
        'Grouped request task-graph depends on: goal-docs',
      ],
    })
  })

  test('surfaces grouped planning follow-through request authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-follow-through-batch',
        createdAt: '2026-06-03T00:00:00.000Z',
        kind: 'action',
        actionType: 'record_answer',
        summary: 'Record answer with grouped planning follow-through auth-follow-through.',
        action: {
          kind: 'record_answer',
          attachmentAssetPaths: [],
          summary: 'Choose the auth strategy',
          answer: 'Use Bun-native auth.',
          matchHints: [],
          answerSources: [],
          followThrough: {
            kind: 'planning_batch',
            groupKey: 'auth-follow-through',
            answers: [{ summary: 'Pilot scope', answerKey: 'pilot-scope', matchHints: [] }],
            requests: [
              {
                taskKey: 'goal-docs',
                title: 'Clarify auth goal context',
                description: 'Refresh durable Goal context before decomposition.',
                acceptanceCriteria: ['Goal context captures the auth direction.'],
                requestedUpdates: ['goal.md', 'design.md'],
                blockedBy: [],
                blockedByTaskKeys: [],
              },
              {
                taskKey: 'task-graph',
                title: 'Decompose auth task graph',
                description: 'Reshape todo.yml after the goal context is stable.',
                acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
                requestedUpdates: ['todo.yml'],
                blockedBy: [{ kind: 'task', ref: 'T-9' }],
                blockedByTaskKeys: ['goal-docs'],
              },
            ],
          },
        },
      }),
    ).toEqual({
      body: 'record_answer | Record answer with grouped planning follow-through auth-follow-through.',
      details: [
        'Decision answer detail: Choose the auth strategy: Use Bun-native auth.',
        'Follow-through kind: planning_batch',
        'Follow-through group key: auth-follow-through',
        'Follow-through grouped request: goal-docs -> updates goal.md, design.md',
        'Follow-through grouped request goal-docs title: Clarify auth goal context',
        'Follow-through grouped request goal-docs description: Refresh durable Goal context before decomposition.',
        'Follow-through grouped request goal-docs acceptance: Goal context captures the auth direction.',
        'Follow-through grouped request: task-graph -> updates todo.yml',
        'Follow-through grouped request task-graph title: Decompose auth task graph',
        'Follow-through grouped request task-graph description: Reshape todo.yml after the goal context is stable.',
        'Follow-through grouped request task-graph acceptance: The auth task graph is visible in todo.yml.',
        'Follow-through grouped request task-graph blockers: task:T-9',
        'Follow-through grouped request task-graph depends on: goal-docs',
        'Follow-through shared planner answers: 1',
        'Follow-through shared planner answer detail: Pilot scope [answerKey=pilot-scope]',
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
          attachmentAssetPaths: [],
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
              {
                kind: 'planning',
                workflowTaskKey: 'handoff-review',
                blockedByWorkflowKeys: ['rollout-notes'],
                title: 'Review rollout readiness',
                description: 'Inspect rollout notes before final handoff.',
                acceptanceCriteria: ['The rollout handoff review is visible.'],
                answers: [
                  {
                    summary: 'Rollback trigger',
                    answerKey: 'rollback-trigger',
                    matchHints: [],
                  },
                ],
                requestedUpdates: ['design.md'],
              },
            ],
          },
        },
      }),
    ).toEqual({
      body: 'record_answers | Capture shared rollout answers',
      details: [
        'Explicit answers: 1',
        'Explicit answer detail: Auth strategy [decisionKey=auth-strategy]',
        'Infer open decisions: yes',
        'Infer decision topics: yes',
        'Reusable answer sources: 2',
        'Reusable answer source detail: source-1 [route=decision] [decisionKey=rollout-strategy]: Use Bun-native auth for the first rollout. | source-2 [route=planning] [answerKey=pilot-scope]: Start with five enterprise customers before broader launch.',
        'Action source-response format: matching_answer_sources',
        'Follow-through kind: workflow_batch',
        'Follow-through workflow key: auth-rollout-follow-through',
        'Follow-through reusable group key: auth-follow-through',
        'Follow-through workflow child: rollout-notes -> updates goal.md, notes/rollout.md',
        'Follow-through workflow child rollout-notes title: Capture rollout notes',
        'Follow-through workflow child rollout-notes description: Record rollout decisions.',
        'Follow-through workflow child rollout-notes acceptance: Rollout notes are durable.',
        'Follow-through workflow child: handoff-review -> updates design.md',
        'Follow-through workflow child handoff-review title: Review rollout readiness',
        'Follow-through workflow child handoff-review description: Inspect rollout notes before final handoff.',
        'Follow-through workflow child handoff-review acceptance: The rollout handoff review is visible.',
        'Follow-through workflow child handoff-review depends on: rollout-notes',
        'Follow-through workflow child handoff-review planner answers: 1',
        'Follow-through workflow child handoff-review planner answer detail: Rollback trigger [answerKey=rollback-trigger]',
        'Follow-through shared planner answers: 1',
        'Follow-through shared planner answer detail: Pilot scope [answerKey=pilot-scope]',
        'Follow-through infers remaining answers: yes',
      ],
    })
  })

  test('surfaces child-level workflow action authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-3',
        createdAt: '2026-06-03T00:00:00.000Z',
        kind: 'action',
        actionType: 'request_planning_workflows',
        summary: 'Update planning workflow auth-rollout-follow-through.',
        action: {
          kind: 'request_planning_workflows',
          attachmentAssetPaths: [],
          workflowKey: 'auth-rollout-follow-through',
          reuseGroupKey: 'auth-follow-through',
          decisionRefs: ['auth-strategy'],
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
              blockedBy: [{ kind: 'decision', ref: 'release-approval' }],
            },
            {
              kind: 'planning_batch',
              groupKey: 'auth-follow-through',
              blockedByWorkflowKeys: ['rollout-notes'],
              decisionRefs: ['rollout-strategy'],
              answers: [
                {
                  summary: 'Rollback trigger',
                  answerKey: 'rollback-trigger',
                  matchHints: [],
                },
              ],
              requests: [
                {
                  taskKey: 'goal-docs',
                  title: 'Clarify auth goal context',
                  description: 'Refresh durable Goal context before decomposition.',
                  acceptanceCriteria: ['Goal context captures the auth direction.'],
                  requestedUpdates: ['goal.md', 'design.md'],
                  blockedBy: [],
                  blockedByTaskKeys: [],
                },
                {
                  taskKey: 'task-graph',
                  title: 'Decompose auth task graph',
                  description: 'Reshape todo.yml after the goal context is stable.',
                  acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
                  requestedUpdates: ['todo.yml'],
                  blockedBy: [{ kind: 'decision', ref: 'auth-approval' }],
                  blockedByTaskKeys: ['goal-docs'],
                },
              ],
            },
          ],
        },
      }),
    ).toEqual({
      body: 'request_planning_workflows | Update planning workflow auth-rollout-follow-through.',
      details: [
        'Workflow count: 2',
        'Workflow key: auth-rollout-follow-through',
        'Reuse group key: auth-follow-through',
        'Linked decisions: auth-strategy',
        'Shared planner answers: 1',
        'Shared planner answer detail: Pilot scope [answerKey=pilot-scope]',
        'Reusable answer sources: 1',
        'Reusable answer source detail: source-1 [answerKey=pilot-scope]: Start with five enterprise customers before broader launch.',
        'Workflow child: rollout-notes -> updates goal.md, notes/rollout.md',
        'Workflow child rollout-notes title: Capture rollout notes',
        'Workflow child rollout-notes description: Record rollout details before more planning work continues.',
        'Workflow child rollout-notes acceptance: Rollout notes are durable.',
        'Workflow child rollout-notes blockers: decision:release-approval',
        'Workflow child: auth-follow-through -> requests goal-docs, task-graph',
        'Workflow child auth-follow-through grouped request: goal-docs -> updates goal.md, design.md',
        'Workflow child auth-follow-through grouped request goal-docs title: Clarify auth goal context',
        'Workflow child auth-follow-through grouped request goal-docs description: Refresh durable Goal context before decomposition.',
        'Workflow child auth-follow-through grouped request goal-docs acceptance: Goal context captures the auth direction.',
        'Workflow child auth-follow-through grouped request: task-graph -> updates todo.yml',
        'Workflow child auth-follow-through grouped request task-graph title: Decompose auth task graph',
        'Workflow child auth-follow-through grouped request task-graph description: Reshape todo.yml after the goal context is stable.',
        'Workflow child auth-follow-through grouped request task-graph acceptance: The auth task graph is visible in todo.yml.',
        'Workflow child auth-follow-through grouped request task-graph blockers: decision:auth-approval',
        'Workflow child auth-follow-through grouped request task-graph depends on: goal-docs',
        'Workflow child auth-follow-through depends on: rollout-notes',
        'Workflow child auth-follow-through decisions: rollout-strategy',
        'Workflow child auth-follow-through planner answers: 1',
        'Workflow child auth-follow-through planner answer detail: Rollback trigger [answerKey=rollback-trigger]',
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
          request: {
            requestKey: 'PR-1',
            workflowSharedDecisionRefs: ['rollout-strategy'],
            workflowSharedAnswers: [
              {
                summary: 'Shared rollout note',
                answerKey: 'rollout-note',
                answer: 'Gate broader launch on pilot feedback.',
                matchHints: ['staged launch'],
                captureFormat: 'matching_answer_sources',
              },
            ],
            blockedByWorkflowKeys: [],
            title: 'Capture rollout notes',
            description: 'Record rollout details before more planning work continues.',
            acceptanceCriteria: ['Rollout notes are durable.'],
            taskRef: 'P-1',
            decisionRefs: ['rollout-strategy'],
            answers: [
              {
                summary: 'Pilot scope',
                answer: 'Start with five enterprise customers before broader launch.',
                matchHints: ['launch cohort'],
              },
            ],
            attachments: [],
            requestedUpdates: ['goal.md', 'design.md'],
            status: 'open',
            createdAt: '2026-06-04T00:00:00.000Z',
          },
          created: true,
          taskCreated: true,
          resolvedSourceResponseFormat: 'matching_answer_sources',
          summary: 'Requested planning follow-through in PR-1 for P-1.',
        },
      }),
    ).toEqual({
      body: 'request_planning | Requested planning follow-through in PR-1 for P-1.',
      details: [
        'Request key: PR-1',
        'Task ref: P-1',
        'Created planning request: yes',
        'Created planning task: yes',
        'Request detail: PR-1 [open] Capture rollout notes [taskRef=P-1] [decisionRefs=rollout-strategy] [updates=goal.md, design.md] [workflowSharedDecisionRefs=rollout-strategy]',
        'Request description PR-1: Record rollout details before more planning work continues.',
        'Request acceptance PR-1: Rollout notes are durable.',
        'Request answer detail PR-1: Pilot scope [matchHints=launch cohort]: Start with five enterprise customers before broader launch.',
        'Workflow-shared answer detail PR-1: Shared rollout note [answerKey=rollout-note] [matchHints=staged launch] [captureFormat=matching_answer_sources]: Gate broader launch on pilot feedback.',
        'Resolved source-response format: matching_answer_sources',
      ],
    })
  })

  test('surfaces resolved planning request lifecycle authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-request-resolved',
        createdAt: '2026-06-04T00:00:00.000Z',
        kind: 'action_result',
        actionType: 'request_planning',
        summary: 'Planning request PR-9 is already resolved.',
        result: {
          kind: 'request_planning',
          requestKey: 'PR-9',
          taskRef: 'P-9',
          request: {
            requestKey: 'PR-9',
            workflowSharedDecisionRefs: [],
            workflowSharedAnswers: [],
            blockedByWorkflowKeys: [],
            title: 'Finalize rollout notes',
            description: 'Document the final rollout conclusion.',
            acceptanceCriteria: ['The rollout conclusion is durable.'],
            taskRef: 'P-9',
            decisionRefs: ['rollout-strategy'],
            answers: [],
            attachments: [],
            requestedUpdates: ['goal.md'],
            status: 'resolved',
            createdAt: '2026-06-04T00:00:00.000Z',
            resolvedAt: '2026-06-04T01:00:00.000Z',
            resolution: 'completed',
          },
          created: false,
          taskCreated: false,
          summary: 'Planning request PR-9 is already resolved.',
        },
      }),
    ).toEqual({
      body: 'request_planning | Planning request PR-9 is already resolved.',
      details: [
        'Request key: PR-9',
        'Task ref: P-9',
        'Created planning request: no',
        'Created planning task: no',
        'Request detail: PR-9 [resolved] Finalize rollout notes [taskRef=P-9] [decisionRefs=rollout-strategy] [updates=goal.md]',
        'Request description PR-9: Document the final rollout conclusion.',
        'Request acceptance PR-9: The rollout conclusion is durable.',
        'Request resolved at PR-9: 2026-06-04T01:00:00.000Z',
        'Request resolution PR-9: completed',
      ],
    })
  })

  test('surfaces durable decision-result authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-decision-result',
        createdAt: '2026-06-04T00:00:00.000Z',
        kind: 'action_result',
        actionType: 'record_answer',
        summary: 'Recorded answer in decision auth-strategy.',
        result: {
          kind: 'record_answer',
          decisionKey: 'auth-strategy',
          decision: {
            decisionKey: 'auth-strategy',
            summary: 'Choose the auth strategy',
            summaryKey: 'auth-strategy',
            prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
            matchHints: ['login path'],
            captureFormat: 'matching_answer_sources',
            status: 'resolved',
            taskRef: 'T-7',
            answer: 'Use Bun-native auth.',
            attachments: [],
            createdAt: '2026-06-04T00:00:00.000Z',
            resolvedAt: '2026-06-04T00:05:00.000Z',
          },
          created: false,
          blockerRemoved: true,
          summary: 'Recorded answer in decision auth-strategy.',
        },
      }),
    ).toEqual({
      body: 'record_answer | Recorded answer in decision auth-strategy.',
      details: [
        'Decision key: auth-strategy',
        'Decision detail: auth-strategy [resolved] Choose the auth strategy [summaryKey=auth-strategy] [prompt=Which auth strategy should we adopt for the Bun-first runtime?] [matchHints=login path] [taskRef=T-7] [captureFormat=matching_answer_sources]',
        'Decision answer: Use Bun-native auth.',
        'Decision resolved at auth-strategy: 2026-06-04T00:05:00.000Z',
        'Decision blocker removed: yes',
      ],
    })
  })

  test('surfaces durable preference authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-preference-action',
        createdAt: '2026-06-04T00:00:00.000Z',
        kind: 'action',
        actionType: 'record_preference',
        summary:
          'Record durable preference prefer-bun-native-services: Prefer Bun-native services when they meet the Goal requirements.',
        action: {
          kind: 'record_preference',
          preferenceKey: 'prefer-bun-native-services',
          summary: 'Prefer Bun-native services when they meet the Goal requirements.',
          rationale: 'The runtime boundary is Bun-first.',
          supersedes: ['prefer-deterministic-workflows'],
        },
      }),
    ).toEqual({
      body: 'record_preference | Record durable preference prefer-bun-native-services: Prefer Bun-native services when they meet the Goal requirements.',
      details: [
        'Preference key: prefer-bun-native-services',
        'Supersedes: prefer-deterministic-workflows',
        'Preference rationale: The runtime boundary is Bun-first.',
      ],
    })

    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-preference-result',
        createdAt: '2026-06-04T00:00:00.000Z',
        kind: 'action_result',
        actionType: 'record_preference',
        summary:
          'Recorded durable preference: Prefer Bun-native services when they meet the Goal requirements.',
        result: {
          kind: 'record_preference',
          preferenceKey: 'prefer-bun-native-services',
          preferenceSummary: 'Prefer Bun-native services when they meet the Goal requirements.',
          rationale: 'The runtime boundary is Bun-first.',
          preference: {
            preferenceKey: 'prefer-bun-native-services',
            status: 'active',
            summary: 'Prefer Bun-native services when they meet the Goal requirements.',
            rationale: 'The runtime boundary is Bun-first.',
          },
          retiredPreferences: [
            {
              preferenceKey: 'prefer-deterministic-workflows',
              status: 'retired',
              summary: 'Prefer deterministic workflows.',
              retiredReason: 'Superseded by prefer-bun-native-services.',
              supersededBy: 'prefer-bun-native-services',
            },
          ],
          retiredPreferenceKeys: ['prefer-deterministic-workflows'],
          summary:
            'Recorded durable preference: Prefer Bun-native services when they meet the Goal requirements.',
        },
      }),
    ).toEqual({
      body: 'record_preference | Recorded durable preference: Prefer Bun-native services when they meet the Goal requirements.',
      details: [
        'Preference key: prefer-bun-native-services',
        'Retired preference keys: prefer-deterministic-workflows',
        'Preference detail: prefer-bun-native-services [active] Prefer Bun-native services when they meet the Goal requirements. [rationale=The runtime boundary is Bun-first.]',
        'Retired preference detail: prefer-deterministic-workflows [retired] Prefer deterministic workflows. [retiredReason=Superseded by prefer-bun-native-services.] [supersededBy=prefer-bun-native-services]',
      ],
    })
  })

  test('surfaces structured task-result authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-task-result',
        createdAt: '2026-06-04T00:00:00.000Z',
        kind: 'action_result',
        actionType: 'move_task',
        summary: 'Moved P-7 to in_review.',
        result: {
          kind: 'move_task',
          taskRef: 'P-7',
          status: 'in_review',
          previousStatus: 'planned',
          task: {
            ref: 'P-7',
            kind: 'planning',
            status: 'in_review',
            title: 'Ship auth rollout',
            description: 'Complete the rollout review before merge.',
            acceptanceCriteria: ['Rollout review is complete.'],
            blockedBy: [{ kind: 'decision', ref: 'release-approval' }],
          },
          summary: 'Moved P-7 to in_review.',
        },
      }),
    ).toEqual({
      body: 'move_task | Moved P-7 to in_review.',
      details: [
        'Task ref: P-7',
        'Result status: in_review',
        'Previous status: planned',
        'Task detail: P-7 [planning] [in_review] Ship auth rollout [blockers=decision:release-approval]',
        'Task description P-7: Complete the rollout review before merge.',
        'Task acceptance P-7: Rollout review is complete.',
      ],
    })
  })

  test('surfaces retry-task authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-retry-task-result',
        createdAt: '2026-06-04T00:00:00.000Z',
        kind: 'action_result',
        actionType: 'retry_task',
        summary: 'Cleared retryable blocker intervention:T-4:reviewer_rejected from T-4.',
        result: {
          kind: 'retry_task',
          taskRef: 'T-4',
          status: 'planned',
          clearedBlockers: [{ kind: 'intervention', ref: 'T-4:reviewer_rejected' }],
          task: {
            ref: 'T-4',
            kind: 'engineering',
            status: 'planned',
            title: 'Polish deck manager layout',
            description: 'Retry the reviewer-rejected deck manager polish task.',
            acceptanceCriteria: ['The deck manager returns to a clean two-pane layout.'],
            blockedBy: [],
          },
          summary: 'Cleared retryable blocker intervention:T-4:reviewer_rejected from T-4.',
        },
      }),
    ).toEqual({
      body: 'retry_task | Cleared retryable blocker intervention:T-4:reviewer_rejected from T-4.',
      details: [
        'Task ref: T-4',
        'Result status: planned',
        'Cleared blockers: intervention:T-4:reviewer_rejected',
        'Task detail: T-4 [engineering] [planned] Polish deck manager layout',
        'Task description T-4: Retry the reviewer-rejected deck manager polish task.',
        'Task acceptance T-4: The deck manager returns to a clean two-pane layout.',
      ],
    })
  })

  test('surfaces created planning task body authority in thread presentation', () => {
    expect(
      formatAssistantThreadEntryPresentation({
        entryId: 'entry-created-task-result',
        createdAt: '2026-06-04T00:00:00.000Z',
        kind: 'action_result',
        actionType: 'create_planning_task',
        summary: 'Created planning task P-9.',
        result: {
          kind: 'create_planning_task',
          taskRef: 'P-9',
          task: {
            ref: 'P-9',
            kind: 'planning',
            status: 'planned',
            title: 'Capture rollout notes',
            description: 'Record rollout details before handoff.',
            acceptanceCriteria: ['Rollout notes are durable.'],
            blockedBy: [{ kind: 'decision', ref: 'rollout-approval' }],
          },
          summary: 'Created planning task P-9.',
        },
      }),
    ).toEqual({
      body: 'create_planning_task | Created planning task P-9.',
      details: [
        'Task ref: P-9',
        'Task detail: P-9 [planning] [planned] Capture rollout notes [blockers=decision:rollout-approval]',
        'Task description P-9: Record rollout details before handoff.',
        'Task acceptance P-9: Rollout notes are durable.',
      ],
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
            created: true,
            taskCreated: true,
            resolvedSourceResponseFormat: 'matching_answer_sources',
            summary: 'Requested planning follow-through in PR-1 for P-1.',
          },
        },
      ]),
    ).toContain('Request key: PR-1')
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
            attachmentAssetPaths: [],
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
