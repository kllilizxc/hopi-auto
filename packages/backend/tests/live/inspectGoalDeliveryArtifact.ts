import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import type { RoleRunner } from '../../src/agent/RoleRunner'
import type { AssistantModelRunner } from '../../src/assistant/workspaceAssistant'
import { type MvpServer, createServer } from '../../src/mvpServer'
import { captureGoalDeliveryPresentation, verifyGoalDeliveryDomain } from './goalDeliveryScenario'
import {
  type CodeProvenance,
  type LiveState,
  errorMessage,
  finishTestRun,
  ownTestRunServer,
  readGitSemanticState,
  requestJson,
  semanticDirectoryDigest,
  startTestRun,
} from './liveHarness'

interface SourceRun {
  scenario?: unknown
  status?: unknown
  startedAt?: unknown
  endedAt?: unknown
  code?: unknown
  invariantViolations?: unknown
}

interface SourceAction {
  action?: unknown
  projectId?: unknown
  goalId?: unknown
  checkout?: unknown
  integrationRoot?: unknown
}

interface CheckoutSnapshot {
  head: string
  branch: string
  status: string
}

const sourceInput = process.argv.slice(2).find((argument) => argument !== '--')
if (!sourceInput) {
  console.error('Usage: bun run artifact:inspect -- <artifact-root>')
  process.exit(2)
}

const sourceRoot = resolve(sourceInput)
const testRun = await startTestRun('goal-delivery-inspection', 'inspection')
const { artifactRoot, startedAt } = testRun
const invocations = { assistant: 0, responsibility: 0 }
const inspectorCode: CodeProvenance | null = testRun.code
let sourceRun: SourceRun | null = null
let sourceDigestBefore: string | null = null
let sourceGitBefore: Record<string, unknown> | null = null
let server: MvpServer | null = null

try {
  sourceRun = await readJson<SourceRun>(join(sourceRoot, 'run.json'))
  assert.equal(sourceRun.scenario, 'goal-delivery', 'Source artifact must be goal-delivery')
  assert.ok(
    sourceRun.status === 'passed' || sourceRun.status === 'failed',
    'Source artifact must retain a terminal run report',
  )
  const actions = await readActions(join(sourceRoot, 'actions.jsonl'))
  const projectId = actionString(actions, 'project_linked', 'projectId')
  const recordedIntegrationRoot = actionString(actions, 'project_linked', 'integrationRoot')
  const goalId = actionString(actions, 'goal_admitted', 'goalId')
  const checkoutBefore = actionCheckout(actions)
  const homeRoot = join(sourceRoot, 'home')
  const repoRoot = join(sourceRoot, 'repo')

  sourceDigestBefore = await semanticDirectoryDigest(sourceRoot)
  sourceGitBefore = {
    userCheckout: await readGitSemanticState(repoRoot),
    integration: await readGitSemanticState(recordedIntegrationRoot),
  }
  await writeInspectionReport(artifactRoot, {
    status: 'running',
    startedAt,
    sourceRoot,
    sourceRun,
    sourceDigestBefore,
    sourceGitBefore,
    inspectorCode,
    invocations,
  })

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
    rootDir: homeRoot,
    port: 0,
    startCoordinator: false,
    assistantRunner,
    roleRunner,
  })
  const serverCleanup = ownTestRunServer(testRun, server)
  const baseUrl = `http://127.0.0.1:${server.port}`
  const state = await requestJson<LiveState>(baseUrl, '/api/state')
  const project = state.projects.find((candidate) => candidate.projectId === projectId)
  const integrationRoot = project?.repos.find((repo) => repo.primary)?.integrationRoot
  assert.ok(integrationRoot, `Source artifact has no primary integration for ${projectId}`)
  assert.equal(
    resolve(integrationRoot),
    resolve(recordedIntegrationRoot),
    'Current Project state must use the integration retained by the live run',
  )

  const context = {
    scenario: 'goal-delivery-inspection',
    artifactRoot,
    homeRoot,
    repoRoot,
    baseUrl,
  }
  const domain = await verifyGoalDeliveryDomain({
    context,
    projectId,
    goalId,
    integrationRoot,
    checkoutBefore,
    invariantViolations: stringArray(sourceRun.invariantViolations),
  })
  const presentation = await captureGoalDeliveryPresentation(
    context,
    projectId,
    goalId,
    domain.completion.body,
  )

  await serverCleanup.run()
  server = null
  const sourceDigestAfter = await semanticDirectoryDigest(sourceRoot)
  const sourceGitAfter = {
    userCheckout: await readGitSemanticState(repoRoot),
    integration: await readGitSemanticState(integrationRoot),
  }
  assert.equal(
    sourceDigestAfter,
    sourceDigestBefore,
    'Artifact inspection mutated its retained source evidence',
  )
  assert.deepEqual(
    sourceGitAfter,
    sourceGitBefore,
    'Artifact inspection mutated retained Git state',
  )
  assert.deepEqual(
    invocations,
    { assistant: 0, responsibility: 0 },
    'Artifact inspection invoked a model runner',
  )

  await writeInspectionReport(artifactRoot, {
    status: 'passed',
    startedAt,
    endedAt: new Date().toISOString(),
    sourceRoot,
    sourceRun,
    sourceDigestBefore,
    sourceDigestAfter,
    sourceGitBefore,
    sourceGitAfter,
    inspectorCode,
    invocations,
    projectId,
    goalId,
    verification: {
      goalLifecycle: domain.finalGoal.goal.lifecycle,
      attempts: domain.attempts,
      project: domain.projectVerification,
      userCheckout: checkoutBefore,
    },
    presentation,
  })
  await finishTestRun(testRun, 'passed', {
    source: { artifactRoot: sourceRoot, scenario: sourceRun.scenario, code: sourceRun.code },
    resultFile: 'inspection.json',
    invocations,
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  })
  console.log(`Artifact inspection passed: ${artifactRoot}`)
  console.log('Model runner invocations: 0')
} catch (error) {
  if (server) await server.shutdown().catch(() => undefined)
  const sourceDigestAfter = sourceDigestBefore
    ? await semanticDirectoryDigest(sourceRoot).catch(() => null)
    : null
  const sourceGitAfter = sourceGitBefore
    ? await readSourceGitState(sourceRoot).catch(() => null)
    : null
  await writeInspectionReport(artifactRoot, {
    status: 'failed',
    startedAt,
    endedAt: new Date().toISOString(),
    sourceRoot,
    sourceRun,
    sourceDigestBefore,
    sourceDigestAfter,
    sourceGitBefore,
    sourceGitAfter,
    inspectorCode,
    invocations,
    error: errorMessage(error),
  }).catch(() => undefined)
  await finishTestRun(testRun, 'failed', {
    source: { artifactRoot: sourceRoot, scenario: sourceRun?.scenario, code: sourceRun?.code },
    resultFile: 'inspection.json',
    invocations,
    error: errorMessage(error),
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  console.error(`Artifact inspection failed: ${errorMessage(error)}`)
  console.error(`Retained inspection evidence: ${artifactRoot}`)
  process.exitCode = 1
}

async function readJson<T>(path: string): Promise<T> {
  const file = Bun.file(path)
  assert.ok(await file.exists(), `Missing retained evidence: ${path}`)
  return file.json() as Promise<T>
}

async function readActions(path: string) {
  const source = await Bun.file(path).text()
  return source
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SourceAction)
}

function actionString(
  actions: SourceAction[],
  action: string,
  key: 'projectId' | 'goalId' | 'integrationRoot',
): string {
  const value = actions.find((entry) => entry.action === action)?.[key]
  if (typeof value !== 'string') throw new Error(`${action} must retain ${key}`)
  return value
}

async function readSourceGitState(root: string) {
  const actions = await readActions(join(root, 'actions.jsonl'))
  const integrationRoot = actionString(actions, 'project_linked', 'integrationRoot')
  return {
    userCheckout: await readGitSemanticState(join(root, 'repo')),
    integration: await readGitSemanticState(integrationRoot),
  }
}

function actionCheckout(actions: SourceAction[]): CheckoutSnapshot {
  const value = actions.find((entry) => entry.action === 'fixture_created')?.checkout
  assert.ok(value && typeof value === 'object', 'fixture_created must retain checkout state')
  const snapshot = value as Record<string, unknown>
  for (const key of ['head', 'branch', 'status'] as const) {
    if (typeof snapshot[key] !== 'string') {
      throw new Error(`fixture_created checkout must retain ${key}`)
    }
  }
  return snapshot as unknown as CheckoutSnapshot
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []
}

async function writeInspectionReport(
  root: string,
  report: Record<string, unknown> & { status: 'running' | 'passed' | 'failed' },
) {
  await Bun.write(
    join(root, 'inspection.json'),
    `${JSON.stringify({ version: 1, kind: 'artifact-inspection', ...report }, null, 2)}\n`,
  )
}
