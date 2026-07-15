import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import type { RoleRunner } from '../../src/agent/RoleRunner'
import type { AssistantModelRunner } from '../../src/assistant/workspaceAssistant'
import { type MvpServer, createServer } from '../../src/mvpServer'
import {
  type LiveGoalDetail,
  type LiveState,
  finishTestRun,
  inspectKanban,
  readGitSemanticState,
  readPendingInboxEvents,
  requestJson,
  runCommand,
  semanticDirectoryDigest,
  startTestRun,
} from './liveHarness'

const PROJECTS = [
  { projectId: 'P-concurrent-a', repoName: 'repo-a' },
  { projectId: 'P-concurrent-b', repoName: 'repo-b' },
] as const

const sourceInput = process.argv.slice(2).find((argument) => argument !== '--')
if (!sourceInput) {
  console.error('Usage: bun run artifact:inspect:011 -- <artifact-root>')
  process.exit(2)
}

const sourceRoot = resolve(sourceInput)
const testRun = await startTestRun('concurrent-projects-inspection', 'inspection')
const invocations = { assistant: 0, responsibility: 0 }
let server: MvpServer | null = null

try {
  const sourceRun = await Bun.file(join(sourceRoot, 'run.json')).json()
  assert.equal(sourceRun.scenario, 'concurrent-project-instructions')
  assert.match(sourceRun.error ?? '', /Browser Harness audit verification failed/)
  const sourceDigestBefore = await semanticDirectoryDigest(sourceRoot)
  const assistantRunner: AssistantModelRunner = {
    async run() {
      invocations.assistant += 1
      throw new Error('Artifact inspection must not invoke an Assistant model')
    },
  }
  const roleRunner: RoleRunner = {
    async run() {
      invocations.responsibility += 1
      throw new Error('Artifact inspection must not invoke a responsibility model')
    },
  }
  server = createServer({
    rootDir: join(sourceRoot, 'home'),
    port: 0,
    startCoordinator: false,
    assistantRunner,
    roleRunner,
  })
  const baseUrl = `http://127.0.0.1:${server.port}`
  const state = await requestJson<LiveState>(baseUrl, '/api/state')
  assert.deepEqual(state.activeRuns, [])
  assert.equal(
    state.attentions.filter(
      (attention) => attention.target !== null && attention.resolvedAt === null,
    ).length,
    0,
  )
  assert.deepEqual(await readPendingInboxEvents(join(sourceRoot, 'home')), [])

  const gitBefore: Record<string, unknown> = {}
  const verification: Record<string, unknown> = {}
  const browser: Record<string, unknown> = {}
  for (const { projectId, repoName } of PROJECTS) {
    const project = state.projects.find((candidate) => candidate.projectId === projectId)
    assert.ok(project)
    assert.equal(project.goals.length, 1)
    const goal = project.goals[0]
    assert.ok(goal)
    assert.equal(goal.lifecycle, 'done')
    const integrationRoot = project.repos.find((repo) => repo.primary)?.integrationRoot
    assert.ok(integrationRoot)
    const repoRoot = join(sourceRoot, repoName)
    gitBefore[projectId] = {
      checkout: await readGitSemanticState(repoRoot),
      integration: await readGitSemanticState(integrationRoot),
    }
    assert.equal(
      await Bun.file(join(repoRoot, 'src', 'protocol.ts')).text(),
      "export const protocol = 'v1'\n",
    )
    assert.equal(
      await Bun.file(join(integrationRoot, 'src', 'protocol.ts')).text(),
      "export const protocol = 'v2'\n",
    )
    assert.equal((await runCommand(['bun', 'test'], integrationRoot)).exitCode, 0)

    const detail = await requestJson<LiveGoalDetail>(
      baseUrl,
      `/api/projects/${projectId}/goals/${goal.id}`,
    )
    const responsibilities = new Set<string>()
    for (const work of detail.works) {
      const response = await requestJson<{
        attempts: Array<{ responsibility: string; status: string }>
      }>(baseUrl, `/api/projects/${projectId}/goals/${goal.id}/works/${work.id}/attempts`)
      for (const attempt of response.attempts) {
        if (attempt.status === 'finished') responsibilities.add(attempt.responsibility)
      }
    }
    assert.deepEqual(
      [...responsibilities].sort(),
      ['generator', 'planner', 'reviewer'],
      `${projectId} must retain all real responsibility Attempts`,
    )
    verification[projectId] = {
      goalId: goal.id,
      integrationRoot,
      responsibilities: [...responsibilities],
    }
    browser[projectId] = await inspectKanban(
      { scenario: testRun.scenario, artifactRoot: testRun.artifactRoot, baseUrl },
      projectId,
      goal.id,
      { evidencePrefix: `${projectId}-terminal` },
    )
  }

  await server.shutdown()
  server = null
  assert.equal(await semanticDirectoryDigest(sourceRoot), sourceDigestBefore)
  const gitAfter: Record<string, unknown> = {}
  for (const { projectId, repoName } of PROJECTS) {
    const integrationRoot = state.projects
      .find((project) => project.projectId === projectId)
      ?.repos.find((repo) => repo.primary)?.integrationRoot
    assert.ok(integrationRoot)
    gitAfter[projectId] = {
      checkout: await readGitSemanticState(join(sourceRoot, repoName)),
      integration: await readGitSemanticState(integrationRoot),
    }
  }
  assert.deepEqual(gitAfter, gitBefore)
  assert.deepEqual(invocations, { assistant: 0, responsibility: 0 })
  await finishTestRun(testRun, 'passed', {
    source: { artifactRoot: sourceRoot, code: sourceRun.code },
    invocations,
    verification,
    browser,
  })
  console.log(`Concurrent Project artifact inspection passed: ${testRun.artifactRoot}`)
} catch (error) {
  if (server) await server.shutdown().catch(() => undefined)
  const message = error instanceof Error ? error.message : String(error)
  await finishTestRun(testRun, 'failed', {
    source: { artifactRoot: sourceRoot },
    invocations,
    error: message,
  }).catch(() => undefined)
  console.error(`Concurrent Project artifact inspection failed: ${message}`)
  console.error(`Retained inspection evidence: ${testRun.artifactRoot}`)
  process.exitCode = 1
}
