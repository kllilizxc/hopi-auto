import { expect, test } from 'bun:test'
import type { WorkDocument } from '../src/domain/canonicalDocuments'
import {
  appendProjectOwnerMessage,
  currentSettledWorkIds,
  workAssignmentHash,
} from '../src/runtime/workAssignment'

const work: WorkDocument = {
  attributes: {
    id: 'W-1',
    title: 'Build the feature',
    kind: 'engineering',
    status: 'open',
    createdAt: '2026-08-14T00:00:00Z',
    notBefore: null,
    dependsOn: [],
    contractRevision: 1,
    evidenceRefs: [],
    contextRefs: [],
    ownerMessages: [],
  },
  body: '## Acceptance Criteria\n\n- Deliver the current contract.\n',
}

test('assignment hash ignores evidence and messages but changes with executable authority', async () => {
  const initial = await workAssignmentHash(work)
  expect(
    await workAssignmentHash({
      ...work,
      attributes: {
        ...work.attributes,
        evidenceRefs: ['E-1'],
        ownerMessages: [
          {
            recordedAt: '2026-08-14T00:00:00Z',
            sourceEventId: 'EV-1',
            content: 'Historical note.',
          },
        ],
      },
    }),
  ).toBe(initial)
  expect(
    await workAssignmentHash({ ...work, body: `${work.body}\n- New requirement.\n` }),
  ).not.toBe(initial)
})

test('owner messages are idempotent by source event', () => {
  const message = {
    recordedAt: '2026-08-14T00:00:00Z',
    sourceEventId: 'EV-1',
    content: 'Use the verified API.',
  }
  const first = appendProjectOwnerMessage([], message)
  expect(appendProjectOwnerMessage(first, message)).toBe(first)
  expect(() => appendProjectOwnerMessage(first, { ...message, content: 'Different.' })).toThrow()
})

test('only a settled Attempt for the current Work authority waits for Assistant', async () => {
  const currentHash = await workAssignmentHash(work)
  const changed = { ...work, body: `${work.body}\n- Changed authority.\n` }
  const attempt = {
    projectId: 'P-1',
    goalId: 'G-1',
    workId: 'W-1',
    runId: 'R-1',
    workspaceMode: 'isolated_write' as const,
    instructionMarkdown: 'Deliver the Work.',
    refs: [],
    workHash: currentHash,
    execution: null,
    requestedAt: '2026-08-14T00:00:00Z',
    startedAt: '2026-08-14T00:00:01Z',
    endedAt: '2026-08-14T00:00:02Z',
    status: 'settled' as const,
    termination: 'normal' as const,
    reportMarkdown: 'Delivered.',
    exitCode: 0,
    candidateCommits: [],
  }

  expect(await currentSettledWorkIds([work], new Map([['W-1', [attempt]]]))).toEqual(
    new Set(['W-1']),
  )
  expect(await currentSettledWorkIds([changed], new Map([['W-1', [attempt]]]))).toEqual(new Set())
})
