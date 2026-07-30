import { describe, expect, test } from 'bun:test'
import {
  parseEvidenceDocument,
  parseHistoricalWorkDocument,
  parseWorkDocument,
  renderEvidenceDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { MarkdownDocumentError } from '../src/domain/markdownDocument'

const common = {
  status: 'open' as const,
  createdAt: '2026-08-14T00:00:00Z',
  notBefore: null,
  dependsOn: [],
  contractRevision: 1,
  evidenceRefs: [],
  contextRefs: [],
  ownerMessages: [],
}

describe('canonical Wayfinder documents', () => {
  test('round-trips Decision and Engineering Work without stages', () => {
    const decision = parseWorkDocument(
      renderWorkDocument({
        attributes: {
          ...common,
          id: 'W-question',
          title: 'Choose storage',
          kind: 'decision',
          decisionType: 'grilling',
        },
        body: '## Question\n\nWhich durability boundary matters?\n',
      }),
    )
    const engineering = parseWorkDocument(
      renderWorkDocument({
        attributes: { ...common, id: 'W-build', title: 'Build it', kind: 'engineering' },
        body: '## Objective\n\nBuild the accepted design.\n',
      }),
    )

    expect(decision.attributes).toMatchObject({ kind: 'decision', decisionType: 'grilling' })
    expect(engineering.attributes).toMatchObject({ kind: 'engineering', status: 'open' })
    expect(decision.attributes).not.toHaveProperty('stage')
  })

  test('requires Task mode and rejects unsupported Work kinds', () => {
    expect(() =>
      parseWorkDocument(
        renderWorkDocument({
          attributes: {
            ...common,
            id: 'W-task',
            title: 'Manual prerequisite',
            kind: 'decision',
            decisionType: 'task',
          } as never,
          body: '## Question\n\nComplete the prerequisite.\n',
        }),
      ),
    ).toThrow('Task Decision requires taskMode')
    expect(() =>
      parseWorkDocument('---\nid: W-unknown\ntitle: Unknown\nkind: analysis\n---\nUnknown\n'),
    ).toThrow(MarkdownDocumentError)
  })

  test('normalizes only the known immutable historical Work form', () => {
    const historicalSource = `---
id: W-1
title: Build
kind: engineering
status: done
createdAt: 2026-08-14T00:00:00Z
notBefore: null
dependsOn: []
contractRevision: 1
evidenceRefs: [E-1]
---
Body
`

    expect(() => parseWorkDocument(historicalSource)).toThrow('contextRefs: Required')
    expect(parseHistoricalWorkDocument(historicalSource)).toMatchObject({
      attributes: {
        id: 'W-1',
        contextRefs: [],
        ownerMessages: [],
      },
      body: 'Body\n',
    })
    expect(() =>
      parseHistoricalWorkDocument(
        historicalSource.replace('evidenceRefs: [E-1]\n', 'evidenceRefs: [E-1]\ncontextRefs: []\n'),
      ),
    ).toThrow('ownerMessages: Required')
  })

  test('requires exactly one Evidence producer authority', () => {
    expect(() =>
      parseEvidenceDocument(
        renderEvidenceDocument({
          attributes: {
            id: 'E-1',
            createdAt: '2026-08-14T00:00:00Z',
            producerRun: null,
            coordinatorCheck: null,
            owner: 'project:P-1/goal:G-1',
            artifacts: [],
          },
          body: 'Evidence.\n',
        }),
      ),
    ).toThrow('exactly one producerRun or coordinatorCheck')
  })
})
