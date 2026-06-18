import { describe, expect, test } from 'bun:test'
import {
  formatAssistantActionPresentation,
  formatAssistantActionResultDetails,
  formatAssistantEventPresentation,
} from '../src/assistant/assistantInspection'

describe('formatAssistantActionResultDetails', () => {
  test('surfaces unified request_planning and resolve_decisions result authority', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'request_planning',
        mode: 'batch',
        groupKey: 'auth-follow-through',
        requestKeys: ['PR-1', 'PR-2'],
        taskRefs: ['P-1', 'P-2'],
        blockerTaskRefs: ['P-2'],
        createdRequestKeys: ['PR-1', 'PR-2'],
        createdTaskRefs: ['P-1', 'P-2'],
        summary: 'Requested grouped planning follow-through.',
      }),
    ).toEqual([
      'Planning mode: batch',
      'Group key: auth-follow-through',
      'Request keys: PR-1, PR-2',
      'Task refs: P-1, P-2',
      'Blocker task refs: P-2',
      'Created request keys: PR-1, PR-2',
      'Created task refs: P-1, P-2',
    ])

    expect(
      formatAssistantActionResultDetails({
        kind: 'resolve_decisions',
        summary: 'Resolved 2 durable decisions.',
        decisionKeys: ['D-1', 'D-2'],
        createdDecisionKeys: ['D-2'],
        blockerRemoved: true,
        resolvedSourceResponseFormat: 'matching_answer_sources',
      }),
    ).toEqual([
      'Decision keys: D-1, D-2',
      'Created decision keys: D-2',
      'Decision blocker removed: yes',
      'Resolved source-response format: matching_answer_sources',
    ])
  })

  test('surfaces structured task-result authority for move and create planning task actions', () => {
    expect(
      formatAssistantActionResultDetails({
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
      }),
    ).toEqual([
      'Task ref: P-7',
      'Result status: in_review',
      'Previous status: planned',
      'Task detail: P-7 [planning] [in_review] Ship auth rollout [blockers=decision:release-approval]',
      'Task description P-7: Complete the rollout review before merge.',
      'Task acceptance P-7: Rollout review is complete.',
    ])

    expect(
      formatAssistantActionResultDetails({
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
      }),
    ).toEqual([
      'Task ref: P-9',
      'Task detail: P-9 [planning] [planned] Capture rollout notes [blockers=decision:rollout-approval]',
      'Task description P-9: Record rollout details before handoff.',
      'Task acceptance P-9: Rollout notes are durable.',
    ])
  })

  test('surfaces cleared retryable blockers for retry task results', () => {
    expect(
      formatAssistantActionResultDetails({
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
      }),
    ).toEqual([
      'Task ref: T-4',
      'Result status: planned',
      'Cleared blockers: intervention:T-4:reviewer_rejected',
      'Task detail: T-4 [engineering] [planned] Polish deck manager layout',
      'Task description T-4: Retry the reviewer-rejected deck manager polish task.',
      'Task acceptance T-4: The deck manager returns to a clean two-pane layout.',
    ])
  })

  test('surfaces captured and workflow-shared planner answer details on planning request results', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'request_planning',
        requestKey: 'PR-1',
        taskRef: 'P-1',
        request: {
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
          workflowSharedDecisionRefs: ['rollout-strategy'],
          workflowSharedAnswers: [
            {
              summary: 'Shared rollout note',
              answerKey: 'rollout-note',
              matchHints: ['staged launch'],
              captureFormat: 'matching_answer_sources',
              answer: 'Gate broader launch on pilot feedback.',
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
              matchHints: ['launch cohort'],
              answer: 'Start with five enterprise customers before broader launch.',
            },
          ],
          requestedUpdates: ['goal.md', 'design.md'],
          status: 'open',
          createdAt: '2026-06-04T00:00:00.000Z',
        },
        created: true,
        taskCreated: true,
        resolvedSourceResponseFormat: 'matching_answer_sources',
        summary: 'Requested planning follow-through in PR-1 for P-1.',
      }),
    ).toEqual([
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
    ])
  })

  test('surfaces the resolved source-response format for interpreted assistant actions', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'record_answers',
        summary: 'Captured shared answers.',
        decisionKeys: ['D-1'],
        decisions: [
          {
            decisionKey: 'D-1',
            summary: 'Choose the auth strategy',
            summaryKey: 'auth-strategy',
            prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
            matchHints: ['login path'],
            captureFormat: 'topic_closing_blocks',
            status: 'resolved',
            taskRef: 'T-7',
            answer: 'Use Bun-native auth.',
            createdAt: '2026-06-04T00:00:00.000Z',
            resolvedAt: '2026-06-04T00:05:00.000Z',
          },
        ],
        createdDecisionKeys: ['D-1'],
        blockerRemoved: true,
        resolvedSourceResponseFormat: 'topic_closing_blocks',
        followThrough: {
          kind: 'planning_batch',
          groupKey: 'auth-rollout-follow-through',
          requests: [
            {
              requestKey: 'PR-1',
              workflowSharedDecisionRefs: [],
              workflowSharedAnswers: [],
              blockedByWorkflowKeys: [],
              groupKey: 'auth-rollout-follow-through',
              groupTaskKey: 'goal-docs',
              title: 'Capture auth rollout goal context',
              description: 'Record the auth and rollout answers across Goal docs.',
              acceptanceCriteria: ['The auth and rollout answers are durable.'],
              taskRef: 'P-1',
              decisionRefs: ['D-1'],
              answers: [],
              requestedUpdates: ['goal.md', 'design.md'],
              status: 'open',
              createdAt: '2026-06-04T00:10:00.000Z',
            },
            {
              requestKey: 'PR-2',
              workflowSharedDecisionRefs: [],
              workflowSharedAnswers: [],
              blockedByWorkflowKeys: [],
              groupKey: 'auth-rollout-follow-through',
              groupTaskKey: 'task-graph',
              title: 'Decompose auth rollout task graph',
              description: 'Reflect the auth and rollout answers in todo.yml.',
              acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
              taskRef: 'P-2',
              decisionRefs: ['D-1'],
              answers: [],
              requestedUpdates: ['todo.yml'],
              status: 'open',
              createdAt: '2026-06-04T00:11:00.000Z',
            },
          ],
          requestKeys: ['PR-1', 'PR-2'],
          taskRefs: ['P-1', 'P-2'],
          blockerTaskRefs: ['P-2'],
        },
      }),
    ).toEqual([
      'Decision keys: D-1',
      'Decision detail: D-1 [resolved] Choose the auth strategy [summaryKey=auth-strategy] [prompt=Which auth strategy should we adopt for the Bun-first runtime?] [matchHints=login path] [taskRef=T-7] [captureFormat=topic_closing_blocks]',
      'Decision answer: Use Bun-native auth.',
      'Decision resolved at D-1: 2026-06-04T00:05:00.000Z',
      'Created decision keys: D-1',
      'Decision blocker removed: yes',
      'Resolved source-response format: topic_closing_blocks',
      'Follow-through kind: planning_batch',
      'Follow-through group key: auth-rollout-follow-through',
      'Follow-through requests: PR-1, PR-2',
      'Follow-through tasks: P-1, P-2',
      'Follow-through blockers: P-2',
      'Follow-through request detail: PR-1 [open] Capture auth rollout goal context [taskRef=P-1] [groupKey=auth-rollout-follow-through] [decisionRefs=D-1] [updates=goal.md, design.md]',
      'Request description PR-1: Record the auth and rollout answers across Goal docs.',
      'Request acceptance PR-1: The auth and rollout answers are durable.',
      'Follow-through request detail: PR-2 [open] Decompose auth rollout task graph [taskRef=P-2] [groupKey=auth-rollout-follow-through] [decisionRefs=D-1] [updates=todo.yml]',
      'Request description PR-2: Reflect the auth and rollout answers in todo.yml.',
      'Request acceptance PR-2: The auth rollout task graph is visible in todo.yml.',
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
            requests: [
              {
                requestKey: 'PR-1',
                workflowKey: 'auth-rollout-follow-through',
                workflowTaskKey: 'rollout-notes',
                workflowSharedDecisionRefs: ['auth-strategy'],
                workflowSharedAnswers: [],
                blockedByWorkflowKeys: [],
                title: 'Capture rollout notes',
                description: 'Record rollout details before handoff.',
                acceptanceCriteria: ['Rollout notes are durable.'],
                taskRef: 'P-1',
                decisionRefs: ['auth-strategy'],
                answers: [],
                requestedUpdates: ['goal.md', 'notes/rollout.md'],
                status: 'open',
                createdAt: '2026-06-04T00:00:00.000Z',
              },
            ],
            requestKeys: ['PR-1'],
            taskRefs: ['P-1'],
            blockerTaskRefs: ['P-1'],
          },
          {
            kind: 'planning_batch',
            groupKey: 'auth-follow-through',
            requests: [
              {
                requestKey: 'PR-2',
                workflowKey: 'auth-rollout-follow-through',
                workflowSharedDecisionRefs: ['auth-strategy'],
                workflowSharedAnswers: [],
                blockedByWorkflowKeys: [],
                groupKey: 'auth-follow-through',
                groupTaskKey: 'goal-docs',
                title: 'Capture auth rollout goal context',
                description: 'Record the auth answer across Goal docs.',
                acceptanceCriteria: ['The auth answer is durable in Goal docs.'],
                taskRef: 'P-2',
                decisionRefs: ['auth-strategy'],
                answers: [],
                requestedUpdates: ['goal.md', 'design.md'],
                status: 'open',
                createdAt: '2026-06-04T00:01:00.000Z',
              },
              {
                requestKey: 'PR-3',
                workflowKey: 'auth-rollout-follow-through',
                workflowSharedDecisionRefs: ['auth-strategy'],
                workflowSharedAnswers: [],
                blockedByWorkflowKeys: [],
                groupKey: 'auth-follow-through',
                groupTaskKey: 'task-graph',
                title: 'Decompose auth task graph',
                description: 'Reflect the auth answer in todo.yml.',
                acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
                taskRef: 'P-3',
                decisionRefs: ['auth-strategy'],
                answers: [],
                requestedUpdates: ['todo.yml'],
                status: 'open',
                createdAt: '2026-06-04T00:02:00.000Z',
              },
            ],
            requestKeys: ['PR-2', 'PR-3'],
            taskRefs: ['P-2', 'P-3'],
            blockerTaskRefs: ['P-3'],
          },
        ],
        requestKeys: ['PR-1', 'PR-2', 'PR-3'],
        taskRefs: ['P-1', 'P-2', 'P-3'],
        blockerTaskRefs: ['P-1', 'P-3'],
        createdRequestKeys: ['PR-1', 'PR-2', 'PR-3'],
        createdTaskRefs: ['P-1', 'P-2', 'P-3'],
        resolvedSourceResponseFormat: 'matching_answer_sources',
        summary: 'Opened auth rollout workflows.',
      }),
    ).toEqual([
      'Workflow key: auth-rollout-follow-through',
      'Workflow group keys: auth-follow-through, rollout-follow-through',
      'Workflow children: 2',
      'Workflow child detail: rollout-notes -> requests PR-1 -> tasks P-1 -> blockers P-1',
      'Workflow child request detail: rollout-notes: PR-1 [open] Capture rollout notes [taskRef=P-1] [workflowTaskKey=rollout-notes] [decisionRefs=auth-strategy] [updates=goal.md, notes/rollout.md] [workflowSharedDecisionRefs=auth-strategy]',
      'Request description PR-1: Record rollout details before handoff.',
      'Request acceptance PR-1: Rollout notes are durable.',
      'Workflow child detail: auth-follow-through -> requests PR-2, PR-3 -> tasks P-2, P-3 -> blockers P-3',
      'Workflow child request detail: auth-follow-through: PR-2 [open] Capture auth rollout goal context [taskRef=P-2] [groupKey=auth-follow-through] [decisionRefs=auth-strategy] [updates=goal.md, design.md] [workflowSharedDecisionRefs=auth-strategy]',
      'Request description PR-2: Record the auth answer across Goal docs.',
      'Request acceptance PR-2: The auth answer is durable in Goal docs.',
      'Workflow child request detail: auth-follow-through: PR-3 [open] Decompose auth task graph [taskRef=P-3] [groupKey=auth-follow-through] [decisionRefs=auth-strategy] [updates=todo.yml] [workflowSharedDecisionRefs=auth-strategy]',
      'Request description PR-3: Reflect the auth answer in todo.yml.',
      'Request acceptance PR-3: The auth task graph is visible in todo.yml.',
      'Request keys: PR-1, PR-2, PR-3',
      'Task refs: P-1, P-2, P-3',
      'Blocker task refs: P-1, P-3',
      'Created request keys: PR-1, PR-2, PR-3',
      'Created task refs: P-1, P-2, P-3',
      'Resolved source-response format: matching_answer_sources',
    ])
  })

  test('surfaces structured planning-result creation authority', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'request_planning',
        requestKey: 'PR-1',
        taskRef: 'P-1',
        request: {
          requestKey: 'PR-1',
          workflowSharedDecisionRefs: [],
          workflowSharedAnswers: [],
          blockedByWorkflowKeys: [],
          title: 'Capture rollout notes',
          description: 'Record rollout details before implementation resumes.',
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
          requestedUpdates: ['goal.md', 'design.md'],
          status: 'open',
          createdAt: '2026-06-04T00:00:00.000Z',
        },
        created: true,
        taskCreated: true,
        summary: 'Requested planning follow-through in PR-1 for P-1.',
      }),
    ).toEqual([
      'Request key: PR-1',
      'Task ref: P-1',
      'Created planning request: yes',
      'Created planning task: yes',
      'Request detail: PR-1 [open] Capture rollout notes [taskRef=P-1] [decisionRefs=rollout-strategy] [updates=goal.md, design.md]',
      'Request description PR-1: Record rollout details before implementation resumes.',
      'Request acceptance PR-1: Rollout notes are durable.',
      'Request answer detail PR-1: Pilot scope [matchHints=launch cohort]: Start with five enterprise customers before broader launch.',
    ])
  })

  test('surfaces resolved planning request lifecycle authority', () => {
    expect(
      formatAssistantActionResultDetails({
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
          requestedUpdates: ['goal.md'],
          status: 'resolved',
          createdAt: '2026-06-04T00:00:00.000Z',
          resolvedAt: '2026-06-04T01:00:00.000Z',
          resolution: 'completed',
        },
        created: false,
        taskCreated: false,
        summary: 'Planning request PR-9 is already resolved.',
      }),
    ).toEqual([
      'Request key: PR-9',
      'Task ref: P-9',
      'Created planning request: no',
      'Created planning task: no',
      'Request detail: PR-9 [resolved] Finalize rollout notes [taskRef=P-9] [decisionRefs=rollout-strategy] [updates=goal.md]',
      'Request description PR-9: Document the final rollout conclusion.',
      'Request acceptance PR-9: The rollout conclusion is durable.',
      'Request resolved at PR-9: 2026-06-04T01:00:00.000Z',
      'Request resolution PR-9: completed',
    ])
  })

  test('surfaces grouped planning creation authority', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'request_planning_batch',
        groupKey: 'auth-follow-through',
        requestKeys: ['PR-1', 'PR-2'],
        taskRefs: ['P-1', 'P-2'],
        requests: [
          {
            requestKey: 'PR-1',
            workflowSharedDecisionRefs: [],
            workflowSharedAnswers: [],
            blockedByWorkflowKeys: [],
            groupKey: 'auth-follow-through',
            groupTaskKey: 'goal-docs',
            title: 'Clarify auth goal context',
            description: 'Refresh durable Goal context before decomposition.',
            acceptanceCriteria: ['Goal context captures the auth direction.'],
            taskRef: 'P-1',
            decisionRefs: ['auth-strategy'],
            answers: [],
            requestedUpdates: ['goal.md', 'design.md'],
            status: 'open',
            createdAt: '2026-06-04T00:00:00.000Z',
          },
          {
            requestKey: 'PR-2',
            workflowSharedDecisionRefs: [],
            workflowSharedAnswers: [],
            blockedByWorkflowKeys: [],
            groupKey: 'auth-follow-through',
            groupTaskKey: 'task-graph',
            title: 'Decompose auth task graph',
            description: 'Reshape todo.yml after the goal context is stable.',
            acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
            taskRef: 'P-2',
            decisionRefs: ['auth-strategy'],
            answers: [],
            requestedUpdates: ['todo.yml'],
            status: 'open',
            createdAt: '2026-06-04T00:01:00.000Z',
          },
        ],
        blockerTaskRefs: ['P-2'],
        createdRequestKeys: ['PR-1', 'PR-2'],
        createdTaskRefs: ['P-1', 'P-2'],
        summary: 'Requested grouped planning follow-through auth-follow-through across P-1, P-2.',
      }),
    ).toEqual([
      'Group key: auth-follow-through',
      'Request keys: PR-1, PR-2',
      'Task refs: P-1, P-2',
      'Blocker task refs: P-2',
      'Created request keys: PR-1, PR-2',
      'Created task refs: P-1, P-2',
      'Request detail: PR-1 [open] Clarify auth goal context [taskRef=P-1] [groupKey=auth-follow-through] [decisionRefs=auth-strategy] [updates=goal.md, design.md]',
      'Request description PR-1: Refresh durable Goal context before decomposition.',
      'Request acceptance PR-1: Goal context captures the auth direction.',
      'Request detail: PR-2 [open] Decompose auth task graph [taskRef=P-2] [groupKey=auth-follow-through] [decisionRefs=auth-strategy] [updates=todo.yml]',
      'Request description PR-2: Reshape todo.yml after the goal context is stable.',
      'Request acceptance PR-2: The auth task graph is visible in todo.yml.',
    ])
  })

  test('surfaces single planning follow-through request authority', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'resolve_decision',
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
          createdAt: '2026-06-04T00:00:00.000Z',
          resolvedAt: '2026-06-04T00:05:00.000Z',
        },
        blockerRemoved: true,
        followThrough: {
          kind: 'planning',
          requests: [
            {
              requestKey: 'PR-1',
              workflowSharedDecisionRefs: [],
              workflowSharedAnswers: [],
              blockedByWorkflowKeys: [],
              title: 'Capture auth answer in durable docs',
              description: 'Record the auth answer across Goal docs before engineering resumes.',
              acceptanceCriteria: ['The auth answer is durable before engineering resumes.'],
              taskRef: 'P-1',
              decisionRefs: ['auth-strategy'],
              answers: [],
              requestedUpdates: ['goal.md', 'design.md', 'todo.yml'],
              status: 'open',
              createdAt: '2026-06-04T00:10:00.000Z',
            },
          ],
          requestKeys: ['PR-1'],
          taskRefs: ['P-1'],
          blockerTaskRefs: ['P-1'],
        },
        summary: 'Resolved auth-strategy and opened follow-through.',
      }),
    ).toEqual([
      'Decision key: auth-strategy',
      'Decision detail: auth-strategy [resolved] Choose the auth strategy [summaryKey=auth-strategy] [prompt=Which auth strategy should we adopt for the Bun-first runtime?] [matchHints=login path] [taskRef=T-7] [captureFormat=matching_answer_sources]',
      'Decision answer: Use Bun-native auth.',
      'Decision resolved at auth-strategy: 2026-06-04T00:05:00.000Z',
      'Decision blocker removed: yes',
      'Follow-through kind: planning',
      'Follow-through requests: PR-1',
      'Follow-through tasks: P-1',
      'Follow-through blockers: P-1',
      'Follow-through request detail: PR-1 [open] Capture auth answer in durable docs [taskRef=P-1] [decisionRefs=auth-strategy] [updates=goal.md, design.md, todo.yml]',
      'Request description PR-1: Record the auth answer across Goal docs before engineering resumes.',
      'Request acceptance PR-1: The auth answer is durable before engineering resumes.',
    ])
  })

  test('surfaces child-level follow-through workflow metadata for structured decision results', () => {
    expect(
      formatAssistantActionResultDetails({
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
          createdAt: '2026-06-04T00:00:00.000Z',
          resolvedAt: '2026-06-04T00:05:00.000Z',
        },
        blockerRemoved: true,
        summary: 'Recorded answer in decision auth-strategy and opened planner workflows.',
        followThrough: {
          kind: 'workflow_batch',
          workflowKey: 'auth-rollout-follow-through',
          requests: [
            {
              requestKey: 'PR-1',
              workflowKey: 'auth-rollout-follow-through',
              workflowTaskKey: 'rollout-notes',
              workflowSharedDecisionRefs: ['auth-strategy'],
              workflowSharedAnswers: [],
              blockedByWorkflowKeys: [],
              title: 'Capture rollout notes',
              description: 'Record rollout details before handoff.',
              acceptanceCriteria: ['Rollout notes are durable.'],
              taskRef: 'P-1',
              decisionRefs: ['auth-strategy'],
              answers: [],
              requestedUpdates: ['goal.md', 'notes/rollout.md'],
              status: 'open',
              createdAt: '2026-06-04T00:00:00.000Z',
            },
            {
              requestKey: 'PR-2',
              workflowKey: 'auth-rollout-follow-through',
              workflowSharedDecisionRefs: ['auth-strategy'],
              workflowSharedAnswers: [],
              blockedByWorkflowKeys: [],
              groupKey: 'auth-follow-through',
              groupTaskKey: 'goal-docs',
              title: 'Capture auth rollout goal context',
              description: 'Record the auth answer across Goal docs.',
              acceptanceCriteria: ['The auth answer is durable in Goal docs.'],
              taskRef: 'P-2',
              decisionRefs: ['auth-strategy'],
              answers: [],
              requestedUpdates: ['goal.md', 'design.md'],
              status: 'open',
              createdAt: '2026-06-04T00:01:00.000Z',
            },
            {
              requestKey: 'PR-3',
              workflowKey: 'auth-rollout-follow-through',
              workflowSharedDecisionRefs: ['auth-strategy'],
              workflowSharedAnswers: [],
              blockedByWorkflowKeys: [],
              groupKey: 'auth-follow-through',
              groupTaskKey: 'task-graph',
              title: 'Decompose auth task graph',
              description: 'Reflect the auth answer in todo.yml.',
              acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
              taskRef: 'P-3',
              decisionRefs: ['auth-strategy'],
              answers: [],
              requestedUpdates: ['todo.yml'],
              status: 'open',
              createdAt: '2026-06-04T00:02:00.000Z',
            },
          ],
          groupKeys: ['auth-follow-through'],
          workflows: [
            {
              kind: 'planning',
              workflowTaskKey: 'rollout-notes',
              requests: [
                {
                  requestKey: 'PR-1',
                  workflowKey: 'auth-rollout-follow-through',
                  workflowTaskKey: 'rollout-notes',
                  workflowSharedDecisionRefs: ['auth-strategy'],
                  workflowSharedAnswers: [],
                  blockedByWorkflowKeys: [],
                  title: 'Capture rollout notes',
                  description: 'Record rollout details before handoff.',
                  acceptanceCriteria: ['Rollout notes are durable.'],
                  taskRef: 'P-1',
                  decisionRefs: ['auth-strategy'],
                  answers: [],
                  requestedUpdates: ['goal.md', 'notes/rollout.md'],
                  status: 'open',
                  createdAt: '2026-06-04T00:00:00.000Z',
                },
              ],
              requestKeys: ['PR-1'],
              taskRefs: ['P-1'],
              blockerTaskRefs: ['P-1'],
            },
            {
              kind: 'planning_batch',
              groupKey: 'auth-follow-through',
              requests: [
                {
                  requestKey: 'PR-2',
                  workflowKey: 'auth-rollout-follow-through',
                  workflowSharedDecisionRefs: ['auth-strategy'],
                  workflowSharedAnswers: [],
                  blockedByWorkflowKeys: [],
                  groupKey: 'auth-follow-through',
                  groupTaskKey: 'goal-docs',
                  title: 'Capture auth rollout goal context',
                  description: 'Record the auth answer across Goal docs.',
                  acceptanceCriteria: ['The auth answer is durable in Goal docs.'],
                  taskRef: 'P-2',
                  decisionRefs: ['auth-strategy'],
                  answers: [],
                  requestedUpdates: ['goal.md', 'design.md'],
                  status: 'open',
                  createdAt: '2026-06-04T00:01:00.000Z',
                },
                {
                  requestKey: 'PR-3',
                  workflowKey: 'auth-rollout-follow-through',
                  workflowSharedDecisionRefs: ['auth-strategy'],
                  workflowSharedAnswers: [],
                  blockedByWorkflowKeys: [],
                  groupKey: 'auth-follow-through',
                  groupTaskKey: 'task-graph',
                  title: 'Decompose auth task graph',
                  description: 'Reflect the auth answer in todo.yml.',
                  acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
                  taskRef: 'P-3',
                  decisionRefs: ['auth-strategy'],
                  answers: [],
                  requestedUpdates: ['todo.yml'],
                  status: 'open',
                  createdAt: '2026-06-04T00:02:00.000Z',
                },
              ],
              requestKeys: ['PR-2', 'PR-3'],
              taskRefs: ['P-2', 'P-3'],
              blockerTaskRefs: ['P-3'],
            },
          ],
          requestKeys: ['PR-1', 'PR-2', 'PR-3'],
          taskRefs: ['P-1', 'P-2', 'P-3'],
          blockerTaskRefs: ['P-1', 'P-3'],
        },
      }),
    ).toEqual([
      'Decision key: auth-strategy',
      'Decision detail: auth-strategy [resolved] Choose the auth strategy [summaryKey=auth-strategy] [prompt=Which auth strategy should we adopt for the Bun-first runtime?] [matchHints=login path] [taskRef=T-7] [captureFormat=matching_answer_sources]',
      'Decision answer: Use Bun-native auth.',
      'Decision resolved at auth-strategy: 2026-06-04T00:05:00.000Z',
      'Decision blocker removed: yes',
      'Follow-through kind: workflow_batch',
      'Follow-through workflow key: auth-rollout-follow-through',
      'Follow-through group keys: auth-follow-through',
      'Follow-through workflow children: 2',
      'Follow-through child detail: rollout-notes -> requests PR-1 -> tasks P-1 -> blockers P-1',
      'Follow-through child request detail: rollout-notes: PR-1 [open] Capture rollout notes [taskRef=P-1] [workflowTaskKey=rollout-notes] [decisionRefs=auth-strategy] [updates=goal.md, notes/rollout.md] [workflowSharedDecisionRefs=auth-strategy]',
      'Request description PR-1: Record rollout details before handoff.',
      'Request acceptance PR-1: Rollout notes are durable.',
      'Follow-through child detail: auth-follow-through -> requests PR-2, PR-3 -> tasks P-2, P-3 -> blockers P-3',
      'Follow-through child request detail: auth-follow-through: PR-2 [open] Capture auth rollout goal context [taskRef=P-2] [groupKey=auth-follow-through] [decisionRefs=auth-strategy] [updates=goal.md, design.md] [workflowSharedDecisionRefs=auth-strategy]',
      'Request description PR-2: Record the auth answer across Goal docs.',
      'Request acceptance PR-2: The auth answer is durable in Goal docs.',
      'Follow-through child request detail: auth-follow-through: PR-3 [open] Decompose auth task graph [taskRef=P-3] [groupKey=auth-follow-through] [decisionRefs=auth-strategy] [updates=todo.yml] [workflowSharedDecisionRefs=auth-strategy]',
      'Request description PR-3: Reflect the auth answer in todo.yml.',
      'Request acceptance PR-3: The auth task graph is visible in todo.yml.',
      'Follow-through requests: PR-1, PR-2, PR-3',
      'Follow-through tasks: P-1, P-2, P-3',
      'Follow-through blockers: P-1, P-3',
    ])
  })

  test('surfaces durable preference result authority', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'record_preference',
        preferenceKey: 'prefer-bun-native-services',
        preferenceSummary:
          'Prefer Bun-native services when they meet the Goal requirements.',
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
      }),
    ).toEqual([
      'Preference key: prefer-bun-native-services',
      'Retired preference keys: prefer-deterministic-workflows',
      'Preference detail: prefer-bun-native-services [active] Prefer Bun-native services when they meet the Goal requirements. [rationale=The runtime boundary is Bun-first.]',
      'Retired preference detail: prefer-deterministic-workflows [retired] Prefer deterministic workflows. [retiredReason=Superseded by prefer-bun-native-services.] [supersededBy=prefer-bun-native-services]',
    ])

    expect(
      formatAssistantActionResultDetails({
        kind: 'retire_preference',
        preferenceKey: 'prefer-deterministic-workflows',
        reason: 'Structured workflow authority now governs deterministic execution.',
        supersededBy: 'prefer-bun-native-services',
        preference: {
          preferenceKey: 'prefer-deterministic-workflows',
          status: 'retired',
          summary: 'Prefer deterministic workflows.',
          retiredReason: 'Structured workflow authority now governs deterministic execution.',
          supersededBy: 'prefer-bun-native-services',
        },
        summary: 'Retired durable preference: prefer-deterministic-workflows',
      }),
    ).toEqual([
      'Preference key: prefer-deterministic-workflows',
      'Preference detail: prefer-deterministic-workflows [retired] Prefer deterministic workflows. [retiredReason=Structured workflow authority now governs deterministic execution.] [supersededBy=prefer-bun-native-services]',
    ])

    expect(
      formatAssistantActionResultDetails({
        kind: 'update_preference',
        content: `# Preferences

\`\`\`yaml
version: 1
preferences:
  - preferenceKey: prefer-bun-first
    status: active
    summary: Prefer Bun-first APIs.
\`\`\`
`,
        preferences: [
          {
            preferenceKey: 'prefer-bun-first',
            status: 'active',
            summary: 'Prefer Bun-first APIs.',
          },
        ],
        summary: 'Updated durable preferences.',
      }),
    ).toEqual([
      'Preference content: # Preferences ```yaml version: 1 preferences: - preferenceKey: prefer-bun-first status: active summary: Prefer Bun-first APIs. ```',
      'Preference entries: 1',
      'Preference entry detail: prefer-bun-first [active] Prefer Bun-first APIs.',
    ])
  })

  test('surfaces durable preference action authority for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
        kind: 'record_preference',
        preferenceKey: 'prefer-bun-native-services',
        summary: 'Prefer Bun-native services when they meet the Goal requirements.',
        rationale: 'The runtime boundary is Bun-first.',
        supersedes: ['prefer-deterministic-workflows'],
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
      formatAssistantActionPresentation({
        kind: 'update_preference',
        content: `# Preferences

\`\`\`yaml
version: 1
preferences:
  - preferenceKey: prefer-bun-first
    status: active
    summary: Prefer Bun-first APIs.
\`\`\`
`,
      }),
    ).toEqual({
      body: 'update_preference | Update durable preferences.',
      details: [
        'Preference content: # Preferences ```yaml version: 1 preferences: - preferenceKey: prefer-bun-first status: active summary: Prefer Bun-first APIs. ```',
      ],
    })
  })

  test('surfaces structured request-decision result authority', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'request_decision',
        decisionKey: 'auth-strategy',
        decision: {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          summaryKey: 'auth-strategy',
          prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
          matchHints: ['login path'],
          status: 'open',
          taskRef: 'P-7',
          createdAt: '2026-06-04T00:00:00.000Z',
        },
        created: true,
        blockerAdded: true,
        decisionStatus: 'open',
        summary: 'Requested decision auth-strategy and linked it to P-7.',
      }),
    ).toEqual([
      'Decision key: auth-strategy',
      'Created decision topic: yes',
      'Decision blocker added: yes',
      'Decision status: open',
      'Decision detail: auth-strategy [open] Choose the auth strategy [summaryKey=auth-strategy] [prompt=Which auth strategy should we adopt for the Bun-first runtime?] [matchHints=login path] [taskRef=P-7]',
    ])
  })

  test('surfaces structured action authority for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
        kind: 'request_planning_workflows',
        attachmentAssetPaths: [],
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
            blockedBy: [{ kind: 'decision', ref: 'release-approval' }],
          },
          {
            kind: 'planning',
            workflowTaskKey: 'handoff-review',
            blockedByWorkflowKeys: ['rollout-notes'],
            title: 'Review rollout readiness',
            description: 'Inspect rollout notes before final handoff.',
            acceptanceCriteria: ['The rollout handoff review is visible.'],
            decisionRefs: ['rollout-strategy'],
            answers: [
              {
                summary: 'Rollback trigger',
                answerKey: 'rollback-trigger',
                matchHints: [],
              },
            ],
            requestedUpdates: ['design.md'],
            blockedBy: [],
          },
        ],
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
        'Workflow child: handoff-review -> updates design.md',
        'Workflow child handoff-review title: Review rollout readiness',
        'Workflow child handoff-review description: Inspect rollout notes before final handoff.',
        'Workflow child handoff-review acceptance: The rollout handoff review is visible.',
        'Workflow child handoff-review depends on: rollout-notes',
        'Workflow child handoff-review decisions: rollout-strategy',
        'Workflow child handoff-review planner answers: 1',
        'Workflow child handoff-review planner answer detail: Rollback trigger [answerKey=rollback-trigger]',
        'Infer remaining answers: yes',
        'Action source-response format: matching_answer_sources',
      ],
    })
  })

  test('surfaces grouped planning request authority for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
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

  test('surfaces create planning task body authority for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
        kind: 'create_planning_task',
        title: 'Capture rollout notes',
        description: 'Record rollout details before implementation resumes.',
        acceptanceCriteria: ['Rollout notes are durable.'],
        blockedBy: [{ kind: 'decision', ref: 'rollout-approval' }],
      }),
    ).toEqual({
      body: 'create_planning_task | Create planning task: Capture rollout notes',
      details: [
        'Planning title: Capture rollout notes',
        'Planning description: Record rollout details before implementation resumes.',
        'Planning acceptance: Rollout notes are durable.',
        'Initial blockers: decision:rollout-approval',
      ],
    })
  })

  test('surfaces root planning blockers for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
        kind: 'request_planning',
        attachmentAssetPaths: [],
        title: 'Capture rollout notes',
        description: 'Record rollout details before more planning work continues.',
        acceptanceCriteria: ['Rollout notes are durable.'],
        decisionRefs: [],
        answers: [],
        answerSources: [],
        requestedUpdates: ['goal.md', 'notes/rollout.md'],
        blockedBy: [{ kind: 'decision', ref: 'rollout-approval' }],
      }),
    ).toEqual({
      body: 'request_planning | Request planning: Capture rollout notes',
      details: [
        'Planning title: Capture rollout notes',
        'Planning description: Record rollout details before more planning work continues.',
        'Planning acceptance: Rollout notes are durable.',
        'Planning blockers: decision:rollout-approval',
        'Requested durable updates: goal.md, notes/rollout.md',
      ],
    })
  })

  test('surfaces workflow child grouped request detail for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
        kind: 'request_planning_workflows',
        attachmentAssetPaths: [],
        workflowKey: 'auth-rollout-follow-through',
        reuseGroupKey: 'auth-follow-through',
        decisionRefs: ['auth-strategy'],
        answers: [{ summary: 'Pilot scope', answerKey: 'pilot-scope', matchHints: [] }],
        answerSources: [],
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

  test('surfaces reusable answer-source details for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
        kind: 'resolve_decision',
        attachmentAssetPaths: [],
        decisionKey: 'auth-strategy',
        summaryKey: 'auth-strategy',
        prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
        matchHints: ['login path'],
        answerSources: [
          {
            answerSourceKey: 'auth-strategy-source',
            sourceGroupKey: 'auth-answer',
            route: 'decision',
            decisionKey: 'auth-strategy',
            summaryKey: 'auth-strategy',
            summary: 'Chosen auth strategy',
            prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
            matchHints: ['login path'],
            sourceExcerpt: 'Use Bun-native auth for the first rollout.',
            sourceOccurrence: 1,
          },
        ],
        sourceResponseFormat: 'matching_answer_sources',
      }),
    ).toEqual({
      body: 'resolve_decision | Resolve decision auth-strategy.',
      details: [
        'Decision key: auth-strategy',
        'Summary key: auth-strategy',
        'Decision prompt: Which auth strategy should we adopt for the Bun-first runtime?',
        'Match hints: login path',
        'Reusable answer sources: 1',
        'Reusable answer source detail: auth-strategy-source [sourceGroupKey=auth-answer] [route=decision] [decisionKey=auth-strategy] [summaryKey=auth-strategy] [summary=Chosen auth strategy] [prompt=Which auth strategy should we adopt for the Bun-first runtime?] [matchHints=login path] [sourceExcerpt=Use Bun-native auth for the first rollout.] [sourceOccurrence=1]',
        'Action source-response format: matching_answer_sources',
      ],
    })
  })

  test('surfaces direct decision-answer details for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
        kind: 'resolve_decision',
        attachmentAssetPaths: [],
        decisionKey: 'auth-strategy',
        summary: 'Choose the auth strategy',
        summaryKey: 'auth-strategy',
        prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
        matchHints: ['login path'],
        sourceExcerpt: 'Use Bun-native auth for the first rollout.',
        sourceOccurrence: 1,
        answerSources: [],
        sourceResponseFormat: 'matching_answer_sources',
      }),
    ).toEqual({
      body: 'resolve_decision | Resolve decision auth-strategy.',
      details: [
        'Decision key: auth-strategy',
        'Summary key: auth-strategy',
        'Decision prompt: Which auth strategy should we adopt for the Bun-first runtime?',
        'Match hints: login path',
        'Decision answer detail: Choose the auth strategy [decisionKey=auth-strategy] [summaryKey=auth-strategy] [prompt=Which auth strategy should we adopt for the Bun-first runtime?] [matchHints=login path] [sourceExcerpt=Use Bun-native auth for the first rollout.] [sourceOccurrence=1]',
        'Action source-response format: matching_answer_sources',
      ],
    })
  })

  test('surfaces grouped planning follow-through request authority for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
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

  test('surfaces follow-through workflow child grouped request detail for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
        kind: 'record_answer',
        attachmentAssetPaths: [],
        summary: 'Choose the auth strategy',
        answer: 'Use Bun-native auth.',
        matchHints: [],
        answerSources: [],
        followThrough: {
          kind: 'workflow_batch',
          workflowKey: 'auth-rollout-follow-through',
          answers: [],
          workflows: [
            {
              kind: 'planning_batch',
              groupKey: 'auth-follow-through',
              blockedByWorkflowKeys: ['rollout-notes'],
              answers: [],
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
          ],
        },
      }),
    ).toEqual({
      body: 'record_answer | Record answer with 1 planner workflows.',
      details: [
        'Decision answer detail: Choose the auth strategy: Use Bun-native auth.',
        'Follow-through kind: workflow_batch',
        'Follow-through workflow key: auth-rollout-follow-through',
        'Follow-through workflow child: auth-follow-through -> requests goal-docs, task-graph',
        'Follow-through workflow child auth-follow-through grouped request: goal-docs -> updates goal.md, design.md',
        'Follow-through workflow child auth-follow-through grouped request goal-docs title: Clarify auth goal context',
        'Follow-through workflow child auth-follow-through grouped request goal-docs description: Refresh durable Goal context before decomposition.',
        'Follow-through workflow child auth-follow-through grouped request goal-docs acceptance: Goal context captures the auth direction.',
        'Follow-through workflow child auth-follow-through grouped request: task-graph -> updates todo.yml',
        'Follow-through workflow child auth-follow-through grouped request task-graph title: Decompose auth task graph',
        'Follow-through workflow child auth-follow-through grouped request task-graph description: Reshape todo.yml after the goal context is stable.',
        'Follow-through workflow child auth-follow-through grouped request task-graph acceptance: The auth task graph is visible in todo.yml.',
        'Follow-through workflow child auth-follow-through grouped request task-graph blockers: task:T-9',
        'Follow-through workflow child auth-follow-through grouped request task-graph depends on: goal-docs',
        'Follow-through workflow child auth-follow-through depends on: rollout-notes',
      ],
    })
  })

  test('surfaces structured runtime-event authority for assistant run inspection', () => {
    expect(
      formatAssistantEventPresentation({
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_call',
        summary: 'Tool call: Bash (bun test packages/backend/tests/server.test.ts)',
        toolName: 'Bash',
        toolInvocationKey: 'shell-1',
        vendorEventType: 'item/completed',
      }),
    ).toEqual({
      body: 'codex tool_call: Tool call: Bash (bun test packages/backend/tests/server.test.ts)',
      details: [
        'Tool name: Bash',
        'Tool invocation key: shell-1',
        'Vendor event type: item/completed',
      ],
    })
  })

  test('surfaces worktree-prepared event authority for assistant run inspection', () => {
    expect(
      formatAssistantEventPresentation({
        kind: 'worktree_prepared',
        path: '.hopi/worktrees/test/T-1',
        branch: 'task/T-1',
        baseBranch: 'main',
      }),
    ).toEqual({
      body: 'Worktree prepared: .hopi/worktrees/test/T-1',
      details: ['Worktree branch: task/T-1', 'Worktree base branch: main'],
    })
  })
})
