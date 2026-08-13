import assert from 'node:assert/strict'
import { mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { RoleRunner } from '../../src/agent/RoleRunner'
import { assistantThreadScopeForEvent } from '../../src/assistant/assistantConversationScope'
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

const SCENARIO = 'project-home-relocation'
const PROJECT_ID = 'P-relocation'
const GOAL_ID = 'G-relocation'
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
  const runtime = await createMvpRuntime({
    homeRoot: sourceHome,
    assistantToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    onProjectTopologyChanged() {},
    start: false,
  })
  const request = await runtime.workspace.receiveEvent({
    eventId: 'EV-relocation-create',
    content: 'Create a portable relocation Goal from this reference image.',
    images: [new File([imageBytes], 'reference.png', { type: 'image/png' })],
  })
  const attachmentRef = request.attributes.attachments[0]
  assert.ok(attachmentRef)
  await runtime.assistantTools.executeForEvent(request.attributes.id, 'hopi_create_goal', {
    projectId: PROJECT_ID,
    goalId: GOAL_ID,
    title: 'Preserve relocation state',
    objective: 'Keep the complete portable Project state valid after Home and Repo paths move.',
    firstWork: { kind: 'planning' },
    references: [
      { attachmentRef, purpose: 'Preserve this exact visual reference across relocation.' },
    ],
  })
  await runtime.workspace.handleEvent(request.attributes.id, {
    reply: 'Relocation Goal created.',
    disposition: 'tools-used',
  })
  const design = await runtime.workspace.receiveEvent({
    eventId: 'EV-relocation-design',
    content: 'Record the relocation acceptance in design.',
    context: { projectId: PROJECT_ID, goalId: GOAL_ID },
  })
  await runtime.assistantTools.executeForEvent(design.attributes.id, 'hopi_write_design', {
    projectId: PROJECT_ID,
    goalId: GOAL_ID,
    changes: [
      {
        kind: 'document',
        path: 'relocation.md',
        content:
          '# Relocation\n\nPreserve identity, provenance, release refs, and local rebind safety.\n',
      },
    ],
  })
  await runtime.workspace.handleEvent(design.attributes.id, {
    reply: 'Relocation design recorded.',
    disposition: 'tools-used',
  })
  const attention = await runtime.attentions.ensureProjectAttention(
    PROJECT_ID,
    'Repository paths must be rebound after the machine move.',
  )
  const requestThread = assistantThreadScopeForEvent(request)
  await runtime.assistantConversation.ensureThread({
    threadId: requestThread.threadId,
    createdAt: request.attributes.receivedAt,
    origin: {
      eventId: request.attributes.id,
      projectId: PROJECT_ID,
      goalId: GOAL_ID,
    },
    eventIds: [request.attributes.id],
  })
  await runtime.assistantConversation.writeSession(requestThread, {
    transport: 'codex',
    sessionId: 'relocation-session',
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
      throw new Error('Relocation must not dispatch responsibility work before recovery')
    },
  }
  const silentAssistant: AssistantModelRunner = {
    async run() {
      return { reply: '', session: { transport: 'codex', sessionId: 'relocation-silent' } }
    },
  }
  server = createServer({
    rootDir: movedHome,
    port: 0,
    roleRunner,
    assistantRunner: silentAssistant,
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

  const relocatedWorkspace = createAssistantWorkspaceStore(movedHome, new PublicationCoordinator())
  await relocatedWorkspace.resolveAttention(
    attention.attributes.id,
    'All stable Repo IDs were rebound and validated together.',
  )
  restarted = createServer({ rootDir: movedHome, port: 0, startCoordinator: false })
  restartedCleanup = ownTestRunServer(testRun, restarted)
  const durable = await requestJson<StateView>(`http://127.0.0.1:${restarted.port}`, '/api/state')
  const relocatedHomeStore = createAssistantHomeStore(movedHome)
  const relocatedHomeDocument = await relocatedHomeStore.readHome()
  const relocatedProject = await relocatedHomeStore.validateProject(PROJECT_ID)
  const relocatedGoalStore = createGoalPackageStore(
    relocatedProject.integrationRoot,
    PROJECT_ID,
    new PublicationCoordinator(),
  )
  const relocatedPackage = await relocatedGoalStore.readPackage(GOAL_ID)
  const relocatedRequest = await relocatedWorkspace.readEvent(request.attributes.id)
  const relocatedAttachment = await relocatedWorkspace.resolveAttachment(attachmentRef)
  const relocatedSession =
    await createAssistantConversationStore(movedHome).readSession(requestThread)

  assert.equal(relocatedHomeDocument.homeId, sourceHomeDocument.homeId)
  assert.equal(relocatedPackage.goal.attributes.id, GOAL_ID)
  assert.equal(relocatedPackage.goal.attributes.contractRevision, 1)
  assert.equal(relocatedPackage.inputs.length, sourcePackage.inputs.length)
  assert.deepEqual(
    [...relocatedPackage.works.values()].map((work) => ({
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
      relocatedGoalStore.paths.absolute(
        `${relocatedGoalStore.paths.designRoot(GOAL_ID)}/relocation.md`,
      ),
    ).text(),
    /Preserve identity/,
  )
  const relocatedReference = [...relocatedPackage.works.values()]
    .flatMap((work) => work.attributes.contextRefs)
    .find((reference) => reference.purpose.includes('Preserve this exact visual'))
  assert.ok(relocatedReference)
  assert.deepEqual(
    new Uint8Array(
      await Bun.file(relocatedGoalStore.paths.absolute(relocatedReference.path)).arrayBuffer(),
    ),
    imageBytes,
  )
  assert.equal(relocatedRequest?.attributes.reply, 'Relocation Goal created.')
  assert.deepEqual(
    relocatedAttachment
      ? new Uint8Array(await Bun.file(relocatedAttachment.absolutePath).arrayBuffer())
      : null,
    imageBytes,
  )
  assert.deepEqual(
    relocatedSession,
    { transport: 'codex', sessionId: 'relocation-session' },
    'Disposable Wake runs must not replace the persistent speaking Session',
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
    join(testRun.artifactRoot, 'relocation-contract.json'),
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
    resultFile: 'relocation-contract.json',
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  })
  console.log(`HOPI-E2E-030 Project/Home relocation passed: ${testRun.artifactRoot}`)
} catch (error) {
  await finishTestRun(testRun, 'failed', {
    paths: { home: movedHome, web: movedWeb, api: movedApi },
    error: errorMessage(error),
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  console.error(`HOPI-E2E-030 Project/Home relocation failed: ${errorMessage(error)}`)
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
