import assert from 'node:assert/strict'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureDefaultAgentAdapterConfig } from '../../src/agent/defaultAdapterConfig'
import {
  type LiveGoalDetail,
  type LiveState,
  checkoutSnapshot,
  errorMessage,
  finishTestRun,
  gitOutput,
  inspectKanban,
  liveCodingDefaults,
  readModelUsage,
  readPendingInboxEvents,
  recordAction,
  requestJson,
  runCommand,
  startTestRun,
  waitForGoalQuiescence,
  waitForValue,
} from './liveHarness'

const SCENARIO = 'process-restart-during-generator'
const PROJECT_ID = 'P-process-restart'
const GOAL_ID = 'G-process-restart'
const testRun = await startTestRun(SCENARIO, 'live')
const homeRoot = join(testRun.artifactRoot, 'home')
const repoRoot = join(testRun.artifactRoot, 'repo')
const artifactContext = { scenario: SCENARIO, artifactRoot: testRun.artifactRoot, baseUrl: '' }
let first: CoordinatorBoundary | null = null
let replacement: CoordinatorBoundary | null = null

try {
  await initializeFixture(repoRoot)
  const checkout = await checkoutSnapshot(repoRoot)
  const codingDefaults = liveCodingDefaults()
  await ensureDefaultAgentAdapterConfig(homeRoot, codingDefaults)
  await recordAction(artifactContext, 'fixture_created', { checkout, codingDefaults })

  first = await launchCoordinator('first')
  await recordAction(artifactContext, 'coordinator_started', {
    instance: 'first',
    pid: first.child.pid,
    origin: first.origin,
  })
  const linked = await requestJson<LiveState>(first.origin, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: 'primary', repoPath: repoRoot },
  })
  const integrationRoot = linked.projects.find((project) => project.projectId === PROJECT_ID)
    ?.repos[0]?.integrationRoot
  assert.ok(integrationRoot)
  await requestJson(first.origin, `/api/projects/${PROJECT_ID}/goals`, {
    method: 'POST',
    body: {
      goalId: GOAL_ID,
      title: 'Recover a real Generator after Coordinator crash',
      objective:
        'Fix the failing protocol test with the smallest source change, run the project test, and deliver the reviewed result.',
    },
  })

  const checkpoint = await waitForGeneratorCheckpoint(first.origin)
  const descendants = await descendantPids(first.child.pid)
  assert.ok(descendants.length > 0, 'Coordinator boundary must contain a real child process')
  assert.equal(await Bun.file(checkpoint.sourcePath).text(), "export const protocol = 'v2'\n")
  assert.ok((await Bun.file(checkpoint.transcriptPath).text()).trim())
  assert.deepEqual(await checkoutSnapshot(repoRoot), checkout)
  assert.equal(
    await Bun.file(join(integrationRoot, 'src', 'protocol.ts')).text(),
    "export const protocol = 'v1'\n",
  )
  await recordAction(artifactContext, 'generator_checkpoint_observed', {
    workId: checkpoint.workId,
    runId: checkpoint.runId,
    sourcePath: checkpoint.sourcePath,
    transcriptPath: checkpoint.transcriptPath,
    boundaryDescendants: descendants,
  })

  await crashCoordinator(first)
  first = null
  await waitForProcessesToExit(descendants)
  assert.equal(await Bun.file(checkpoint.sourcePath).text(), "export const protocol = 'v2'\n")
  await recordAction(artifactContext, 'coordinator_crashed', {
    interruptedRunId: checkpoint.runId,
    retainedSourceDelta: true,
  })

  replacement = await launchCoordinator('replacement')
  await recordAction(artifactContext, 'coordinator_started', {
    instance: 'replacement',
    pid: replacement.child.pid,
    origin: replacement.origin,
  })
  await waitForValue(
    () => readAttempt(homeRoot, checkpoint.workId, checkpoint.runId),
    (attempt) => attempt?.status === 'interrupted',
    { timeoutMs: 60_000, description: 'old Generator Attempt to become interrupted' },
  )
  const terminal = await waitForValue(
    async () => {
      const [state, pending] = await Promise.all([
        requestJson<LiveState>(replacement?.origin ?? '', '/api/state'),
        readPendingInboxEvents(homeRoot),
      ])
      const goal = state.projects
        .find((project) => project.projectId === PROJECT_ID)
        ?.goals.find((candidate) => candidate.id === GOAL_ID)
      const unresolvedTargeted = state.attentions.some(
        (attention) => attention.target !== null && attention.resolvedAt === null,
      )
      return { state, pending, goal, unresolvedTargeted }
    },
    (value) =>
      value.goal?.lifecycle === 'done' &&
      value.state.activeRuns.length === 0 &&
      value.pending.length === 0 &&
      !value.unresolvedTargeted,
    { timeoutMs: 20 * 60_000, description: 'replacement Coordinator to finish delivery' },
  )
  assert.ok(terminal.goal)
  await waitForGoalQuiescence({ baseUrl: replacement.origin, homeRoot }, PROJECT_ID, GOAL_ID, {
    timeoutMs: 10 * 60_000,
  })

  const goal = await requestJson<LiveGoalDetail>(
    replacement.origin,
    `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`,
  )
  const attempts = await readGoalAttempts(replacement.origin, goal)
  const interrupted = attempts.find((attempt) => attempt.runId === checkpoint.runId)
  assert.equal(interrupted?.status, 'interrupted')
  assert.ok(
    attempts.some(
      (attempt) =>
        attempt.responsibility === 'generator' &&
        attempt.runId !== checkpoint.runId &&
        attempt.status === 'finished' &&
        attempt.result === 'success' &&
        attempt.application === 'published',
    ),
  )
  assert.ok(
    attempts.some(
      (attempt) =>
        attempt.responsibility === 'reviewer' &&
        attempt.status === 'finished' &&
        attempt.result === 'success' &&
        attempt.application === 'integrated',
    ),
  )
  assert.ok(
    attempts.some(
      (attempt) => attempt.responsibility === 'planner' && attempt.status === 'finished',
    ),
  )
  assert.equal(
    await gitOutput(integrationRoot, [
      'rev-list',
      '--count',
      'refs/heads/hopi/release',
      '--grep',
      `project:${PROJECT_ID}/goal:${GOAL_ID}/work:${checkpoint.workId}`,
    ]),
    '1',
  )
  assert.equal(
    await Bun.file(join(integrationRoot, 'src', 'protocol.ts')).text(),
    "export const protocol = 'v2'\n",
  )
  assert.equal((await runCommand(['bun', 'test'], integrationRoot)).exitCode, 0)
  assert.deepEqual(await checkoutSnapshot(repoRoot), checkout)
  const browser = await inspectKanban(
    { scenario: SCENARIO, artifactRoot: testRun.artifactRoot, baseUrl: replacement.origin },
    PROJECT_ID,
    GOAL_ID,
    { evidencePrefix: 'restart-terminal' },
  )
  await recordAction(artifactContext, 'restart_delivery_verified', {
    workId: checkpoint.workId,
    interruptedRunId: checkpoint.runId,
    attempts: attempts.length,
  })

  await stopCoordinator(replacement)
  replacement = null
  const usage = await readModelUsage(homeRoot)
  await finishTestRun(testRun, 'passed', {
    paths: { home: homeRoot, repo: repoRoot, integration: integrationRoot },
    modelBoundaries: { reflection: 'deterministic' },
    checkpoint,
    attempts,
    browser,
    usage,
  })
  console.log(`HOPI-E2E-016 process restart Live passed: ${testRun.artifactRoot}`)
  console.log(`Model usage: ${JSON.stringify(usage)}`)
} catch (error) {
  if (first) await stopCoordinator(first).catch(() => undefined)
  if (replacement) await stopCoordinator(replacement).catch(() => undefined)
  const usage = await readModelUsage(homeRoot).catch(() => undefined)
  await finishTestRun(testRun, 'failed', {
    paths: { home: homeRoot, repo: repoRoot },
    modelBoundaries: { reflection: 'deterministic' },
    error: errorMessage(error),
    usage,
  }).catch(() => undefined)
  console.error(`HOPI-E2E-016 process restart Live failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${testRun.artifactRoot}`)
  if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  process.exitCode = 1
}

interface CoordinatorBoundary {
  child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  origin: string
  output: Promise<void>
}

interface AttemptView {
  workId: string
  runId: string
  responsibility: string
  status: string
  result: string | null
  application: string | null
}

async function launchCoordinator(instance: string): Promise<CoordinatorBoundary> {
  if (process.platform !== 'linux' || !Bun.which('unshare')) {
    throw new Error('Process restart Live requires a Linux user/PID namespace boundary')
  }
  const port = reservePort()
  const child = Bun.spawn(
    [
      'unshare',
      '--user',
      '--map-current-user',
      '--pid',
      '--fork',
      '--kill-child=SIGKILL',
      '--mount-proc',
      'bun',
      'run',
      join(import.meta.dir, 'coordinatorProcess.ts'),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOPI_E2E_HOME_ROOT: homeRoot,
        HOPI_E2E_PORT: String(port),
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
    },
  )
  const output = retainProcessOutput(child, instance)
  const origin = `http://127.0.0.1:${port}`
  await waitForValue(
    async () => {
      try {
        const response = await fetch(`${origin}/api/state`)
        return response.ok
      } catch {
        return false
      }
    },
    Boolean,
    { timeoutMs: 30_000, intervalMs: 100, description: `${instance} Coordinator startup` },
  )
  return { child, origin, output }
}

function reservePort() {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('reserved') })
  const port = probe.port
  void probe.stop(true)
  return port
}

async function retainProcessOutput(
  child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
  instance: string,
) {
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  await Promise.all([
    Bun.write(join(testRun.artifactRoot, `coordinator-${instance}.stdout.log`), stdout),
    Bun.write(join(testRun.artifactRoot, `coordinator-${instance}.stderr.log`), stderr),
  ])
}

async function crashCoordinator(boundary: CoordinatorBoundary) {
  process.kill(-boundary.child.pid, 'SIGKILL')
  await boundary.child.exited
  await boundary.output
}

async function stopCoordinator(boundary: CoordinatorBoundary) {
  if (boundary.child.exitCode === null) {
    process.kill(-boundary.child.pid, 'SIGTERM')
  }
  await boundary.child.exited
  await boundary.output
}

async function waitForGeneratorCheckpoint(origin: string) {
  return waitForValue(
    async () => {
      const state = await requestJson<LiveState>(origin, '/api/state')
      const active = state.activeRuns.find((run) => run.responsibility === 'generator')
      if (!active) return null
      const [, , workId] = active.key.split('/')
      if (!workId) return null
      const response = await requestJson<{ attempts: AttemptView[] }>(
        origin,
        `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}/works/${workId}/attempts`,
      )
      const attempt = response.attempts.find((candidate) => candidate.status === 'running')
      if (!attempt) return null
      const sourcePath = join(
        homeRoot,
        '.hopi',
        'runtime',
        'worktrees',
        PROJECT_ID,
        GOAL_ID,
        workId,
        'src',
        'protocol.ts',
      )
      const source = Bun.file(sourcePath)
      const transcriptPath = join(
        homeRoot,
        '.hopi',
        'runtime',
        'runs',
        PROJECT_ID,
        GOAL_ID,
        workId,
        attempt.runId,
        'transcript.log',
      )
      const transcript = Bun.file(transcriptPath)
      if (!(await source.exists()) || !(await transcript.exists())) return null
      if ((await source.text()) !== "export const protocol = 'v2'\n") return null
      if (!(await transcript.text()).trim()) return null
      return {
        workId,
        runId: attempt.runId,
        sourcePath,
        transcriptPath,
      }
    },
    (value) => value !== null,
    { timeoutMs: 12 * 60_000, intervalMs: 100, description: 'real Generator source checkpoint' },
  ).then((value) => {
    assert.ok(value)
    return value
  })
}

async function readAttempt(root: string, workId: string, runId: string) {
  const file = Bun.file(
    join(root, '.hopi', 'runtime', 'runs', PROJECT_ID, GOAL_ID, workId, runId, 'attempt.json'),
  )
  return (await file.exists()) ? ((await file.json()) as AttemptView) : null
}

async function readGoalAttempts(origin: string, goal: LiveGoalDetail) {
  const attempts: AttemptView[] = []
  for (const work of goal.works) {
    const response = await requestJson<{ attempts: AttemptView[] }>(
      origin,
      `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}/works/${work.id}/attempts`,
    )
    attempts.push(...response.attempts.map((attempt) => ({ ...attempt, workId: work.id })))
  }
  return attempts
}

async function descendantPids(rootPid: number) {
  const result = await runCommand(['ps', '-eo', 'pid=,ppid='], process.cwd())
  assert.equal(result.exitCode, 0)
  const children = new Map<number, number[]>()
  for (const line of result.stdout.split('\n')) {
    const [pidSource, parentSource] = line.trim().split(/\s+/)
    const pid = Number(pidSource)
    const parent = Number(parentSource)
    if (!Number.isInteger(pid) || !Number.isInteger(parent)) continue
    children.set(parent, [...(children.get(parent) ?? []), pid])
  }
  const found: number[] = []
  const pending = [...(children.get(rootPid) ?? [])]
  while (pending.length > 0) {
    const pid = pending.pop()
    if (!pid) continue
    found.push(pid)
    pending.push(...(children.get(pid) ?? []))
  }
  return found
}

async function waitForProcessesToExit(pids: number[]) {
  await waitForValue(
    async () => pids.filter(isProcessAlive),
    (alive) => alive.length === 0,
    { timeoutMs: 15_000, intervalMs: 100, description: 'crashed Coordinator descendants to exit' },
  )
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function initializeFixture(root: string) {
  await Promise.all([
    mkdir(join(root, 'src'), { recursive: true }),
    mkdir(join(root, 'test'), { recursive: true }),
    mkdir(join(root, 'scripts', 'hopi'), { recursive: true }),
  ])
  await Bun.write(
    join(root, 'AGENTS.md'),
    '# Restart fixture\n\nFix the failing protocol test with the smallest source-only change. Run `bun test` after editing. Do not change the test delay or test files.\n',
  )
  await Bun.write(join(root, 'package.json'), '{"type":"module","scripts":{"test":"bun test"}}\n')
  await Bun.write(join(root, 'bunfig.toml'), '[test]\npreload = ["./test/setup.ts"]\n')
  await Bun.write(
    join(root, 'test', 'setup.ts'),
    "import { setDefaultTimeout } from 'bun:test'\n\nsetDefaultTimeout(15_000)\n",
  )
  await Bun.write(join(root, 'src', 'protocol.ts'), "export const protocol = 'v1'\n")
  await Bun.write(
    join(root, 'test', 'protocol.test.ts'),
    "import { expect, test } from 'bun:test'\nimport { protocol } from '../src/protocol'\n\ntest('protocol v2', async () => {\n  if (protocol === 'v2') await Bun.sleep(8_000)\n  expect(protocol).toBe('v2')\n})\n",
  )
  const prepare = join(root, 'scripts', 'hopi', 'prepare')
  await Bun.write(prepare, '#!/usr/bin/env sh\nset -eu\n:\n')
  await chmod(prepare, 0o755)
  await gitOutput(root, ['init', '-b', 'main'])
  await gitOutput(root, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(root, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(root, ['add', '.'])
  await gitOutput(root, ['commit', '-m', 'initial process restart fixture'])
}
