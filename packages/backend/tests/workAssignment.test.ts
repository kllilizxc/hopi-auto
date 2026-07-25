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
    },
    body: '## Acceptance Criteria\n\n- Deliver the current contract.\n',
  }
  const initial = await workAssignmentHash(work)
  const withHistory = await workAssignmentHash({
    ...work,
    attributes: {
      ...work.attributes,
      evidenceRefs: ['E-R-1', 'E-R-2'],
    },
  })
  const revised = await workAssignmentHash({
    ...work,
    body: '## Acceptance Criteria\n\n- Deliver the revised contract.\n',
  })
  const withOwnerMessage = await workAssignmentHash({
    ...work,
    body: appendProjectOwnerMessage(work.body, {
      recordedAt: '2026-07-25T00:00:00.000Z',
      sourceEventId: 'EV-guidance',
      content: 'Use the verified API command.',
    }),
  })

  expect(withHistory).toBe(initial)
  expect(withOwnerMessage).toBe(initial)
  expect(revised).not.toBe(initial)
})
