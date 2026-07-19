import assert from 'node:assert/strict'
import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { type MvpServer, createServer } from '../../src/mvpServer'
import {
  checkoutSnapshot,
  configureProjectInBrowser,
  errorMessage,
  finishTestRun,
  gitOutput,
  ownTestRunServer,
  rebindProjectInBrowser,
  requestJson,
  startTestRun,
} from '../live/liveHarness'

const SCENARIO = 'configuration-rebind'
const PROJECT_ID = 'P-web'
const testRun = await startTestRun(SCENARIO, 'browser')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const primaryRoot = join(artifactRoot, 'web')
const duplicatePrimaryRoot = join(artifactRoot, 'web-duplicate')
const secondaryRoot = join(artifactRoot, 'api')
const movedSecondaryRoot = join(artifactRoot, 'api-moved')
let server: MvpServer | null = null
let restarted: MvpServer | null = null
let serverCleanup: ReturnType<typeof ownTestRunServer> | null = null
let restartedCleanup: ReturnType<typeof ownTestRunServer> | null = null

try {
  await initializeRepo(primaryRoot)
  await initializeRepo(secondaryRoot)
  await gitOutput(primaryRoot, [
    'worktree',
    'add',
    '-b',
    'duplicate-selection',
    duplicatePrimaryRoot,
    'HEAD',
  ])
  const primaryBefore = await checkoutSnapshot(primaryRoot)
  const secondaryBefore = await checkoutSnapshot(secondaryRoot)
  const selections: Array<string | null> = [null, primaryRoot, duplicatePrimaryRoot, secondaryRoot]
  server = createServer({
    rootDir: homeRoot,
    port: 0,
    directoryPicker: async () => selections.shift() ?? null,
  })
  serverCleanup = ownTestRunServer(testRun, server)
  const baseUrl = `http://127.0.0.1:${server.port}`
  const browserConfiguration = await configureProjectInBrowser(
    { scenario: SCENARIO, artifactRoot, baseUrl },
    {
      projectId: PROJECT_ID,
      primaryRepoId: 'web',
      primaryRepoPath: primaryRoot,
      duplicateRepoPath: duplicatePrimaryRoot,
      secondaryRepoId: 'api',
      secondaryRepoPath: secondaryRoot,
      assistantModel: 'gpt-5.4',
      generatorModel: 'claude-sonnet-4-6',
    },
  )
  await rename(secondaryRoot, movedSecondaryRoot)
  const browserRebind = await rebindProjectInBrowser(
    { scenario: SCENARIO, artifactRoot, baseUrl },
    {
      projectId: PROJECT_ID,
      repoId: 'api',
      repoPath: movedSecondaryRoot,
      assistantModel: 'gpt-5.4',
      generatorModel: 'claude-sonnet-4-6',
    },
  )
  const rebound = await requestJson<StateView>(baseUrl, '/api/state')
  assertState(rebound)
  assert.deepEqual(await checkoutSnapshot(primaryRoot), primaryBefore)
  assert.deepEqual(await checkoutSnapshot(movedSecondaryRoot), secondaryBefore)
  await serverCleanup.run()
  server = null
  restarted = createServer({ rootDir: homeRoot, port: 0 })
  restartedCleanup = ownTestRunServer(testRun, restarted)
  const durable = await requestJson<StateView>(`http://127.0.0.1:${restarted.port}`, '/api/state')
  assertState(durable)
  await Bun.write(
    join(artifactRoot, 'configuration-rebind-contract.json'),
    `${JSON.stringify({ status: 'passed', startedAt, browserConfiguration, browserRebind, rebound, durable }, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'passed', {
    paths: { home: homeRoot, primary: primaryRoot, secondary: secondaryRoot },
    resultFile: 'configuration-rebind-contract.json',
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  })
  console.log(`HOPI-E2E-020 configuration/rebind passed: ${artifactRoot}`)
} catch (error) {
  await Bun.write(
    join(artifactRoot, 'configuration-rebind-contract.json'),
    `${JSON.stringify({ status: 'failed', startedAt, error: errorMessage(error) }, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'failed', {
    paths: { home: homeRoot, primary: primaryRoot, secondary: secondaryRoot },
    resultFile: 'configuration-rebind-contract.json',
    error: errorMessage(error),
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  console.error(`HOPI-E2E-020 configuration/rebind failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${artifactRoot}`)
  process.exitCode = 1
} finally {
  await restartedCleanup?.run()
  await serverCleanup?.run()
}

function assertState(state: StateView) {
  assert.deepEqual(state.home.agentRoleCodingDefaults.assistant.codingDefaults, {
    transport: 'codex',
    model: 'gpt-5.4',
    reasoningEffort: 'xhigh',
  })
  assert.deepEqual(state.home.agentRoleCodingDefaults.generator.codingDefaults, {
    transport: 'claude',
    model: 'claude-sonnet-4-6',
  })
  const project = state.projects.find((candidate) => candidate.projectId === PROJECT_ID)
  assert.ok(project)
  assert.equal(project.primaryRepoId, 'web')
  assert.equal(project.repos.find((repo) => repo.repoId === 'web')?.repoPath, primaryRoot)
  assert.equal(project.repos.find((repo) => repo.repoId === 'api')?.repoPath, movedSecondaryRoot)
}

async function initializeRepo(root: string) {
  await mkdir(root, { recursive: true })
  await Bun.write(join(root, 'package.json'), '{"type":"module"}\n')
  await gitOutput(root, ['init', '-b', 'main'])
  await gitOutput(root, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(root, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(root, ['add', '.'])
  await gitOutput(root, ['commit', '-m', 'initial fixture'])
}

interface StateView {
  home: {
    agentRoleCodingDefaults: {
      assistant: { codingDefaults: unknown }
      generator: { codingDefaults: unknown }
    }
  }
  projects: Array<{
    projectId: string
    primaryRepoId: string
    repos: Array<{ repoId: string; repoPath: string }>
  }>
}
