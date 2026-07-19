import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { $ } from 'bun'
import {
  goalAttentionReference,
  workspaceAttentionReference,
} from '../src/domain/attentionReference'
import { renderAttentionDocument } from '../src/domain/canonicalDocuments'
import { PublicationCoordinator } from '../src/publication/publisher'
import { migrateLegacyAttentionOwnership } from '../src/runtime/attentionOwnershipMigration'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../src/storage/assistantWorkspaceStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'attention-ownership-migration')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

test('backfills legacy delivered blockers while preserving explicit Assistant ownership', async () => {
  const repoRoot = join(temporaryRoot, 'repo')
  await initializeGitRepo(repoRoot)
  const homeRoot = join(temporaryRoot, 'home')
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(homeRoot, publisher)
  const linked = await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
  const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
  const store = createGoalPackageStore(linked.integrationRoot, 'P-1', publisher)
  await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
  const homeId = (await workspace.readWorkspace()).homeId
  await workspace.createAttention({
    attributes: {
      id: 'A-workspace-legacy',
      target: 'project:P-1',
      createdAt: '2026-07-18T00:00:00Z',
      resolvedAt: null,
      notifiedAt: '2026-07-18T00:01:00Z',
    },
    body: 'Legacy Project request.\n',
  })
  await store.publishGoal('G-1', {
    supportingWrites: [
      {
        path: store.paths.attentionDocument('G-1', 'A-goal-legacy'),
        expectedHash: null,
        content: renderAttentionDocument({
          attributes: {
            id: 'A-goal-legacy',
            target: 'project:P-1/goal:G-1',
            createdAt: '2026-07-18T00:00:00Z',
            resolvedAt: null,
            notifiedAt: '2026-07-18T00:01:00Z',
          },
          body: 'Legacy Goal request.\n',
        }),
      },
      {
        path: store.paths.attentionDocument('G-1', 'A-goal-informational'),
        expectedHash: null,
        content: renderAttentionDocument({
          attributes: {
            id: 'A-goal-informational',
            target: 'project:P-1/goal:G-1',
            createdAt: '2026-07-18T00:00:00Z',
            resolvedAt: null,
            notifiedAt: '2026-07-18T00:01:00Z',
            operatorRequest: null,
          },
          body: 'Explicit informational delivery.\n',
        }),
      },
    ],
  })
  const references = [
    workspaceAttentionReference(homeId, 'A-workspace-legacy'),
    goalAttentionReference('P-1', 'G-1', 'A-goal-legacy'),
    goalAttentionReference('P-1', 'G-1', 'A-goal-informational'),
  ]
  const event = await workspace.receiveReflectionEvent({
    eventId: 'EV-legacy-request',
    content: 'Legacy speaking handoff.',
    context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: references },
  })
  await workspace.handleEvent(event.attributes.id, {
    reply: 'Legacy operator message.',
    disposition: 'tools-used',
    expose: true,
  })

  expect(
    await migrateLegacyAttentionOwnership({
      workspace,
      projects: new Map([['P-1', { store }]]),
    }),
  ).toBe(2)
  const expectedRequest = `home:${homeId}/event:EV-legacy-request`
  expect(
    (await workspace.readWorkspace()).attentions.get('A-workspace-legacy')?.attributes
      .operatorRequest,
  ).toBe(expectedRequest)
  const goalPackage = await store.readPackage('G-1')
  expect(goalPackage.attentions.get('A-goal-legacy')?.attributes.operatorRequest).toBe(
    expectedRequest,
  )
  expect(goalPackage.attentions.get('A-goal-informational')?.attributes.operatorRequest).toBeNull()
  expect(
    await migrateLegacyAttentionOwnership({
      workspace,
      projects: new Map([['P-1', { store }]]),
    }),
  ).toBe(0)
})

async function initializeGitRepo(repoRoot: string) {
  await mkdir(repoRoot, { recursive: true })
  await $`git init -b main`.cwd(repoRoot).quiet()
  await $`git config user.email hopi@example.invalid`.cwd(repoRoot).quiet()
  await $`git config user.name HOPI`.cwd(repoRoot).quiet()
  await Bun.write(join(repoRoot, 'README.md'), '# Project\n')
  await $`git add README.md`.cwd(repoRoot).quiet()
  await $`git commit -m initial`.cwd(repoRoot).quiet()
}
