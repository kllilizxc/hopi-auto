import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createGoalAssistantContextBuilder } from '../src/assistant/goalAssistantContext'
import { createAssistantThreadStore } from '../src/runtime/assistantThreadStore'
import type { GoalAttachmentRef } from '../src/storage/goalAttachmentStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'goal-assistant-context')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createGoalAssistantContextBuilder', () => {
  test('pins high-risk assistant action literals in the generated prompt', async () => {
    const rootDir = testRoot()
    const builder = createGoalAssistantContextBuilder(rootDir)

    const bundle = await builder.prepareBundle({
      goalKey: 'goal-1',
      assistantRunId: 'assistant-run-1',
    })

    const prompt = await readFile(bundle.promptFile, 'utf8')
    expect(prompt).toContain('Allowed request_planning.mode literals: single | batch | workflow')
    expect(prompt).toContain(
      'Allowed retry_task.clearBlockers.kind literals: intervention | merge_conflict',
    )
    expect(prompt).toContain(
      'Allowed blockedBy.kind literals anywhere in assistant actions: task | decision | merge_conflict | intervention',
    )
    expect(prompt).toContain(
      'Allowed followThrough.kind literals: planning | planning_batch | workflow_batch',
    )
    expect(prompt).toContain(
      'Allowed workflow child kind literals inside request_planning workflow mode or workflow_batch followThrough: planning | planning_batch',
    )
    expect(prompt).toContain(
      'Allowed set_preference.mode literals: upsert | retire',
    )
    expect(prompt).toContain(
      'Use only five public action families: retry_task, request_planning, request_decision, resolve_decisions, set_preference.',
    )
    expect(prompt).toContain(
      'Use retry_task only when the user explicitly asks to retry or resume a blocked task.',
    )
    expect(prompt).toContain(
      'retry_task may clear only retryable blockers and resets that task\'s retry budget. It must not bypass task or decision blockers.',
    )
    expect(prompt).toContain(
      'For UI, screenshot, visual, interaction, keyboard/IME, routing, responsive, or browser-visible work, request planning should tell planner to include Browser Harness acceptance criteria that either reference an existing project scenario or explicitly require the engineering task to create/update one under scripts/hopi/browser-harness/**.',
    )
    expect(prompt).toContain(
      "You may call Browser Harness with `browser-harness <<'PY' ... PY` to inspect visible UI state before shaping a planning request or decision.",
    )
    expect(prompt).toContain(
      'Prefer existing project scenarios under `scripts/hopi/browser-harness/scenarios/*.py`; do not create or edit scenario scripts from the assistant.',
    )
  })

  test('surfaces current uploaded images and absolute image files in the assistant bundle', async () => {
    const rootDir = testRoot()
    const builder = createGoalAssistantContextBuilder(rootDir)
    const attachments: GoalAttachmentRef[] = [
      {
        assetPath: 'assets/assistant/upload-1/layout.png',
        fileName: 'layout.png',
        mediaType: 'image/png',
        sizeBytes: 4,
        createdAt: '2026-06-14T00:00:00.000Z',
      },
    ]

    const bundle = await builder.prepareBundle({
      goalKey: 'goal-1',
      assistantRunId: 'assistant-run-1',
      attachments,
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    expect(context).toContain('Current Uploaded Images')
    expect(context).toContain('assets/assistant/upload-1/layout.png')
    expect(context).toContain('layout.png')
    expect(bundle.imageFiles).toEqual([
      join(
        rootDir,
        '.hopi',
        'docs',
        'goals',
        'goal-1',
        'assets',
        'assistant',
        'upload-1',
        'layout.png',
      ),
    ])
  })

  test('surfaces richer structured action authority in recent assistant thread context', async () => {
    const rootDir = testRoot()
    const threadStore = createAssistantThreadStore(rootDir)

    await threadStore.appendEntry('goal-1', {
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
        createdRequestKeys: ['PR-1', 'PR-2', 'PR-3'],
        createdTaskRefs: ['P-1', 'P-2', 'P-3'],
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
    expect(context).toContain('Created request keys: PR-1, PR-2, PR-3')
    expect(context).toContain('Created task refs: P-1, P-2, P-3')
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
