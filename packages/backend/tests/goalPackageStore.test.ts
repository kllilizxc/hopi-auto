import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseWorkDocument,
  renderInputDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { GoalPackageValidationError } from '../src/domain/goalPackage'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import type { PublicationRoot } from '../src/publication/types'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'goal-package-store')
const map = `## Destination

Choose the durable execution model.

## Notes

Keep one publication path.

## Decisions so far

## Not yet specified

How source changes should be reviewed.

## Out of scope

UI polish.
`

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(() => rm(temporaryRoot, { recursive: true, force: true }))

describe('GoalPackageStore', () => {
  test('creates a Decision-first Goal as Map plus exactly one Decision Work', async () => {
    const store = setup()
    const goalPackage = await store.createGoal({
      goalId: 'G-1',
      title: 'Choose the execution model',
      objective: 'Reach one durable execution model.',
      mapMarkdown: map,
      firstWork: {
        id: 'W-boundary',
        title: 'Choose the publication boundary',
        kind: 'decision',
        decisionType: 'grilling',
        question: 'Which component alone may publish accepted source changes?',
      },
      createdAt: '2026-08-14T00:00:00.000Z',
    })

    expect([...goalPackage.works]).toHaveLength(1)
    expect(goalPackage.works.get('W-boundary')?.attributes).toMatchObject({
      kind: 'decision',
      decisionType: 'grilling',
      status: 'open',
      createdAt: '2026-08-14T00:00:00.000Z',
    })
    expect(goalPackage.works.get('W-boundary')?.body).toContain('## Question')
    expect(await Bun.file(store.paths.absolute(store.paths.designIndex('G-1'))).text()).toBe(map)
  })

  test('creates a clear Goal directly with one Engineering Work and no Map', async () => {
    const store = setup()
    const goalPackage = await store.createGoal({
      goalId: 'G-direct',
      title: 'Fix route copy',
      objective: 'Correct one known label.',
      firstWork: {
        id: 'W-fix',
        title: 'Correct the route label',
        kind: 'engineering',
        objective: 'Replace the incorrect label.',
        acceptanceCriteria: ['The Route view shows the accepted wording.'],
      },
      createdAt: '2026-08-14T00:00:00.000Z',
    })

    expect(goalPackage.works.get('W-fix')?.attributes.kind).toBe('engineering')
    expect(await Bun.file(store.paths.absolute(store.paths.designIndex('G-direct'))).exists()).toBe(
      false,
    )
  })

  test('rejects inconsistent first-Work and Map shapes', async () => {
    const store = setup()
    await expect(
      store.createGoal({
        goalId: 'G-no-map',
        title: 'Unclear Goal',
        objective: 'Find a route.',
        firstWork: {
          id: 'W-question',
          title: 'Resolve scope',
          kind: 'decision',
          decisionType: 'research',
          question: 'What is the supported scope?',
        },
      }),
    ).rejects.toThrow('requires mapMarkdown')
    await expect(
      store.createGoal({
        goalId: 'G-extra-map',
        title: 'Clear Goal',
        objective: 'Make the known change.',
        mapMarkdown: map,
        firstWork: engineering('W-known'),
      }),
    ).rejects.toThrow('does not create a Map')
  })

  test('rejects a Map that drifts from the one Wayfinder document shape', async () => {
    const store = setup()

    await expect(
      store.createGoal({
        goalId: 'G-invalid-map',
        title: 'Explore a route',
        objective: 'Resolve the unknowns.',
        mapMarkdown: map.replace('## Not yet specified', '## Open questions'),
        firstWork: {
          id: 'W-research',
          title: 'Research the boundary',
          kind: 'decision',
          decisionType: 'research',
          question: 'What boundary is supported?',
        },
      }),
    ).rejects.toThrow('Wayfinder Map must contain exactly these ordered headings')
  })

  test('enforces the DAG and terminal Work immutability', async () => {
    const store = setup()
    await store.createGoal({
      goalId: 'G-1',
      title: 'Ship route',
      objective: 'Ship the route.',
      firstWork: engineering('W-1'),
      createdAt: '2026-08-14T00:00:00.000Z',
    })
    await publishNewWork(store, 'G-1', engineeringDocument('W-2', ['W-1']))
    await expect(
      publishNewWork(store, 'G-1', engineeringDocument('W-cycle', ['W-cycle'])),
    ).rejects.toThrow('Work dependency cycle')

    const path = store.paths.workDocument('G-1', 'W-1')
    const source = await Bun.file(store.paths.absolute(path)).text()
    const completed = parseWorkDocument(source)
    completed.attributes.status = 'done'
    await publishReplacement(store, 'G-1', path, source, completed)
    const terminalSource = await Bun.file(store.paths.absolute(path)).text()
    const rewritten = parseWorkDocument(terminalSource)
    rewritten.body += '\nRewritten after completion.\n'
    await expect(publishReplacement(store, 'G-1', path, terminalSource, rewritten)).rejects.toThrow(
      'terminal Work is immutable',
    )
  })

  test('keeps accepted Inputs byte-immutable', async () => {
    const store = setup()
    await store.createGoal({
      goalId: 'G-1',
      title: 'Ship route',
      objective: 'Ship the route.',
      firstWork: engineering('W-1'),
    })
    const path = store.paths.inputDocument('G-1', 'H-1', 'EV-1')
    const content = renderInputDocument({
      attributes: {
        sourceHomeId: 'H-1',
        sourceEventId: 'EV-1',
        sourceDigest: 'a'.repeat(64),
        attachments: [],
      },
      body: 'Original words.\n',
    })
    await store.publishGoal('G-1', {
      supportingWrites: [{ path, expectedHash: null, content }],
    })
    await expect(
      store.publishGoal('G-1', {
        supportingWrites: [
          {
            path,
            expectedHash: await hashBytes(new TextEncoder().encode(content)),
            content: content.replace('Original', 'Rewritten'),
          },
        ],
      }),
    ).rejects.toBeInstanceOf(GoalPackageValidationError)
  })

  test('caches a reconciliation snapshot until publication advances', async () => {
    const publisher = new CountingPublicationCoordinator()
    const writer = createGoalPackageStore(temporaryRoot, 'P-1', publisher)
    await writer.createGoal({
      goalId: 'G-1',
      title: 'Ship route',
      objective: 'Ship the route.',
      firstWork: engineering('W-1'),
    })
    const reader = createGoalPackageStore(temporaryRoot, 'P-1', publisher)
    publisher.snapshotTreeReads = 0
    const [first, concurrent] = await Promise.all([
      reader.readReconciliationSnapshot(),
      reader.readReconciliationSnapshot(),
    ])
    expect(concurrent).toBe(first)
    expect(publisher.snapshotTreeReads).toBe(1)

    await publisher.publish({
      root: reader.paths.publicationRoot,
      supportingWrites: [
        {
          path: `${reader.paths.designRoot('G-1')}/notes.md`,
          expectedHash: null,
          content: '# Notes\n',
        },
      ],
      validateCandidate() {},
    })
    await reader.readReconciliationSnapshot()
    expect(publisher.snapshotTreeReads).toBe(2)
  })
})

function setup() {
  return createGoalPackageStore(temporaryRoot, 'P-1', new PublicationCoordinator())
}

function engineering(id: string) {
  return {
    id,
    title: `Build ${id}`,
    kind: 'engineering' as const,
    objective: `Implement ${id}.`,
    acceptanceCriteria: [`${id} is verified.`],
  }
}

function engineeringDocument(id: string, dependsOn: string[] = []) {
  return {
    attributes: {
      id,
      title: `Build ${id}`,
      kind: 'engineering' as const,
      status: 'open' as const,
      createdAt: '2026-08-14T00:00:00.000Z',
      notBefore: null,
      dependsOn,
      contractRevision: 1,
      evidenceRefs: [],
      contextRefs: [],
      ownerMessages: [],
    },
    body: `Implement ${id}.\n`,
  }
}

async function publishNewWork(
  store: ReturnType<typeof createGoalPackageStore>,
  goalId: string,
  work: ReturnType<typeof engineeringDocument>,
) {
  return store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path: store.paths.workDocument(goalId, work.attributes.id),
      expectedHash: null,
      content: renderWorkDocument(work),
    },
  })
}

async function publishReplacement(
  store: ReturnType<typeof createGoalPackageStore>,
  goalId: string,
  path: string,
  source: string,
  work: ReturnType<typeof parseWorkDocument>,
) {
  return store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderWorkDocument(work),
    },
  })
}

class CountingPublicationCoordinator extends PublicationCoordinator {
  snapshotTreeReads = 0

  override snapshotTreeAtGeneration(root: PublicationRoot, prefix = '') {
    this.snapshotTreeReads += 1
    return super.snapshotTreeAtGeneration(root, prefix)
  }
}
