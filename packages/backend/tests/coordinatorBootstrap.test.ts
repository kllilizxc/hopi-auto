import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { HOPI_RELEASE_REF } from '../src/domain/project'
import { PublicationCoordinator } from '../src/publication/publisher'
import { CoordinatorBootError, bootstrapCoordinator } from '../src/runtime/coordinatorBootstrap'
import { createWorkspaceAttentionController } from '../src/runtime/workspaceAttentionController'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../src/storage/assistantWorkspaceStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'coordinator-bootstrap')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('bootstrapCoordinator', () => {
  test('blocks a dirty delivery checkout without changing it', async () => {
    const fixture = await setup()
    await Bun.write(join(fixture.repoRoot, 'local.txt'), 'dirty user checkout\n')
    const legitimate = join(fixture.projectRoot, '.hopi', 'notes.tmp.keep')
    const abandoned = join(
      fixture.projectRoot,
      '.hopi',
      'source.ts.tmp.11111111-1111-4111-8111-111111111111',
    )
    await Bun.write(legitimate, 'keep\n')
    await Bun.write(abandoned, 'remove\n')

    const result = await fixture.bootstrap()

    expect([...result.eligibleProjectIds]).toEqual([])
    expect([...result.blockedProjectIds]).toEqual(['P-1'])
    expect(await Bun.file(legitimate).exists()).toBe(true)
    expect(await Bun.file(abandoned).exists()).toBe(false)
  })

  test('allows only the scoped Planner AGENTS bootstrap before its first C1', async () => {
    const fixture = await setup(false, 'apps/new project')
    const agentsPath = join(fixture.projectRoot, 'apps', 'new project', 'AGENTS.md')
    await mkdir(join(agentsPath, '..'), { recursive: true })
    await Bun.write(agentsPath, '# Scoped project guidance\n')

    const result = await fixture.bootstrap()

    expect([...result.eligibleProjectIds]).toEqual(['P-1'])
    expect([...result.blockedProjectIds]).toEqual([])
  })

  test('archives and repairs primary managed source without removing canonical documents', async () => {
    const fixture = await setup()
    await Bun.write(join(fixture.projectRoot, 'README.md'), 'planner changed source\n')
    await Bun.write(join(fixture.projectRoot, 'leaked.spec.ts'), 'planner leaked source\n')
    await git(fixture.projectRoot, ['add', 'README.md', 'leaked.spec.ts'])

    const result = await fixture.bootstrap()

    expect([...result.eligibleProjectIds]).toEqual(['P-1'])
    expect(await Bun.file(join(fixture.projectRoot, 'README.md')).text()).toBe('# Repo\n')
    expect(await Bun.file(join(fixture.projectRoot, 'leaked.spec.ts')).exists()).toBe(false)
    expect(await Bun.file(join(fixture.projectRoot, '.hopi', 'project.yml')).exists()).toBe(true)
    const recoveryRoot = join(fixture.projectRoot, '..', 'recovery')
    const recoveries = await readdir(recoveryRoot)
    expect(recoveries).toHaveLength(1)
    const recoveryPath = join(recoveryRoot, recoveries[0] ?? '')
    expect(await Bun.file(join(recoveryPath, 'files', 'README.md')).text()).toBe(
      'planner changed source\n',
    )
    expect(await Bun.file(join(recoveryPath, 'files', 'leaked.spec.ts')).text()).toBe(
      'planner leaked source\n',
    )
  })

  test('creates and reuses one project Attention for invalid canonical identity', async () => {
    const fixture = await setup()
    await Bun.write(
      join(fixture.projectRoot, '.hopi', 'project.yml'),
      'version: 1\nprojectId: another\n',
    )

    const first = await fixture.bootstrap()
    const second = await fixture.bootstrap()
    const workspace = await fixture.workspace.readWorkspace()

    expect([...first.blockedProjectIds]).toEqual(['P-1'])
    expect([...second.blockedProjectIds]).toEqual(['P-1'])
    expect(
      [...workspace.attentions.values()].filter(
        (attention) =>
          attention.attributes.target === 'project:P-1' && attention.attributes.resolvedAt === null,
      ),
    ).toHaveLength(1)
  })

  test('repairs a regressed managed ref but refuses to roll back the delivery checkout', async () => {
    const fixture = await setup(true)
    const parent = await git(fixture.projectRoot, ['rev-parse', `${HOPI_RELEASE_REF}^`])
    await git(fixture.projectRoot, ['update-ref', HOPI_RELEASE_REF, parent])

    const result = await fixture.bootstrap()

    expect([...result.blockedProjectIds]).toEqual(['P-1'])
    expect([...(await fixture.workspace.readWorkspace()).attentions.values()][0]?.body).toContain(
      'cannot fast-forward',
    )
  })

  test('fails closed when Assistant-home truth is invalid', async () => {
    const fixture = await setup()
    await Bun.write(fixture.home.paths.homeDocumentPath, 'version: 1\nhomeId: invalid id\n')

    await expect(fixture.bootstrap()).rejects.toBeInstanceOf(CoordinatorBootError)
  })
})

async function setup(twoCommits = false, projectPath?: string) {
  const repoRoot = join(temporaryRoot, 'repo')
  await mkdir(repoRoot, { recursive: true })
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await Bun.write(join(repoRoot, 'README.md'), '# Repo\n')
  const selectedPath = projectPath ? join(repoRoot, ...projectPath.split('/')) : repoRoot
  if (projectPath) {
    await mkdir(selectedPath, { recursive: true })
    await Bun.write(join(selectedPath, 'README.md'), '# Scoped project\n')
  }
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])
  if (twoCommits) {
    await Bun.write(join(repoRoot, 'source.ts'), 'export const value = 1\n')
    await git(repoRoot, ['add', '.'])
    await git(repoRoot, ['commit', '-m', 'source'])
  }
  const homeRoot = join(temporaryRoot, 'home')
  const home = createAssistantHomeStore(homeRoot)
  const linked = await home.linkProject({ projectId: 'P-1', repoPath: selectedPath })
  const publisher = new PublicationCoordinator()
  const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
  const store = createGoalPackageStore(linked.integrationRoot, 'P-1', publisher, linked.projectPath)
  const attentions = createWorkspaceAttentionController(
    workspace,
    () => new Date('2026-07-11T00:00:00Z'),
  )
  return {
    repoRoot,
    projectRoot: linked.integrationRoot,
    home,
    workspace,
    bootstrap: () =>
      bootstrapCoordinator({
        homeRoot,
        home,
        workspace,
        projects: [
          {
            projectId: 'P-1',
            projectRoot: linked.integrationRoot,
            store,
          },
        ],
        attentions,
      }),
  }
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
  return stdout.trim()
}
