import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { readAssistantConversationEpoch } from '../src/assistant/assistantConversationEpoch'
import {
  inboxSourceDigest,
  renderInboxEventDocument,
  renderWorkspaceAttentionDocument,
} from '../src/domain/assistantWorkspaceDocuments'
import { ASSISTANT_HOME_SCHEMA_EPOCH } from '../src/domain/project'
import { acquireCoordinatorInstanceLock } from '../src/publication/instanceLock'
import { managedRepoWorktreePaths } from '../src/runtime/managedWorktreePaths'
import { ProjectResetError, applyProjectReset, planProjectReset } from '../src/runtime/projectReset'

describe('Project reset maintenance', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  test('clears one Project while preserving its topology, release source, and user checkout', async () => {
    const fixture = await createFixture()
    roots.push(fixture.root)

    const userBefore = await checkoutSnapshot(fixture.repoRoot)
    const releaseBefore = await git(fixture.integrationRoot, ['rev-parse', 'HEAD'])
    const plan = await planProjectReset({
      homeRoot: fixture.homeRoot,
      projectId: 'P-1',
    })

    expect(plan.blockers).toEqual([])
    expect(plan.goals.ids).toEqual(['G-1'])
    expect(plan.assistant.eventIds).toEqual(['EV-P1'])
    expect(plan.assistant.attentionIds).toEqual(['AT-P1'])
    expect(plan.runtime.runRoots).toHaveLength(1)
    expect(plan.runtime.wakeRunRoots).toHaveLength(1)
    expect(plan.repos[0]?.taskWorktrees).toEqual([await realpath(fixture.taskRoot)])
    expect(plan.repos[0]?.workRefs).toEqual(['refs/heads/hopi/work/P-1/G-1/W-1'])
    expect(await Bun.file(fixture.goalPath).exists()).toBe(true)

    await expect(
      applyProjectReset({
        homeRoot: fixture.homeRoot,
        projectId: 'P-1',
        confirm: 'P-2',
      }),
    ).rejects.toThrow(ProjectResetError)
    expect(await checkoutSnapshot(fixture.repoRoot)).toEqual(userBefore)
    expect(await Bun.file(fixture.goalPath).exists()).toBe(true)

    const result = await applyProjectReset({
      homeRoot: fixture.homeRoot,
      projectId: 'P-1',
      confirm: 'P-1',
    })

    expect(result.kind).toBe('reset')
    expect(result.releaseCommit).not.toBeNull()
    expect(result.releaseCommit).not.toBe(releaseBefore)
    expect(await checkoutSnapshot(fixture.repoRoot)).toEqual(userBefore)
    expect(await Bun.file(join(fixture.integrationRoot, 'app.txt')).text()).toBe('source\n')
    expect(await Bun.file(fixture.goalPath).exists()).toBe(false)
    expect(
      (
        await git(
          fixture.integrationRoot,
          ['show', `${result.releaseCommit}:.hopi/docs/goals/G-1/goal.md`],
          true,
        )
      ).exitCode,
    ).not.toBe(0)
    expect(await Bun.file(fixture.taskRoot).exists()).toBe(false)
    expect(
      (
        await git(
          fixture.repoRoot,
          ['show-ref', '--verify', 'refs/heads/hopi/work/P-1/G-1/W-1'],
          true,
        )
      ).exitCode,
    ).not.toBe(0)

    expect(await exists(join(fixture.homeRoot, '.hopi/docs/assistant/inbox/EV-P1.md'))).toBe(false)
    expect(await exists(join(fixture.homeRoot, '.hopi/docs/assistant/inbox/EV-P2.md'))).toBe(true)
    expect(await exists(join(fixture.homeRoot, '.hopi/docs/attention/AT-P1.md'))).toBe(false)
    expect(await exists(fixture.orphanAttachment)).toBe(false)
    expect(await exists(fixture.sharedAttachment)).toBe(true)
    expect(await exists(join(fixture.homeRoot, '.hopi/runtime/runs/R-P1'))).toBe(false)
    expect(await exists(join(fixture.homeRoot, '.hopi/runtime/runs/R-P2'))).toBe(true)
    expect(await exists(join(fixture.homeRoot, '.hopi/runtime/responsibility-sessions/P-1'))).toBe(
      false,
    )
    expect(await exists(join(fixture.homeRoot, '.hopi/runtime/responsibility-sessions/P-2'))).toBe(
      true,
    )
    expect(await exists(result.manifestPath)).toBe(true)
    expect(
      await readAssistantConversationEpoch(fixture.homeRoot, {
        kind: 'project',
        projectId: 'P-1',
      }),
    ).toMatchObject({
      streamId: result.conversationStreamId,
      removedFeedEntryIds: ['event:EV-P1'],
    })
    expect(await Bun.file(join(fixture.homeRoot, '.hopi/projects.yml')).text()).toContain(
      'projectId: P-1',
    )

    const repeated = await applyProjectReset({
      homeRoot: fixture.homeRoot,
      projectId: 'P-1',
      confirm: 'P-1',
    })
    expect(repeated.releaseCommit).toBeNull()
    expect(repeated.plan.goals.ids).toEqual([])
    expect(repeated.plan.assistant.eventIds).toEqual([])
    expect(
      await readAssistantConversationEpoch(fixture.homeRoot, {
        kind: 'project',
        projectId: 'P-1',
      }),
    ).toMatchObject({
      streamId: repeated.conversationStreamId,
      removedFeedEntryIds: ['event:EV-P1'],
    })
  })

  test('blocks an Attention that belongs to more than one Project before mutation', async () => {
    const fixture = await createFixture()
    roots.push(fixture.root)
    await writeAttention(fixture.homeRoot, 'AT-SHARED', ['project:P-1', 'project:P-2'])

    const plan = await planProjectReset({
      homeRoot: fixture.homeRoot,
      projectId: 'P-1',
    })

    expect(plan.blockers).toEqual([
      'Workspace Attention AT-SHARED refers to multiple Projects: P-1, P-2',
    ])
    await expect(
      applyProjectReset({
        homeRoot: fixture.homeRoot,
        projectId: 'P-1',
        confirm: 'P-1',
      }),
    ).rejects.toThrow('Project reset plan is blocked')
    expect(await exists(fixture.goalPath)).toBe(true)
    expect(await exists(join(fixture.homeRoot, '.hopi/docs/assistant/inbox/EV-P1.md'))).toBe(true)
  })

  test('requires exclusive offline ownership before applying', async () => {
    const fixture = await createFixture()
    roots.push(fixture.root)
    const lock = await acquireCoordinatorInstanceLock(
      join(fixture.homeRoot, '.hopi/runtime/coordinator.lock'),
    )

    try {
      await expect(
        applyProjectReset({
          homeRoot: fixture.homeRoot,
          projectId: 'P-1',
          confirm: 'P-1',
        }),
      ).rejects.toThrow('requires the HOPI service to be stopped')
      expect(await exists(fixture.goalPath)).toBe(true)
    } finally {
      await lock.release()
    }
  })
})

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-project-reset-'))
  const homeRoot = join(root, 'home')
  const repoRoot = join(root, 'repo')
  await mkdir(repoRoot, { recursive: true })
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await Bun.write(join(repoRoot, 'app.txt'), 'source\n')
  await Bun.write(join(repoRoot, '.gitignore'), '.hopi/docs\n')
  await mkdir(join(repoRoot, '.hopi'), { recursive: true })
  await Bun.write(
    join(repoRoot, '.hopi/project.yml'),
    stringify({
      projectId: 'P-1',
      primaryRepoId: 'primary',
      repos: [{ repoId: 'primary' }],
    }),
  )
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])

  const managed = managedRepoWorktreePaths(repoRoot, 'P-1')
  await git(repoRoot, ['branch', 'hopi/project/P-1/release'])
  await mkdir(join(managed.integration, '..'), { recursive: true })
  await git(repoRoot, ['worktree', 'add', managed.integration, 'hopi/project/P-1/release'])

  const goalPath = join(managed.integration, '.hopi/docs/goals/G-1/goal.md')
  await mkdir(join(goalPath, '..'), { recursive: true })
  await Bun.write(goalPath, '# Goal\n')
  await git(managed.integration, ['add', '-f', '.hopi/docs/goals'])
  await git(managed.integration, ['commit', '-m', 'goal state'])

  const workBranch = 'hopi/work/P-1/G-1/W-1'
  const taskRoot = join(managed.work, 'G-1', 'W-1')
  await git(repoRoot, ['branch', workBranch, 'hopi/project/P-1/release'])
  await mkdir(join(taskRoot, '..'), { recursive: true })
  await git(repoRoot, ['worktree', 'add', taskRoot, workBranch])
  await Bun.write(join(taskRoot, 'uncommitted.txt'), 'discard me\n')

  await mkdir(join(homeRoot, '.hopi'), { recursive: true })
  await Bun.write(
    join(homeRoot, '.hopi/home.yml'),
    stringify({ schemaEpoch: ASSISTANT_HOME_SCHEMA_EPOCH, homeId: 'H-1' }),
  )
  await Bun.write(
    join(homeRoot, '.hopi/projects.yml'),
    stringify({
      projects: [
        {
          projectId: 'P-1',
          primaryRepoId: 'primary',
          repos: [{ repoId: 'primary', repoPath: repoRoot }],
        },
        {
          projectId: 'P-2',
          primaryRepoId: 'primary',
          repos: [{ repoId: 'primary', repoPath: repoRoot }],
        },
      ],
    }),
  )

  const sharedReference = '.hopi/docs/assistant/attachments/shared/image.png'
  const orphanReference = '.hopi/docs/assistant/attachments/orphan/image.png'
  const sharedAttachment = join(homeRoot, ...sharedReference.split('/'))
  const orphanAttachment = join(homeRoot, ...orphanReference.split('/'))
  await mkdir(join(sharedAttachment, '..'), { recursive: true })
  await mkdir(join(orphanAttachment, '..'), { recursive: true })
  await Bun.write(sharedAttachment, 'shared')
  await Bun.write(orphanAttachment, 'orphan')
  await writeEvent(homeRoot, 'EV-P1', 'P-1', [sharedReference, orphanReference])
  await writeEvent(homeRoot, 'EV-P2', 'P-2', [sharedReference])
  await writeAttention(homeRoot, 'AT-P1', ['project:P-1'])

  await writeJson(join(homeRoot, '.hopi/runtime/runs/R-P1/attempt.json'), {
    projectId: 'P-1',
  })
  await writeJson(join(homeRoot, '.hopi/runtime/runs/R-P2/attempt.json'), {
    projectId: 'P-2',
  })
  await writeJson(join(homeRoot, '.hopi/runtime/assistant/wakes/runs/WK-P1/wake.json'), {
    scope: { kind: 'project', projectId: 'P-1' },
  })
  await writeFile(join(homeRoot, '.hopi/runtime/assistant/turns/EV-P1/events.jsonl'), '')
  await writeFile(join(homeRoot, '.hopi/runtime/assistant/turns/EV-P2/events.jsonl'), '')
  await writeFile(join(homeRoot, '.hopi/runtime/assistant/sessions/projects/P-1.json'), '{}\n')
  await writeFile(join(homeRoot, '.hopi/runtime/assistant/workspace/projects/P-1/file'), '')
  await writeFile(join(homeRoot, '.hopi/runtime/assistant/wakes/cursors/project-P-1.json'), '{}\n')
  await writeFile(join(homeRoot, '.hopi/runtime/responsibility-sessions/P-1/file'), '')
  await writeFile(join(homeRoot, '.hopi/runtime/responsibility-sessions/P-2/file'), '')
  await writeFile(join(homeRoot, '.hopi/runtime/preview/P-1/session/file'), '')

  return {
    root,
    homeRoot,
    repoRoot,
    integrationRoot: managed.integration,
    taskRoot,
    goalPath,
    sharedAttachment,
    orphanAttachment,
  }
}

async function writeEvent(
  homeRoot: string,
  eventId: string,
  projectId: string,
  attachments: string[],
) {
  const body = `Message for ${projectId}`
  const timestamp = '2026-07-26T00:00:00.000Z'
  const sourceDigest = await inboxSourceDigest(body, attachments)
  const path = join(homeRoot, '.hopi/docs/assistant/inbox', `${eventId}.md`)
  await mkdir(join(path, '..'), { recursive: true })
  await Bun.write(
    path,
    renderInboxEventDocument({
      attributes: {
        id: eventId,
        receivedAt: timestamp,
        status: 'handled',
        source: 'user',
        visibility: 'public',
        sourceDigest,
        attachments,
        context: { projectId },
        handledAt: timestamp,
        reply: 'Handled',
        disposition: 'answered',
        webhookDeliveredAt: null,
      },
      body,
    }),
  )
}

async function writeAttention(homeRoot: string, attentionId: string, refs: string[]) {
  const timestamp = '2026-07-26T00:00:00.000Z'
  const path = join(homeRoot, '.hopi/docs/attention', `${attentionId}.md`)
  await mkdir(join(path, '..'), { recursive: true })
  await Bun.write(
    path,
    renderWorkspaceAttentionDocument({
      attributes: {
        id: attentionId,
        createdAt: timestamp,
        updatedAt: timestamp,
        resolvedAt: null,
        refs,
        summary: 'Attention',
      },
      body: 'Attention',
    }),
  )
}

async function checkoutSnapshot(repoRoot: string) {
  const [branch, head, status] = await Promise.all([
    git(repoRoot, ['branch', '--show-current']),
    git(repoRoot, ['rev-parse', 'HEAD']),
    git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ])
  return {
    branch: branch.stdout,
    head: head.stdout,
    status: status.rawStdout,
  }
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value)}\n`)
}

async function writeFile(path: string, content: string) {
  await mkdir(join(path, '..'), { recursive: true })
  await Bun.write(path, content)
}

async function exists(path: string) {
  return stat(path)
    .then(() => true)
    .catch(() => false)
}

async function git(cwd: string, args: string[], allowFailure = false) {
  const child = Bun.spawn(['git', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [rawStdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const result = {
    stdout: rawStdout.trim(),
    rawStdout,
    stderr: stderr.trim(),
    exitCode,
  }
  if (exitCode !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result
}
