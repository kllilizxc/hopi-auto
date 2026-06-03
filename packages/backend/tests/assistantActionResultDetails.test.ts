import { describe, expect, test } from 'bun:test'
import {
  formatAssistantActionPresentation,
  formatAssistantActionResultDetails,
  formatAssistantEventPresentation,
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
      'Workflow child detail: rollout-notes -> requests PR-1 -> tasks P-1 -> blockers P-1',
      'Workflow child detail: auth-follow-through -> requests PR-2, PR-3 -> tasks P-2, P-3 -> blockers P-3',
      'Request keys: PR-1, PR-2, PR-3',
      'Task refs: P-1, P-2, P-3',
      'Blocker task refs: P-1, P-3',
      'Resolved source-response format: matching_answer_sources',
    ])
  })

  test('surfaces child-level follow-through workflow metadata for structured decision results', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'record_answer',
        decisionKey: 'auth-strategy',
        blockerRemoved: true,
        summary: 'Recorded answer in decision auth-strategy and opened planner workflows.',
        followThrough: {
          kind: 'workflow_batch',
          workflowKey: 'auth-rollout-follow-through',
          groupKeys: ['auth-follow-through'],
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
        },
      }),
    ).toEqual([
      'Decision key: auth-strategy',
      'Decision blocker removed: yes',
      'Follow-through kind: workflow_batch',
      'Follow-through workflow key: auth-rollout-follow-through',
      'Follow-through group keys: auth-follow-through',
      'Follow-through workflow children: 2',
      'Follow-through child detail: rollout-notes -> requests PR-1 -> tasks P-1 -> blockers P-1',
      'Follow-through child detail: auth-follow-through -> requests PR-2, PR-3 -> tasks P-2, P-3 -> blockers P-3',
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
        'Reusable answer sources: 1',
        'Workflow child: rollout-notes -> updates goal.md, notes/rollout.md',
        'Workflow child: handoff-review -> updates design.md',
        'Workflow child handoff-review depends on: rollout-notes',
        'Workflow child handoff-review decisions: rollout-strategy',
        'Workflow child handoff-review planner answers: 1',
        'Infer remaining answers: yes',
        'Action source-response format: matching_answer_sources',
      ],
    })
  })

  test('surfaces grouped planning request authority for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
        kind: 'request_planning_batch',
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
            blockedBy: [],
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
        'Reusable answer sources: 1',
        'Grouped request: goal-docs -> updates goal.md, design.md',
        'Grouped request: task-graph -> updates todo.yml',
        'Grouped request task-graph depends on: goal-docs',
      ],
    })
  })

  test('surfaces grouped planning follow-through request authority for assistant run inspection', () => {
    expect(
      formatAssistantActionPresentation({
        kind: 'record_answer',
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
              blockedBy: [],
              blockedByTaskKeys: ['goal-docs'],
            },
          ],
        },
      }),
    ).toEqual({
      body: 'record_answer | Record answer with grouped planning follow-through auth-follow-through.',
      details: [
        'Follow-through kind: planning_batch',
        'Follow-through group key: auth-follow-through',
        'Follow-through grouped request: goal-docs -> updates goal.md, design.md',
        'Follow-through grouped request: task-graph -> updates todo.yml',
        'Follow-through grouped request task-graph depends on: goal-docs',
        'Follow-through shared planner answers: 1',
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
