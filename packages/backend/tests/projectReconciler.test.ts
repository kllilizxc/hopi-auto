import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  WorkerRunInput,
  WorkerRunObserver,
  WorkerRunResult,
  WorkerRunner,
} from '../src/agent/WorkerRunner'
import { PublicationCoordinator } from '../src/publication/publisher'
import { createRunAttemptStore } from '../src/runtime/runAttemptStore'
import type { RunRequest } from '../src/runtime/runRequest'
import { createStableWorktreeManager } from '../src/runtime/stableWorktreeManager'
import { createProjectReconciler } from '../src/scheduler/projectReconciler'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoots: string[] = []

setDefaultTimeout(20_000)

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('ProjectReconciler explicit Worker loop', () => {
  test('runs only explicit requests and leaves acceptance to the Assistant', async () => {
    const fixture = await createFixture()

    expect(await fixture.reconcile()).toMatchObject({ kind: 'wait' })
    expect(fixture.inputs).toHaveLength(0)

    const requested = await fixture.request(writeRequest('Implement value 2.'))
    expect(await fixture.reconcile()).toMatchObject({
      kind: 'run_settled',
      runId: requested.runId,
      termination: 'normal',
    })

    const current = await fixture.store.readPackage('goal-1')
    expect(current.works.get('W-1')?.attributes.status).toBe('open')
    const attempt = await fixture.attempts.read('project-1', 'goal-1', 'W-1', requested.runId)
    expect(attempt).toMatchObject({
      status: 'settled',
      termination: 'normal',
      reportMarkdown: 'Run run-1 completed.',
      execution: { transport: 'codex', model: 'gpt-5.4', reasoningEffort: 'high' },
    })
    expect(attempt?.candidateCommits).toHaveLength(1)
    expect(attempt?.candidateCommits[0]?.resultCommit).not.toBe(
      attempt?.candidateCommits[0]?.baseCommit,
    )

    expect(await fixture.reconcile()).toMatchObject({ kind: 'wait' })
    expect(fixture.inputs).toHaveLength(1)
  })

  test('gives every Run a fresh disposable Session workspace', async () => {
    const fixture = await createFixture()
    const first = await fixture.request(writeRequest('First pass.'))
    await fixture.reconcile()
    const second = await fixture.request(writeRequest('Second pass.'))
    await fixture.reconcile()

    expect(first.runId).not.toBe(second.runId)
    expect(fixture.inputs).toHaveLength(2)
    expect(fixture.inputs[0]?.session).toBeNull()
    expect(fixture.inputs[1]?.session).toBeNull()
    expect(fixture.inputs[0]?.context.runtimeScratchDir).not.toBe(
      fixture.inputs[1]?.context.runtimeScratchDir,
    )
    expect(fixture.inputs[0]?.context.runRoot).not.toBe(fixture.inputs[1]?.context.runRoot)
  })

  test('settles a crash once, preserves partial source, and never retries implicitly', async () => {
    const fixture = await createFixture()
    fixture.enqueue(async (input, observer) => {
      await observer?.onExecution?.({
        transport: 'claude',
        model: 'sonnet',
        reasoningEffort: null,
      })
      await Bun.write(join(input.cwd, 'src', 'partial.ts'), 'export const partial = true\n')
      return {
        termination: 'crashed',
        reportMarkdown: 'The process crashed after writing partial.ts.',
        artifacts: [],
        exitCode: 9,
      }
    })
    const requested = await fixture.request(writeRequest('Try the source change.'))

    expect(await fixture.reconcile()).toMatchObject({
      kind: 'run_settled',
      termination: 'crashed',
    })
    const attempt = await fixture.attempts.read('project-1', 'goal-1', 'W-1', requested.runId)
    expect(attempt).toMatchObject({
      status: 'settled',
      termination: 'crashed',
      reportMarkdown: 'The process crashed after writing partial.ts.',
      exitCode: 9,
    })
    expect(attempt?.candidateCommits[0]?.resultCommit).not.toBe(
      attempt?.candidateCommits[0]?.baseCommit,
    )
    expect(await fixture.reconcile()).toMatchObject({ kind: 'wait' })
    expect(fixture.inputs).toHaveLength(1)

    fixture.enqueue(async (input) => ({
      termination: 'normal',
      reportMarkdown: (await Bun.file(join(input.cwd, 'src', 'partial.ts')).exists())
        ? 'The next Run sees partial.ts from the stable task branch.'
        : 'partial.ts is missing.',
      artifacts: [],
      exitCode: 0,
    }))
    const followup = await fixture.request({
      workspaceMode: 'read_only',
      instructionMarkdown: 'Inspect the partial source.',
      refs: [requested.runId],
    })
    await fixture.reconcile()
    expect(
      (await fixture.attempts.read('project-1', 'goal-1', 'W-1', followup.runId))?.reportMarkdown,
    ).toContain('sees partial.ts')
  })

  test('checkpoints source when an active Run is cancelled', async () => {
    const fixture = await createFixture()
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    fixture.enqueue(async (input) => {
      await Bun.write(join(input.cwd, 'src', 'cancelled.ts'), 'export const retained = true\n')
      markStarted?.()
      await new Promise<void>((resolve) => {
        input.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return {
        termination: 'cancelled',
        reportMarkdown: 'Cancellation retained the source written so far.',
        artifacts: [],
        exitCode: null,
      }
    })
    const requested = await fixture.request(writeRequest('Start a cancellable Run.'))
    const reconciliation = fixture.reconcile()
    await started
    fixture.reconciler.interruptRuns('goal-1', 'W-1', 'cancelled')

    expect(await reconciliation).toMatchObject({
      kind: 'run_settled',
      termination: 'cancelled',
    })
    const attempt = await fixture.attempts.read('project-1', 'goal-1', 'W-1', requested.runId)
    expect(attempt?.termination).toBe('cancelled')
    expect(attempt?.candidateCommits[0]?.resultCommit).not.toBe(
      attempt?.candidateCommits[0]?.baseCommit,
    )
  })

  test('checkpoints an abandoned writable Run before restart settlement', async () => {
    const fixture = await createFixture()
    const requested = await fixture.request(writeRequest('Write source before a process crash.'))
    await fixture.attempts.start({
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: requested.runId,
      runRoot: join(fixture.homeRoot, '.hopi', 'runtime', 'runs', requested.runId),
    })

    const worktrees = createStableWorktreeManager()
    const worktreeInput = {
      projectRoot: fixture.linked.integrationRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      repoId: fixture.linked.primaryRepoId,
      primaryRepoId: fixture.linked.primaryRepoId,
    }
    const worktree = await worktrees.prepare(worktreeInput)
    await Bun.write(join(worktree.path, 'src', 'recovered.ts'), 'export const recovered = true\n')

    expect(
      await fixture.attempts.interruptRunningAttempts((attempt) =>
        fixture.reconciler.checkpointInterruptedRun(attempt),
      ),
    ).toBe(1)
    const settled = await fixture.attempts.read('project-1', 'goal-1', 'W-1', requested.runId)
    expect(settled).toMatchObject({
      status: 'settled',
      termination: 'interrupted',
      candidateCommits: [expect.objectContaining({ repoId: fixture.linked.primaryRepoId })],
    })
    expect(await git(worktree.path, ['show', 'HEAD:src/recovered.ts'])).toContain(
      'recovered = true',
    )
  })

  test('publishes Engineering through C1 and completes the Goal only on explicit acceptance', async () => {
    const fixture = await createFixture()
    const queued = await fixture.request(writeRequest('Implement before completion.'))

    await expect(
      fixture.reconciler.completeWork('goal-1', 'W-1', {
        sourceEventId: 'event-too-early',
        decision: 'Complete now.',
      }),
    ).rejects.toThrow(`Run ${queued.runId} is still queued`)

    await fixture.reconcile()
    const completed = await fixture.reconciler.completeWork('goal-1', 'W-1', {
      sourceEventId: 'event-complete',
      decision: 'The current task source satisfies the acceptance criteria.',
    })
    expect(completed.kind).toBe('integrated')
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.status).toBe(
      'done',
    )
    expect(fixture.releaseUpdates).toHaveLength(1)

    const goal = await fixture.reconciler.completeGoal('goal-1', {
      sourceEventId: 'event-goal-complete',
      decision: 'All Work is terminal and no Run is active.',
    })
    expect(goal.attributes.lifecycle).toBe('done')
    expect((await fixture.store.readPackage('goal-1')).goal.attributes.lifecycle).toBe('done')
  })
})

type RunHandler = (input: WorkerRunInput, observer?: WorkerRunObserver) => Promise<WorkerRunResult>

async function createFixture() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-project-reconciler-'))
  temporaryRoots.push(temporaryRoot)
  const repoRoot = join(temporaryRoot, 'repo')
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await Bun.write(join(repoRoot, 'src', 'value.ts'), 'export const value = 1\n')
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])

  const homeRoot = join(temporaryRoot, 'home')
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(homeRoot, publisher)
  const linked = await home.linkProject({ projectId: 'project-1', repoPath: repoRoot })
  const store = createGoalPackageStore(linked.integrationRoot, 'project-1', publisher)
  await store.createGoal({
    goalId: 'goal-1',
    title: 'Goal',
    objective: 'Ship value 2.',
    firstWork: {
      id: 'W-1',
      title: 'Build value 2',
      kind: 'engineering',
      objective: 'Change the exported value.',
      acceptanceCriteria: ['The exported value is at least 2.'],
    },
    createdAt: '2026-08-13T00:00:00.000Z',
  })

  const attempts = createRunAttemptStore(homeRoot, {
    now: () => new Date('2026-08-13T00:00:00Z'),
  })
  const handlers: RunHandler[] = []
  const inputs: WorkerRunInput[] = []
  const workerRunner: WorkerRunner = {
    async run(input, observer) {
      inputs.push(input)
      const handler = handlers.shift()
      if (handler) return handler(input, observer)
      await observer?.onExecution?.({
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
      })
      await observer?.onSession?.({
        transport: 'codex',
        sessionId: `provider-${input.runId}`,
        executionKey: 'fixture-execution',
      })
      if (input.workspaceMode === 'isolated_write') {
        await Bun.write(
          join(input.cwd, 'src', 'value.ts'),
          `export const value = ${inputs.length + 1}\n`,
        )
      }
      return {
        termination: 'normal',
        reportMarkdown: `Run ${input.runId} completed.`,
        artifacts: [],
        exitCode: 0,
      }
    },
  }
  let nextRun = 0
  const releaseUpdates: Array<{ projectId: string; commit: string }> = []
  const reconciler = createProjectReconciler({
    homeRoot,
    projectId: 'project-1',
    projectRoot: linked.integrationRoot,
    primaryRepoId: linked.primaryRepoId,
    projectRepos: linked.repos,
    store,
    publisher,
    workerRunner,
    attempts,
    now: () => new Date('2026-08-13T00:00:00Z'),
    createRunId: () => `run-${++nextRun}`,
    onReleaseUpdated(update) {
      releaseUpdates.push(update)
    },
  })

  return {
    homeRoot,
    linked,
    store,
    attempts,
    reconciler,
    inputs,
    releaseUpdates,
    enqueue(handler: RunHandler) {
      handlers.push(handler)
    },
    request(request: RunRequest) {
      return reconciler.requestWorkRun('goal-1', 'W-1', request)
    },
    reconcile() {
      return reconciler.reconcileGoal('goal-1', {
        projectEligible: true,
        workerCapacity: true,
      })
    },
  }
}

function writeRequest(instructionMarkdown: string): RunRequest {
  return {
    workspaceMode: 'isolated_write',
    instructionMarkdown,
    refs: [],
  }
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${stderr || stdout}`)
  return stdout.trim()
}
