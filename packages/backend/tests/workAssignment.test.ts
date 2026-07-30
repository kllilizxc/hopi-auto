import { expect, test } from 'bun:test'
import type { WorkDocument } from '../src/domain/canonicalDocuments'
import { appendProjectOwnerMessage, workAssignmentHash } from '../src/runtime/workAssignment'

test('Work assignment fingerprint ignores Evidence history but changes with executable authority', async () => {
  const work: WorkDocument = {
    attributes: {
      id: 'W-1',
      title: 'Build the feature',
      kind: 'engineering',
      stage: 'generate',
      notBefore: null,
      dependsOn: [],
      contractRevision: 1,
      evidenceRefs: [],
      contextRefs: [],
      ownerMessages: [],
    },
    body: '## Acceptance Criteria\n\n- Deliver the current contract.\n',
  }
  const initial = await workAssignmentHash(work)
  const withHistory = await workAssignmentHash({
    ...work,
    attributes: {
      ...work.attributes,
      evidenceRefs: ['E-R-1', 'E-R-2'],
      contextRefs: [],
      ownerMessages: [],
    },
  })
  const revised = await workAssignmentHash({
    ...work,
    body: '## Acceptance Criteria\n\n- Deliver the revised contract.\n',
  })
  const withOwnerMessage = await workAssignmentHash({
    ...work,
    attributes: {
      ...work.attributes,
      ownerMessages: [
        ...appendProjectOwnerMessage(work.attributes.ownerMessages, {
          recordedAt: '2026-07-25T00:00:00.000Z',
          sourceEventId: 'EV-guidance',
          content: 'Use the verified API command.',
        }),
      ],
    },
  })

  expect(withHistory).toBe(initial)
  expect(withOwnerMessage).toBe(initial)
  expect(revised).not.toBe(initial)
})

test('Project Owner messages are idempotent by source event', () => {
  const message = {
    recordedAt: '2026-07-25T00:00:00.000Z',
    sourceEventId: 'EV-guidance',
    content: 'Use the verified API command.',
  }
  const first = appendProjectOwnerMessage([], message)

  expect(appendProjectOwnerMessage(first, message)).toBe(first)
  expect(() =>
    appendProjectOwnerMessage(first, {
      ...message,
      content: 'Use a different command.',
    }),
  ).toThrow('Project Owner message already exists for EV-guidance')
})
