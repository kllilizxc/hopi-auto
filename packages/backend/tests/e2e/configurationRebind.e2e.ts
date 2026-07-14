import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type MvpServer, createServer } from '../../src/mvpServer'
import {
  createHarnessArtifactRoot,
  errorMessage,
  gitOutput,
  requestJson,
} from '../live/liveHarness'

const PROJECT_ID = 'P-configuration'
const startedAt = new Date().toISOString()
const artifactRoot = await createHarnessArtifactRoot('configuration-rebind', startedAt)
const homeRoot = join(artifactRoot, 'home')
const primaryRoot = join(artifactRoot, 'primary')
const secondaryRoot = join(artifactRoot, 'secondary')
const movedSecondaryRoot = join(artifactRoot, 'secondary-moved')
let server: MvpServer | null = null
let restarted: MvpServer | null = null

try {
  await initializeRepo(primaryRoot)
  await initializeRepo(secondaryRoot)
  server = createServer({ rootDir: homeRoot, port: 0 })
  const baseUrl = `http://127.0.0.1:${server.port}`
  await requestJson(baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: 'web', repoPath: primaryRoot },
  })
  await requestJson(baseUrl, `/api/projects/${PROJECT_ID}/repos`, {
    method: 'POST',
    body: { repoId: 'api', repoPath: secondaryRoot },
  })
  await gitOutput(secondaryRoot, [
    'worktree',
    'add',
    '-b',
    'relocated-checkout',
    movedSecondaryRoot,
    'hopi/release',
  ])
  await requestJson(baseUrl, '/api/assistant/settings', {
    method: 'PATCH',
    body: { codingDefaults: { transport: 'codex', model: 'gpt-5.4', reasoningEffort: 'low' } },
  })
  await requestJson(baseUrl, `/api/projects/${PROJECT_ID}/settings`, {
    method: 'PATCH',
    body: { codingDefaults: { transport: 'opencode', model: 'openai/gpt-5' } },
  })
  const rebound = await requestJson<StateView>(
    baseUrl,
    `/api/projects/${PROJECT_ID}/repos/api/rebind`,
    { method: 'POST', body: { repoPath: movedSecondaryRoot } },
  )
  assertState(rebound)
  await server.shutdown()
  server = null
  restarted = createServer({ rootDir: homeRoot, port: 0 })
  const durable = await requestJson<StateView>(`http://127.0.0.1:${restarted.port}`, '/api/state')
  assertState(durable)
  await Bun.write(
    join(artifactRoot, 'configuration-rebind-contract.json'),
    `${JSON.stringify({ status: 'passed', startedAt, rebound, durable }, null, 2)}\n`,
  )
  console.log(`HOPI-E2E-020 configuration/rebind passed: ${artifactRoot}`)
} catch (error) {
  await Bun.write(
    join(artifactRoot, 'configuration-rebind-contract.json'),
    `${JSON.stringify({ status: 'failed', startedAt, error: errorMessage(error) }, null, 2)}\n`,
  )
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
    reasoningEffort: 'low',
  })
  const project = state.projects.find((candidate) => candidate.projectId === PROJECT_ID)
  assert.ok(project)
  assert.deepEqual(project.codingDefaults, { transport: 'opencode', model: 'openai/gpt-5' })
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
    codingDefaults: unknown
    repos: Array<{ repoId: string; repoPath: string }>
  }>
}
