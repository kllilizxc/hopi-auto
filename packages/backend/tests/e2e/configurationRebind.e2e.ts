import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type MvpServer, createServer } from '../../src/mvpServer'
import {
  checkoutSnapshot,
  configureProjectInBrowser,
  errorMessage,
  finishTestRun,
  gitOutput,
  requestJson,
  startTestRun,
} from '../live/liveHarness'

const SCENARIO = 'configuration-rebind'
const PROJECT_ID = 'P-configuration'
const testRun = await startTestRun(SCENARIO, 'browser')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const primaryRoot = join(artifactRoot, 'web')
const duplicatePrimaryRoot = join(artifactRoot, 'web-duplicate')
const secondaryRoot = join(artifactRoot, 'api')
const movedSecondaryRoot = join(artifactRoot, 'api-moved')
let server: MvpServer | null = null
let restarted: MvpServer | null = null

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
  const baseUrl = `http://127.0.0.1:${server.port}`
  await gitOutput(secondaryRoot, [
    'worktree',
    'add',
    '-b',
    'relocated-checkout',
    movedSecondaryRoot,
    'HEAD',
  ])
  const browser = await configureProjectInBrowser(
    { scenario: SCENARIO, artifactRoot, baseUrl },
    {
      projectId: PROJECT_ID,
      primaryRepoId: 'web',
      primaryRepoPath: primaryRoot,
      duplicateRepoPath: duplicatePrimaryRoot,
      secondaryRepoId: 'api',
      secondaryRepoPath: secondaryRoot,
      reboundSecondaryRepoPath: movedSecondaryRoot,
      assistantModel: 'gpt-5.4',
      projectModel: 'claude-sonnet-4-6',
    },
  )
  const rebound = await requestJson<StateView>(baseUrl, '/api/state')
  assertState(rebound)
  assert.deepEqual(await checkoutSnapshot(primaryRoot), primaryBefore)
  assert.deepEqual(await checkoutSnapshot(secondaryRoot), secondaryBefore)
  await server.shutdown()
  server = null
  restarted = createServer({ rootDir: homeRoot, port: 0 })
  const durable = await requestJson<StateView>(`http://127.0.0.1:${restarted.port}`, '/api/state')
  assertState(durable)
  await Bun.write(
    join(artifactRoot, 'configuration-rebind-contract.json'),
    `${JSON.stringify({ status: 'passed', startedAt, browser, rebound, durable }, null, 2)}\n`,
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
  await restarted?.shutdown()
  await server?.shutdown()
}

function assertState(state: StateView) {
  assert.deepEqual(state.home.assistantCodingDefaults, {
    transport: 'codex',
    model: 'gpt-5.4',
    reasoningEffort: 'xhigh',
  })
  const project = state.projects.find((candidate) => candidate.projectId === PROJECT_ID)
  assert.ok(project)
  assert.deepEqual(project.codingDefaults, { transport: 'claude', model: 'claude-sonnet-4-6' })
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
  home: { assistantCodingDefaults: unknown }
  projects: Array<{
    projectId: string
    primaryRepoId: string
    codingDefaults: unknown
    repos: Array<{ repoId: string; repoPath: string }>
  }>
}
