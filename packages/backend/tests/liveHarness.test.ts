import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderInboxEventDocument } from '../src/domain/assistantWorkspaceDocuments'
import {
  gitOutput,
  readCodeProvenance,
  readGitSemanticState,
  readModelUsage,
  readPendingInboxEvents,
  semanticDirectoryDigest,
} from './live/liveHarness'

test('reads hidden runtime usage and pending canonical Inbox events', async () => {
  const homeRoot = await mkdtemp(join(tmpdir(), 'hopi-live-harness-'))
  try {
    const assistantRoot = join(homeRoot, '.hopi', 'runtime', 'assistant', 'turns', 'EV-1')
    const plannerRoot = join(homeRoot, '.hopi', 'runtime', 'runs', 'P-1', 'G-1', 'W-1', 'R-1')
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
