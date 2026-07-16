import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { renderInboxEventDocument } from '../src/domain/assistantWorkspaceDocuments'
import { DEFAULT_PROJECT_CODING_DEFAULTS } from '../src/domain/projectCodingDefaults'
import {
  type LiveHarness,
  countLogicalRuns,
  finishLiveHarness,
  gitOutput,
  readCodeProvenance,
  readGitSemanticState,
  readModelUsage,
  readPendingInboxEvents,
  registerLogicalRunSafety,
  resolveBrowserAuditMode,
  semanticDirectoryDigest,
  settledAttentionLivenessViolations,
  shutdownLiveHarness,
  waitForValue,
} from './live/liveHarness'
import { cleanupTestRun, finishTestRun, readTestRun, writeTestRunReport } from './testRunArtifact'

test('browser audit degradation is explicit and never fabricates verification', () => {
  expect(resolveBrowserAuditMode({ valid: true }, false)).toBe('verified')
  expect(resolveBrowserAuditMode({ available: false }, true)).toBe('unavailable-allowed')
  expect(() => resolveBrowserAuditMode({ available: false }, false)).toThrow(
    'Browser Harness audit verification failed',
  )
  expect(() => resolveBrowserAuditMode({ valid: false }, true)).toThrow(
    'Browser Harness audit verification failed',
  )
})

test('settled Attention liveness rejects only unresolved unnotified targeted blockers', () => {
  expect(
    settledAttentionLivenessViolations({
      attentions: [
        {
          id: 'A-orphaned',
          target: 'project:P-1/goal:G-1',
          body: 'Needs delivery.',
          resolvedAt: null,
          notifiedAt: null,
        },
        {
          id: 'A-notified',
          target: 'project:P-1/goal:G-2',
          body: 'Already delivered.',
          resolvedAt: null,
          notifiedAt: '2026-07-16T00:00:00.000Z',
        },
        {
          id: 'A-resolved',
          target: 'project:P-1/goal:G-3',
          body: 'Already resolved.',
          resolvedAt: '2026-07-16T00:00:00.000Z',
          notifiedAt: null,
        },
        {
          id: 'A-targetless',
          target: null,
          body: 'Completion projection.',
          resolvedAt: null,
          notifiedAt: null,
        },
      ],
    }),
  ).toEqual([
    'settled boundary retains unnotified targeted Attention A-orphaned at project:P-1/goal:G-1',
  ])
})

test('reads hidden runtime usage and pending canonical Inbox events', async () => {
  const homeRoot = await mkdtemp(join(tmpdir(), 'hopi-live-harness-'))
  try {
    const assistantRoot = join(homeRoot, '.hopi', 'runtime', 'assistant', 'turns', 'EV-1')
    const plannerRoot = join(homeRoot, '.hopi', 'runtime', 'runs', 'R-1')
    const inboxRoot = join(homeRoot, '.hopi', 'docs', 'assistant', 'inbox')
    await Promise.all([
      mkdir(assistantRoot, { recursive: true }),
      mkdir(plannerRoot, { recursive: true }),
      mkdir(inboxRoot, { recursive: true }),
    ])
    await Bun.write(join(assistantRoot, 'turn.json'), JSON.stringify({ attempt: 2 }))
    await Bun.write(
      join(assistantRoot, 'transcript.log'),
      'stdout: {"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":2}}\n',
    )
    await Bun.write(
      join(plannerRoot, 'attempt.json'),
      JSON.stringify({ responsibility: 'planner' }),
    )
    await Bun.write(
      join(plannerRoot, 'transcript.log'),
      'stdout: {"type":"turn.completed","usage":{"input_tokens":20,"cached_input_tokens":5,"output_tokens":3}}\n',
    )
    await Bun.write(
      join(inboxRoot, 'EV-pending.md'),
      renderInboxEventDocument(inboxEvent('EV-pending', 'pending')),
    )
    await Bun.write(
      join(inboxRoot, 'EV-handled.md'),
      renderInboxEventDocument(inboxEvent('EV-handled', 'handled')),
    )

    expect(await readPendingInboxEvents(homeRoot)).toEqual([
      { eventId: 'EV-pending', source: 'reflection', visibility: 'internal' },
    ])
    expect(await readModelUsage(homeRoot)).toMatchObject({
      logicalRuns: { assistant: 2, planner: 1 },
      logicalRunTotal: 3,
      transcriptFiles: 2,
      providerUsageEvents: 2,
      tokens: { input: 30, cachedInput: 9, output: 5, uncachedInput: 21 },
      byScope: {
        assistant: { input: 10, cachedInput: 4, output: 2, usageEvents: 1 },
        planner: { input: 20, cachedInput: 5, output: 3, usageEvents: 1 },
      },
    })
  } finally {
    await rm(homeRoot, { recursive: true, force: true })
  }
})

test('logical Run safety stops a runaway once and cleans up through the Test Run lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hopi-live-run-safety-'))
  const homeRoot = join(root, 'home')
  const context = {
    artifactRoot: root,
    scenario: 'logical-run-safety',
    claim: 'live' as const,
    startedAt: '2026-07-16T00:00:00.000Z',
    code: {
      head: 'a'.repeat(40),
      branch: 'main',
      dirty: false,
      status: [],
      worktreeDigest: 'b'.repeat(64),
    },
  }
  try {
    await writeTestRunReport(context, 'running')
    for (const id of ['RF-1', 'RF-2']) {
      const reflectionRoot = join(homeRoot, '.hopi', 'runtime', 'assistant', 'reflections', id)
      await mkdir(reflectionRoot, { recursive: true })
      await Bun.write(join(reflectionRoot, 'reflection.json'), '{}\n')
    }
    const partialAttempt = join(homeRoot, '.hopi', 'runtime', 'runs', 'R-writing', 'attempt.json')
    await mkdir(dirname(partialAttempt), { recursive: true })
    await Bun.write(partialAttempt, '{"responsibility":')
    expect(await countLogicalRuns(homeRoot, { tolerateUnreadable: true })).toMatchObject({
      reflection: 2,
    })
    const guard = registerLogicalRunSafety(context, homeRoot, { limit: 1 })
    let reads = 0

    await expect(
      waitForValue(
        async () => {
          reads += 1
          return false
        },
        Boolean,
        { timeoutMs: 100, intervalMs: 1, description: 'a value that must not be read' },
      ),
    ).rejects.toThrow('Logical Run safety limit exceeded: 2 > 1')
    await expect(guard.check()).rejects.toThrow('Logical Run safety limit exceeded: 2 > 1')
    expect(reads).toBe(0)
    const actions = await Bun.file(join(root, 'actions.jsonl')).text()
    expect(actions.match(/logical_run_limit_exceeded/g)).toHaveLength(1)

    const report = await finishTestRun(context, 'failed', { error: 'runaway stopped' })
    expect(report).toMatchObject({
      status: 'failed',
      cleanup: {
        status: 'passed',
        resources: [{ name: 'logical-run-safety', status: 'completed' }],
      },
    })
  } finally {
    await cleanupTestRun(context).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('semantic artifact digest ignores Git internals but covers retained evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hopi-artifact-digest-'))
  try {
    await mkdir(join(root, '.git'), { recursive: true })
    await Bun.write(join(root, '.git', 'index'), 'first Git implementation detail')
    await Bun.write(join(root, 'run.json'), '{"status":"passed"}\n')
    const initial = await semanticDirectoryDigest(root)

    await Bun.write(join(root, '.git', 'index'), 'second Git implementation detail')
    expect(await semanticDirectoryDigest(root)).toBe(initial)

    await Bun.write(join(root, 'run.json'), '{"status":"failed"}\n')
    expect(await semanticDirectoryDigest(root)).not.toBe(initial)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('code provenance includes dirty and untracked worktree content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hopi-code-provenance-'))
  try {
    await gitOutput(root, ['init', '-b', 'main'])
    await gitOutput(root, ['config', 'user.email', 'hopi@example.test'])
    await gitOutput(root, ['config', 'user.name', 'HOPI Test'])
    await Bun.write(join(root, 'tracked.txt'), 'tracked\n')
    await gitOutput(root, ['add', '.'])
    await gitOutput(root, ['commit', '-m', 'initial'])
    const clean = await readCodeProvenance(root)
    expect(clean).toMatchObject({ branch: 'main', dirty: false, status: [] })
    const gitBefore = await readGitSemanticState(root)

    await Bun.write(join(root, 'untracked.txt'), 'first\n')
    const dirty = await readCodeProvenance(root)
    expect(dirty.dirty).toBe(true)
    expect(dirty.status).toEqual(['?? untracked.txt'])
    expect(dirty.worktreeDigest).not.toBe(clean.worktreeDigest)

    await Bun.write(join(root, 'untracked.txt'), 'second\n')
    expect((await readCodeProvenance(root)).worktreeDigest).not.toBe(dirty.worktreeDigest)

    await gitOutput(root, ['branch', 'retained-evidence'])
    const gitAfter = await readGitSemanticState(root)
    expect(gitAfter.refs).not.toEqual(gitBefore.refs)
    expect(gitAfter.status).toBe('?? untracked.txt')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Live Test Run stops its server before sealing terminal evidence', async () => {
  const artifactRoot = await mkdtemp(join(tmpdir(), 'hopi-live-terminal-'))
  const homeRoot = join(artifactRoot, 'home')
  const repoRoot = join(artifactRoot, 'repo')
  let shutdowns = 0
  const harness: LiveHarness = {
    scenario: 'terminal-shutdown-order',
    claim: 'live',
    artifactRoot,
    homeRoot,
    repoRoot,
    baseUrl: 'http://127.0.0.1:0',
    codingDefaults: DEFAULT_PROJECT_CODING_DEFAULTS,
    modelBoundaries: { reflection: 'real' },
    code: {
      head: 'a'.repeat(40),
      branch: 'main',
      dirty: false,
      status: [],
      worktreeDigest: 'b'.repeat(64),
    },
    currentPhase: 'verification',
    lastCheckpoint: 'complete',
    logicalRunLimit: 50,
    startedAt: '2026-07-14T00:00:00.000Z',
    server: {
      shutdown: async () => {
        shutdowns += 1
      },
    } as unknown as LiveHarness['server'],
    stopped: false,
  }

  try {
    await Promise.all([mkdir(homeRoot, { recursive: true }), mkdir(repoRoot, { recursive: true })])
    await writeTestRunReport(harness, 'running')
    await finishLiveHarness(harness, 'passed')
    const actionsBeforeSecondShutdown = await Bun.file(join(artifactRoot, 'actions.jsonl')).text()

    await shutdownLiveHarness(harness)

    expect(shutdowns).toBe(1)
    expect(await Bun.file(join(artifactRoot, 'actions.jsonl')).text()).toBe(
      actionsBeforeSecondShutdown,
    )
    expect(actionsBeforeSecondShutdown).toContain('"action":"server_stopped"')
    const report = await readTestRun(artifactRoot)
    const retainedActions = report.evidence.find((evidence) => evidence.path === 'actions.jsonl')
    const hasher = new Bun.CryptoHasher('sha256')
    hasher.update(await Bun.file(join(artifactRoot, 'actions.jsonl')).arrayBuffer())
    expect(retainedActions?.sha256).toBe(hasher.digest('hex'))
  } finally {
    await rm(artifactRoot, { recursive: true, force: true })
  }
})

function inboxEvent(id: string, status: 'pending' | 'handled') {
  return {
    attributes: {
      id,
      receivedAt: '2026-07-13T00:00:00.000Z',
      status,
      source: 'reflection' as const,
      visibility: 'internal' as const,
      sourceDigest: 'a'.repeat(64),
      attachments: [],
      context: null,
      handledAt: status === 'handled' ? '2026-07-13T00:00:01.000Z' : null,
      reply: status === 'handled' ? 'Handled.' : null,
      disposition: status === 'handled' ? 'answered' : null,
      webhookDeliveredAt: null,
    },
    body: 'Internal reflection brief.',
  }
}
