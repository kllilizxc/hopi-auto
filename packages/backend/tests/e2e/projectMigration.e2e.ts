import assert from 'node:assert/strict'
import { mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { RoleRunner } from '../../src/agent/RoleRunner'
import { createAssistantConversationStore } from '../../src/assistant/assistantConversationStore'
import type { AssistantModelRunner } from '../../src/assistant/workspaceAssistant'
import { projectReleaseRef } from '../../src/domain/project'
import { type MvpServer, createServer } from '../../src/mvpServer'
import { PublicationCoordinator } from '../../src/publication/publisher'
import { createMvpRuntime } from '../../src/runtime/mvpRuntime'
import { createAssistantHomeStore } from '../../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../../src/storage/assistantWorkspaceStore'
import { createGoalPackageStore } from '../../src/storage/goalPackageStore'
import {
  checkoutSnapshot,
  errorMessage,
  finishTestRun,
  gitOutput,
  ownTestRunServer,
  requestJson,
  startTestRun,
} from '../live/liveHarness'

const SCENARIO = 'project-home-migration'
const PROJECT_ID = 'P-migration'
const GOAL_ID = 'G-migration'
const testRun = await startTestRun(SCENARIO, 'contract')
const sourceMachine = join(testRun.artifactRoot, 'source-machine')
const destinationMachine = join(testRun.artifactRoot, 'destination-machine')
const sourceHome = join(sourceMachine, 'home')
const sourceWeb = join(sourceMachine, 'web')
const sourceApi = join(sourceMachine, 'api')
const movedHome = join(destinationMachine, 'home')
const movedWeb = join(destinationMachine, 'web')
const movedApi = join(destinationMachine, 'api')
const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
let server: MvpServer | null = null
let restarted: MvpServer | null = null
let serverCleanup: ReturnType<typeof ownTestRunServer> | null = null
let restartedCleanup: ReturnType<typeof ownTestRunServer> | null = null

try {
  await initializeRepo(sourceWeb, 'web')
  await initializeRepo(sourceApi, 'api')
  const webBefore = await checkoutSnapshot(sourceWeb)
  const apiBefore = await checkoutSnapshot(sourceApi)
  const homeStore = createAssistantHomeStore(sourceHome)
  const linked = await homeStore.linkProject({
    projectId: PROJECT_ID,
    primaryRepoId: 'web',
    repos: [
      { repoId: 'web', repoPath: sourceWeb },
      { repoId: 'api', repoPath: sourceApi },
    ],
  })
  const releaseBefore = {
    web: await gitOutput(sourceWeb, ['rev-parse', projectReleaseRef(PROJECT_ID)]),
    api: await gitOutput(sourceApi, ['rev-parse', projectReleaseRef(PROJECT_ID)]),
  }
  const runtime = await createMvpRuntime({ homeRoot: sourceHome, start: false })
  const request = await runtime.workspace.receiveEvent({
    eventId: 'EV-migration-create',
    content: 'Create a portable migration Goal from this reference image.',
    images: [new File([imageBytes], 'reference.png', { type: 'image/png' })],
  })
  const attachmentRef = request.attributes.attachments[0]
  assert.ok(attachmentRef)
  await runtime.assistantTools.executeForEvent(request.attributes.id, 'hopi_create_goal', {
    projectId: PROJECT_ID,
    goalId: GOAL_ID,
    title: 'Preserve migration state',
    objective: 'Keep the complete portable Project state valid after Home and Repo paths move.',
    firstWork: { kind: 'planning' },
    references: [
      { attachmentRef, purpose: 'Preserve this exact visual reference across migration.' },
    ],
  })
  await runtime.workspace.handleEvent(request.attributes.id, {
    reply: 'Migration Goal created.',
    disposition: 'tools-used',
  })
  const design = await runtime.workspace.receiveEvent({
    eventId: 'EV-migration-design',
    content: 'Record the migration acceptance in design.',
    context: { projectId: PROJECT_ID, goalId: GOAL_ID },
  })
  await runtime.assistantTools.executeForEvent(design.attributes.id, 'hopi_write_design', {
    projectId: PROJECT_ID,
    goalId: GOAL_ID,
    changes: [
      {
        kind: 'document',
        path: 'migration.md',
        content:
          '# Migration\n\nPreserve identity, provenance, release refs, and local rebind safety.\n',
      },
    ],
  })
  await runtime.workspace.handleEvent(design.attributes.id, {
    reply: 'Migration design recorded.',
    disposition: 'tools-used',
  })
  const attention = await runtime.attentions.ensureProjectAttention(
    PROJECT_ID,
    'Repository paths must be rebound after the machine move.',
  )
  await runtime.workspace.markAttentionNotified(attention.attributes.id)
  await runtime.assistantConversation.writeSession({
    transport: 'codex',
    sessionId: 'migration-session',
  })
  const sourceHomeDocument = await runtime.home.readHome()
  const sourceGoalStore = createGoalPackageStore(
    linked.integrationRoot,
    PROJECT_ID,
    new PublicationCoordinator(),
  )
  const sourcePackage = await sourceGoalStore.readPackage(GOAL_ID)
  assert.equal(sourcePackage.inputs.length, 2)
  await runtime.coordinator.stop()
  await runtime.preview.stopAll()

  await rename(sourceMachine, destinationMachine)
  assert.equal(await exists(sourceHome), false)
  assert.equal(await exists(sourceWeb), false)
  assert.equal(await exists(sourceApi), false)

  let responsibilityRuns = 0
  const roleRunner: RoleRunner = {
    async run() {
      responsibilityRuns += 1
      throw new Error('Migration must not dispatch responsibility work before recovery')
    },
  }
  const silentAssistant: AssistantModelRunner = {
    async run() {
      return { reply: '', session: { transport: 'codex', sessionId: 'migration-silent' } }
    },
  }
  server = createServer({
    rootDir: movedHome,
    port: 0,
    roleRunner,
    assistantRunner: silentAssistant,
    reflectionRunner: silentAssistant,
  })
  serverCleanup = ownTestRunServer(testRun, server)
  const baseUrl = `http://127.0.0.1:${server.port}`
  const blocked = await requestJson<StateView>(baseUrl, '/api/state')
  assert.equal(blocked.activeRuns.length, 0)
  assert.equal(responsibilityRuns, 0)
  assert.equal(
    blocked.attentions.find((candidate) => candidate.id === attention.attributes.id)?.resolvedAt,
    null,
  )
  const linksPath = join(movedHome, '.hopi', 'projects.yml')
  const linksBefore = await Bun.file(linksPath).text()
  const partial = await fetch(`${baseUrl}/api/projects/${PROJECT_ID}/rebind`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repos: [{ repoId: 'web', repoPath: movedWeb }] }),
  })
  assert.equal(partial.ok, false)
  assert.match(await partial.text(), /complete Repo set/)
  assert.equal(await Bun.file(linksPath).text(), linksBefore)

  const rebound = await requestJson<StateView>(baseUrl, `/api/projects/${PROJECT_ID}/rebind`, {
    method: 'POST',
    body: {
      repos: [
        { repoId: 'web', repoPath: movedWeb },
        { repoId: 'api', repoPath: movedApi },
      ],
    },
  })
  const reboundProject = rebound.projects.find((project) => project.projectId === PROJECT_ID)
  assert.ok(reboundProject)
  assert.deepEqual(
    reboundProject.repos.map((repo) => ({ repoId: repo.repoId, repoPath: repo.repoPath })),
    [
      { repoId: 'web', repoPath: movedWeb },
      { repoId: 'api', repoPath: movedApi },
    ],
  )
  await Bun.sleep(1_200)
  assert.equal(responsibilityRuns, 0)
  await serverCleanup.run()
  server = null

  const migratedWorkspace = createAssistantWorkspaceStore(movedHome, new PublicationCoordinator())
  await migratedWorkspace.resolveAttention(
    attention.attributes.id,
    'All stable Repo IDs were rebound and validated together.',
  )
  restarted = createServer({ rootDir: movedHome, port: 0, startCoordinator: false })
  restartedCleanup = ownTestRunServer(testRun, restarted)
  const durable = await requestJson<StateView>(`http://127.0.0.1:${restarted.port}`, '/api/state')
  const migratedHomeStore = createAssistantHomeStore(movedHome)
  const migratedHomeDocument = await migratedHomeStore.readHome()
  const migratedProject = await migratedHomeStore.validateProject(PROJECT_ID)
  const migratedGoalStore = createGoalPackageStore(
    migratedProject.integrationRoot,
    PROJECT_ID,
    new PublicationCoordinator(),
  )
  const migratedPackage = await migratedGoalStore.readPackage(GOAL_ID)
  const migratedRequest = await migratedWorkspace.readEvent(request.attributes.id)
  const migratedAttachment = await migratedWorkspace.resolveAttachment(attachmentRef)
  const migratedSession = await createAssistantConversationStore(movedHome).readSession()

  assert.equal(migratedHomeDocument.homeId, sourceHomeDocument.homeId)
  assert.equal(migratedPackage.goal.attributes.id, GOAL_ID)
  assert.equal(migratedPackage.goal.attributes.contractRevision, 1)
  assert.equal(migratedPackage.inputs.length, sourcePackage.inputs.length)
  assert.deepEqual(
    [...migratedPackage.works.values()].map((work) => ({
      id: work.attributes.id,
      dependsOn: work.attributes.dependsOn,
    })),
    [...sourcePackage.works.values()].map((work) => ({
      id: work.attributes.id,
      dependsOn: work.attributes.dependsOn,
    })),
  )
  assert.match(
    await Bun.file(
      migratedGoalStore.paths.absolute(
        `${migratedGoalStore.paths.designRoot(GOAL_ID)}/migration.md`,
      ),
    ).text(),
    /Preserve identity/,
  )
  assert.match(
    await Bun.file(
      migratedGoalStore.paths.absolute(
        `${migratedGoalStore.paths.designRoot(GOAL_ID)}/references.md`,
      ),
    ).text(),
    /Preserve this exact visual/,
  )
  assert.equal(migratedRequest?.attributes.reply, 'Migration Goal created.')
  assert.deepEqual(
    migratedAttachment
      ? new Uint8Array(await Bun.file(migratedAttachment.absolutePath).arrayBuffer())
      : null,
    imageBytes,
  )
  assert.deepEqual(
    migratedSession,
    { transport: 'codex', sessionId: 'migration-session' },
    'Disposable Reflection runs must not replace the persistent speaking Session',
  )
  assert.ok(
    durable.attentions.some(
      (candidate) => candidate.id === attention.attributes.id && candidate.resolvedAt,
    ),
  )
  assert.deepEqual(
    {
      web: await gitOutput(movedWeb, ['rev-parse', projectReleaseRef(PROJECT_ID)]),
      api: await gitOutput(movedApi, ['rev-parse', projectReleaseRef(PROJECT_ID)]),
    },
    releaseBefore,
  )
  assert.deepEqual(await checkoutSnapshot(movedWeb), webBefore)
  assert.deepEqual(await checkoutSnapshot(movedApi), apiBefore)

  await Bun.write(
    join(testRun.artifactRoot, 'migration-contract.json'),
    `${JSON.stringify(
      {
        status: 'passed',
        sourceHomeId: sourceHomeDocument.homeId,
        projectId: PROJECT_ID,
        goalId: GOAL_ID,
        attentionId: attention.attributes.id,
        attachmentRef,
        releaseBefore,
        rebound: reboundProject,
        durable,
      },
      null,
      2,
    )}\n`,
  )
  await finishTestRun(testRun, 'passed', {
    paths: { home: movedHome, web: movedWeb, api: movedApi },
    resultFile: 'migration-contract.json',
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  })
  console.log(`HOPI-E2E-030 Project/Home migration passed: ${testRun.artifactRoot}`)
} catch (error) {
  await finishTestRun(testRun, 'failed', {
    paths: { home: movedHome, web: movedWeb, api: movedApi },
    error: errorMessage(error),
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  console.error(`HOPI-E2E-030 Project/Home migration failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${testRun.artifactRoot}`)
  process.exitCode = 1
} finally {
  await restartedCleanup?.run()
  await serverCleanup?.run()
}

async function initializeRepo(root: string, name: string) {
  await mkdir(root, { recursive: true })
  await Bun.write(join(root, 'README.md'), `# ${name}\n`)
  await gitOutput(root, ['init', '-b', 'main'])
  await gitOutput(root, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(root, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(root, ['add', '.'])
  await gitOutput(root, ['commit', '-m', `initial ${name}`])
}

async function exists(path: string) {
  return Boolean(await stat(path).catch(() => null))
}

interface StateView {
  projects: Array<{
    projectId: string
    repos: Array<{ repoId: string; repoPath: string }>
  }>
  attentions: Array<{ id: string; resolvedAt: string | null }>
  activeRuns: Array<unknown>
}
