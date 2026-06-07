import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createAssistantThreadStore } from '../src/runtime/assistantThreadStore'

const goalKey = 'goal-1'
const tmpBase = join(process.cwd(), 'tests', 'tmp', 'assistant-thread-store')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createAssistantThreadStore', () => {
  test('reads a missing Goal assistant thread as empty runtime state', async () => {
    const store = createAssistantThreadStore(testRoot())

    await expect(store.readThread(goalKey)).resolves.toEqual({
      goalKey,
      entries: [],
    })
  })

  test('appends user and assistant messages to the assistant thread', async () => {
    const store = createAssistantThreadStore(testRoot())

    await store.appendUserMessage(goalKey, 'Please plan the auth work.')
    await store.appendEntry(goalKey, {
      kind: 'assistant_message',
      content: 'I will create visible planning work before any engineering tasks.',
    })

    await expect(store.readThread(goalKey)).resolves.toMatchObject({
      goalKey,
      entries: [
        { kind: 'user_message', content: 'Please plan the auth work.' },
        {
          kind: 'assistant_message',
          content: 'I will create visible planning work before any engineering tasks.',
        },
      ],
    })
  })

  test('persists structured assistant action-result authority in the assistant thread', async () => {
    const store = createAssistantThreadStore(testRoot())

    await store.appendEntry(goalKey, {
      kind: 'action_result',
      actionType: 'request_planning',
      summary: 'Requested planning follow-through in PR-1 for P-1.',
      result: {
        kind: 'request_planning',
        requestKey: 'PR-1',
        taskRef: 'P-1',
        request: {
          requestKey: 'PR-1',
          workflowSharedDecisionRefs: [],
          workflowSharedAnswers: [],
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
          requestedUpdates: ['goal.md', 'design.md'],
          status: 'open',
          createdAt: '2026-06-04T00:00:00.000Z',
        },
        created: true,
        taskCreated: true,
        resolvedSourceResponseFormat: 'matching_answer_sources',
        summary: 'Requested planning follow-through in PR-1 for P-1.',
      },
    })

    await expect(store.readThread(goalKey)).resolves.toMatchObject({
      goalKey,
      entries: [
        {
          kind: 'action_result',
          actionType: 'request_planning',
          summary: 'Requested planning follow-through in PR-1 for P-1.',
          result: {
            kind: 'request_planning',
            requestKey: 'PR-1',
            taskRef: 'P-1',
            request: {
              requestKey: 'PR-1',
              title: 'Capture rollout notes',
              decisionRefs: ['rollout-strategy'],
              requestedUpdates: ['goal.md', 'design.md'],
            },
            created: true,
            taskCreated: true,
            resolvedSourceResponseFormat: 'matching_answer_sources',
            summary: 'Requested planning follow-through in PR-1 for P-1.',
          },
        },
      ],
    })
  })

  test('persists structured task-result authority in the assistant thread', async () => {
    const store = createAssistantThreadStore(testRoot())

    await store.appendEntry(goalKey, {
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
    })

    await store.appendEntry(goalKey, {
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
    })

    await expect(store.readThread(goalKey)).resolves.toMatchObject({
      goalKey,
      entries: [
        {
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
              blockedBy: [{ kind: 'decision', ref: 'rollout-approval' }],
            },
            summary: 'Created planning task P-9.',
          },
        },
        {
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
              blockedBy: [{ kind: 'decision', ref: 'release-approval' }],
            },
            summary: 'Moved P-7 to in_review.',
          },
        },
      ],
    })
  })

  test('persists structured preference-result authority in the assistant thread', async () => {
    const store = createAssistantThreadStore(testRoot())

    await store.appendEntry(goalKey, {
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
    })

    await store.appendEntry(goalKey, {
      kind: 'action_result',
      actionType: 'retire_preference',
      summary: 'Retired durable preference: prefer-deterministic-workflows',
      result: {
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
      },
    })

    await store.appendEntry(goalKey, {
      kind: 'action_result',
      actionType: 'update_preference',
      summary: 'Updated durable preferences.',
      result: {
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
      },
    })

    await expect(store.readThread(goalKey)).resolves.toMatchObject({
      goalKey,
      entries: [
        {
          kind: 'action_result',
          actionType: 'record_preference',
          result: {
            kind: 'record_preference',
            preferenceKey: 'prefer-bun-native-services',
            preferenceSummary: 'Prefer Bun-native services when they meet the Goal requirements.',
            rationale: 'The runtime boundary is Bun-first.',
            preference: {
              preferenceKey: 'prefer-bun-native-services',
              status: 'active',
              summary: 'Prefer Bun-native services when they meet the Goal requirements.',
            },
            retiredPreferences: [
              {
                preferenceKey: 'prefer-deterministic-workflows',
                status: 'retired',
                summary: 'Prefer deterministic workflows.',
                supersededBy: 'prefer-bun-native-services',
              },
            ],
            retiredPreferenceKeys: ['prefer-deterministic-workflows'],
          },
        },
        {
          kind: 'action_result',
          actionType: 'retire_preference',
          result: {
            kind: 'retire_preference',
            preferenceKey: 'prefer-deterministic-workflows',
            reason: 'Structured workflow authority now governs deterministic execution.',
            supersededBy: 'prefer-bun-native-services',
            preference: {
              preferenceKey: 'prefer-deterministic-workflows',
              status: 'retired',
              summary: 'Prefer deterministic workflows.',
              supersededBy: 'prefer-bun-native-services',
            },
          },
        },
        {
          kind: 'action_result',
          actionType: 'update_preference',
          result: {
            kind: 'update_preference',
            content: expect.stringContaining('preferenceKey: prefer-bun-first'),
            preferences: [
              {
                preferenceKey: 'prefer-bun-first',
                status: 'active',
                summary: 'Prefer Bun-first APIs.',
              },
            ],
          },
        },
      ],
    })
  })

  test('persists structured assistant action authority in the assistant thread', async () => {
    const store = createAssistantThreadStore(testRoot())

    await store.appendEntry(goalKey, {
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
    })

    await expect(store.readThread(goalKey)).resolves.toMatchObject({
      goalKey,
      entries: [
        {
          kind: 'action',
          actionType: 'request_planning',
          summary: 'Request planning: Capture rollout notes',
          action: {
            kind: 'request_planning',
            title: 'Capture rollout notes',
            sourceResponseFormat: 'matching_answer_sources',
            requestedUpdates: ['goal.md', 'notes/rollout.md'],
          },
        },
      ],
    })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
