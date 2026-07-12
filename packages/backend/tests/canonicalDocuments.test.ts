import { describe, expect, test } from 'bun:test'
import {
  parseAttentionDocument,
  parseEvidenceDocument,
  parseGoalDocument,
  parseInputDocument,
  parseWorkDocument,
  renderAttentionDocument,
  renderEvidenceDocument,
  renderGoalDocument,
  renderInputDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { MarkdownDocumentError } from '../src/domain/markdownDocument'

describe('canonical Markdown documents', () => {
  test('round-trips minimal Goal and Work control fields with free Markdown bodies', () => {
    const goalSource = renderGoalDocument({
      attributes: {
        id: 'G-1',
        title: 'Ship the MVP',
        lifecycle: 'active',
        priority: 10,
        contractRevision: 1,
        completionAttentionId: null,
      },
      body: '## Objective\n\nShip the documented MVP.\n',
    })
    const workSource = renderWorkDocument({
      attributes: {
        id: 'W-1',
        title: 'Plan the Goal',
        kind: 'planning',
        stage: 'plan',
        notBefore: null,
        dependsOn: [],
        contractRevision: 1,
        evidenceRefs: [],
        attempts: 0,
      },
      body: '## Objective\n\nClarify and plan.\n',
    })

    expect(parseGoalDocument(goalSource)).toMatchObject({
      attributes: { id: 'G-1', lifecycle: 'active', completionAttentionId: null },
      body: '## Objective\n\nShip the documented MVP.\n',
    })
    expect(parseWorkDocument(workSource)).toMatchObject({
      attributes: { id: 'W-1', kind: 'planning', stage: 'plan' },
      body: '## Objective\n\nClarify and plan.\n',
    })
  })

  test('round-trips Input, Attention, and Evidence without semantic action fields', () => {
    const input = parseInputDocument(
      renderInputDocument({
        attributes: {
          sourceHomeId: 'H-1',
          sourceEventId: 'EV-1',
          sourceDigest: 'a'.repeat(64),
          attachments: ['asset:requirements.png'],
        },
        body: 'Implement the accepted design exactly.\n',
      }),
    )
    const attention = parseAttentionDocument(
      renderAttentionDocument({
        attributes: {
          id: 'A-1',
          target: 'project:P-1/goal:G-1/work:W-1',
          createdAt: '2026-07-11T00:00:00Z',
          resolvedAt: null,
          notifiedAt: null,
        },
        body: '## Needs you\n\nChoose the storage format.\n',
      }),
    )
    const evidence = parseEvidenceDocument(
      renderEvidenceDocument({
        attributes: {
          id: 'E-1',
          createdAt: '2026-07-11T00:00:00Z',
          producerRun: 'project:P-1/goal:G-1/work:W-1/run:R-1',
          coordinatorCheck: null,
          owner: 'project:P-1/goal:G-1/work:W-1',
          artifacts: ['artifact:test-log'],
        },
        body: '## Verification\n\nAll focused checks pass.\n',
      }),
    )

    expect(input.attributes).not.toHaveProperty('actions')
    expect(attention.attributes).not.toHaveProperty('evidenceRefs')
    expect(evidence.attributes.producerRun).toContain('/run:R-1')
  })

  test('rejects illegal discriminators and duplicated control references', () => {
    expect(() =>
      parseGoalDocument(`---
id: G-1
title: Goal
lifecycle: active
priority: 0
contractRevision: 1
completionAttentionId: A-1
---
Body
`),
    ).toThrow('completionAttentionId')

    expect(() =>
      parseWorkDocument(`---
id: W-1
title: Plan
kind: planning
stage: generate
notBefore: null
dependsOn: []
contractRevision: 1
evidenceRefs: []
attempts: 0
---
Body
`),
    ).toThrow(MarkdownDocumentError)

    expect(() =>
      parseWorkDocument(`---
id: W-1
title: Build
kind: engineering
stage: generate
notBefore: null
dependsOn: [W-0, W-0]
contractRevision: 1
evidenceRefs: []
attempts: 0
---
Body
`),
    ).toThrow('references must be unique')
  })

  test('requires exactly one Evidence producer authority', () => {
    const source = `---
id: E-1
createdAt: 2026-07-11T00:00:00Z
producerRun: null
coordinatorCheck: null
owner: project:P-1/goal:G-1
artifacts: []
---
Body
`

    expect(() => parseEvidenceDocument(source)).toThrow(
      'exactly one producerRun or coordinatorCheck',
    )
  })
})
