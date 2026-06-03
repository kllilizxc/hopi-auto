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
    expect(context).toContain('Follow-through infers remaining answers: yes')
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
