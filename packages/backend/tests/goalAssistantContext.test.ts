import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createGoalAssistantContextBuilder } from '../src/assistant/goalAssistantContext'
import { createAssistantThreadStore } from '../src/runtime/assistantThreadStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'goal-assistant-context')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createGoalAssistantContextBuilder', () => {
  test('surfaces richer structured action authority in recent assistant thread context', async () => {
    const rootDir = testRoot()
    const threadStore = createAssistantThreadStore(rootDir)

    await threadStore.appendEntry('goal-1', {
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
    })

    const builder = createGoalAssistantContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-1',
      assistantRunId: 'assistant-run-1',
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    expect(context).toContain('Capture shared rollout answers')
    expect(context).toContain('Infer open decisions: yes')
    expect(context).toContain('Infer decision topics: yes')
    expect(context).toContain('Reusable answer sources: 2')
    expect(context).toContain('Follow-through workflow key: auth-rollout-follow-through')
    expect(context).toContain('Follow-through reusable group key: auth-follow-through')
    expect(context).toContain(
      'Follow-through workflow child: rollout-notes -> updates goal.md, notes/rollout.md',
    )
    expect(context).toContain('Follow-through workflow child: handoff-review -> updates design.md')
    expect(context).toContain(
      'Follow-through workflow child handoff-review depends on: rollout-notes',
    )
    expect(context).toContain('Follow-through workflow child handoff-review planner answers: 1')
    expect(context).toContain('Follow-through infers remaining answers: yes')
  })

  test('surfaces grouped planning request authority in recent assistant thread context', async () => {
    const rootDir = testRoot()
    const threadStore = createAssistantThreadStore(rootDir)

    await threadStore.appendEntry('goal-1', {
      kind: 'action',
      actionType: 'request_planning_batch',
      summary: 'Request grouped planning: auth-follow-through',
      action: {
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
      },
    })

    const builder = createGoalAssistantContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-1',
      assistantRunId: 'assistant-run-1',
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    expect(context).toContain('Request grouped planning: auth-follow-through')
    expect(context).toContain('Planning group key: auth-follow-through')
    expect(context).toContain('Linked decisions: auth-strategy')
    expect(context).toContain('Shared planner answers: 1')
    expect(context).toContain('Reusable answer sources: 1')
    expect(context).toContain('Grouped request: goal-docs -> updates goal.md, design.md')
    expect(context).toContain('Grouped request: task-graph -> updates todo.yml')
    expect(context).toContain('Grouped request task-graph depends on: goal-docs')
  })

  test('surfaces grouped planning follow-through request authority in recent assistant thread context', async () => {
    const rootDir = testRoot()
    const threadStore = createAssistantThreadStore(rootDir)

    await threadStore.appendEntry('goal-1', {
      kind: 'action',
      actionType: 'record_answer',
      summary: 'Record answer with grouped planning follow-through auth-follow-through.',
      action: {
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
      },
    })

    const builder = createGoalAssistantContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-1',
      assistantRunId: 'assistant-run-1',
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    expect(context).toContain(
      'Record answer with grouped planning follow-through auth-follow-through.',
    )
    expect(context).toContain('Follow-through group key: auth-follow-through')
    expect(context).toContain(
      'Follow-through grouped request: goal-docs -> updates goal.md, design.md',
    )
    expect(context).toContain('Follow-through grouped request: task-graph -> updates todo.yml')
    expect(context).toContain('Follow-through grouped request task-graph depends on: goal-docs')
    expect(context).toContain('Follow-through shared planner answers: 1')
  })

  test('surfaces richer structured action-result authority in recent assistant thread context', async () => {
    const rootDir = testRoot()
    const threadStore = createAssistantThreadStore(rootDir)

    await threadStore.appendEntry('goal-1', {
      kind: 'action_result',
      actionType: 'request_planning_workflows',
      summary: 'Opened auth rollout workflows.',
      result: {
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
      },
    })

    const builder = createGoalAssistantContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-1',
      assistantRunId: 'assistant-run-1',
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    expect(context).toContain('Opened auth rollout workflows.')
    expect(context).toContain('Workflow key: auth-rollout-follow-through')
    expect(context).toContain('Workflow group keys: auth-follow-through, rollout-follow-through')
    expect(context).toContain(
      'Workflow child detail: rollout-notes -> requests PR-1 -> tasks P-1 -> blockers P-1',
    )
    expect(context).toContain(
      'Workflow child detail: auth-follow-through -> requests PR-2, PR-3 -> tasks P-2, P-3 -> blockers P-3',
    )
    expect(context).toContain('Request keys: PR-1, PR-2, PR-3')
    expect(context).toContain('Task refs: P-1, P-2, P-3')
    expect(context).toContain('Blocker task refs: P-1, P-3')
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
