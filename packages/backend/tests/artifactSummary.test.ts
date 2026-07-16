import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderInboxEventDocument } from '../src/domain/assistantWorkspaceDocuments'
import { formatTestRunSummary, readTestRunSummary } from './e2e/artifactSummary'
import { semanticDirectoryDigest } from './live/liveHarness'
import {
  type TestRunContext,
  enterTestRunPhase,
  finishTestRun,
  markTestRunCheckpoint,
  recordTestRunAction,
  writeTestRunReport,
} from './testRunArtifact'

test('artifact summary derives generic and HOPI facts without mutating the source Run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hopi-artifact-summary-'))
  const homeRoot = join(root, 'home')
  const inboxRoot = join(homeRoot, '.hopi', 'docs', 'assistant', 'inbox')
  const context: TestRunContext = {
    artifactRoot: root,
    scenario: 'summary-fixture',
    claim: 'live',
    startedAt: '2026-07-15T00:00:00.000Z',
    code: {
      head: 'a'.repeat(40),
      branch: 'main',
      dirty: false,
      status: [],
      worktreeDigest: 'b'.repeat(64),
    },
  }
  try {
    await mkdir(inboxRoot, { recursive: true })
    await writeTestRunReport(context, 'running')
    await enterTestRunPhase(context, 'agent_execution')
    await markTestRunCheckpoint(context, 'goal_admitted')
    await recordTestRunAction(context, 'goal_delivery_verified')
    await Bun.write(
      join(root, 'states.jsonl'),
      `${JSON.stringify({
        observedAt: '2026-07-16T00:00:01.000Z',
        state: {
          activeRuns: [{ key: 'P-1/G-1/W-1', responsibility: 'generator' }],
          attentions: [{ id: 'A-1', resolvedAt: null }],
          projects: [
            {
              projectId: 'P-1',
              goals: [
                { id: 'G-1', lifecycle: 'active' },
                { id: 'G-2', lifecycle: 'done' },
              ],
            },
          ],
        },
      })}\n`,
    )
    await Bun.write(
      join(root, 'invariants.jsonl'),
      `${JSON.stringify({
        observedAt: '2026-07-16T00:00:02.000Z',
        violation: 'fixture invariant',
      })}\n`,
    )
    await Bun.write(
      join(inboxRoot, 'EV-pending.md'),
      renderInboxEventDocument({
        attributes: {
          id: 'EV-pending',
          receivedAt: '2026-07-16T00:00:00.000Z',
          status: 'pending',
          source: 'reflection',
          visibility: 'internal',
          sourceDigest: 'c'.repeat(64),
          attachments: [],
          context: null,
          handledAt: null,
          reply: null,
          disposition: null,
          webhookDeliveredAt: null,
        },
        body: 'Pending internal brief.',
      }),
    )
    await finishTestRun(context, 'passed', {
      paths: { home: homeRoot },
      lastCheckpoint: 'goal_admitted',
      error: 'Timed out waiting for completion. Last value: {"large":"state"}',
      usage: {
        logicalRuns: { assistant: 1, reflection: 1, planner: 1, generator: 1, reviewer: 0 },
        logicalRunTotal: 4,
        tokens: { input: 100, cachedInput: 60, uncachedInput: 40, output: 10 },
        byScope: {
          assistant: { input: 40, cachedInput: 20, output: 4 },
          reflection: { input: 0, cachedInput: 0, output: 0 },
          planner: { input: 30, cachedInput: 20, output: 3 },
          generator: { input: 30, cachedInput: 20, output: 3 },
          reviewer: { input: 0, cachedInput: 0, output: 0 },
        },
      },
    })
    const before = await semanticDirectoryDigest(root)

    const summary = await readTestRunSummary(root)
    const formatted = formatTestRunSummary(summary)

    expect(summary).toMatchObject({
      scenario: 'summary-fixture',
      claim: 'live',
      status: 'passed',
      currentPhase: 'agent_execution',
      lastCheckpoint: 'goal_admitted',
      lastAction: 'goal_delivery_verified',
      cleanup: { status: 'passed', completed: 0, total: 0 },
      invariants: ['fixture invariant'],
      state: {
        activeRuns: 1,
        unresolvedAttentions: 1,
        pendingInbox: 1,
        goalLifecycles: { active: 1, done: 1 },
      },
      usage: {
        logicalRuns: 4,
        input: 100,
        cachedInput: 60,
        uncachedInput: 40,
        output: 10,
      },
    })
    expect(formatted).toContain('State: activeRuns=1 unresolvedAttentions=1 pendingInbox=1')
    expect(formatted).toContain('Models: logicalRuns=4 input=100 cached=60 uncached=40 output=10')
    expect(formatted).toContain(
      'Failure: Timed out waiting for completion. Last value retained in run.json.',
    )
    expect(formatted).not.toContain('{"large":"state"}')
    expect(await semanticDirectoryDigest(root)).toBe(before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
