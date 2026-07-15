import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'
import { HOPI_RELEASE_BRANCH, HOPI_RELEASE_REF } from '../src/domain/project'
import {
  AssistantHomeStoreError,
  createAssistantHomeStore,
} from '../src/storage/assistantHomeStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'assistant-home-store')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterAll(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('createAssistantHomeStore', () => {
  test('initializes one stable home identity and an empty project-link document', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const store = createAssistantHomeStore(homeRoot)

    const first = await store.initialize()
    const second = await store.initialize()

    expect(first).toEqual(second)
    expect(first.homeId).toMatch(/^H-/)
    expect(await readYaml(store.paths.homeDocumentPath)).toEqual(first)
    expect(await readYaml(store.paths.projectLinksPath)).toEqual({ version: 2, projects: [] })
  })

  test('links a Repo through hopi/release without changing the user checkout', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    await Bun.write(join(repoPath, 'local.txt'), 'uncommitted user content\n')
    const before = await snapshotUserCheckout(repoPath)
    const store = createAssistantHomeStore(homeRoot)

    const project = await store.linkProject({ projectId: 'P-1', repoPath })

    expect(project).toEqual({
      projectId: 'P-1',
      primaryRepoId: 'primary',
      repos: [
        {
          repoId: 'primary',
          repoPath: await realpath(repoPath),
          integrationRoot: store.paths.integrationRoot('P-1'),
          primary: true,
        },
      ],
      repoPath: await realpath(repoPath),
      integrationRoot: store.paths.integrationRoot('P-1'),
    })
    expect(await snapshotUserCheckout(repoPath)).toEqual(before)
    expect(await git(project.integrationRoot, ['branch', '--show-current'])).toBe(
      HOPI_RELEASE_BRANCH,
    )
    expect(await git(project.integrationRoot, ['rev-parse', 'HEAD'])).toBe(before.head)
    expect(await readYaml(store.paths.projectDocumentPath('P-1'))).toEqual({
      version: 2,
      projectId: 'P-1',
      primaryRepoId: 'primary',
      repos: [{ repoId: 'primary' }],
    })
    expect(await store.validateProject('P-1')).toEqual(project)
  })

  test('materializes managed roots without inheriting user autocrlf conversion', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    await git(repoPath, ['config', 'core.autocrlf', 'true'])
    await Bun.write(join(repoPath, 'run.sh'), '#!/usr/bin/env bash\nprintf "ready\\n"\n')
    await git(repoPath, ['add', 'run.sh'])
    await git(repoPath, ['commit', '-m', 'add executable text'])

    const project = await store.linkProject({ projectId: 'P-1', repoPath })

    expect(await Bun.file(join(project.integrationRoot, 'run.sh')).text()).toBe(
      '#!/usr/bin/env bash\nprintf "ready\\n"\n',
    )
  })

  test('migrates a version 1 Project link without changing its Repo identity', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const store = createAssistantHomeStore(homeRoot)
    await store.initialize()
    await Bun.write(
      store.paths.projectLinksPath,
      `version: 1\nprojects:\n  - projectId: P-1\n    repoPath: ${repoPath}\n`,
    )

    await store.initialize()

    expect(await readYaml(store.paths.projectLinksPath)).toEqual({
      version: 2,
      projects: [
        {
          projectId: 'P-1',
          primaryRepoId: 'primary',
          repos: [{ repoId: 'primary', repoPath: await realpath(repoPath) }],
        },
      ],
    })
  })

  test('links and validates a secondary Repo without changing either user checkout', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const primaryPath = await createRepo(join(temporaryRoot, 'primary'))
    const apiPath = await createRepo(join(temporaryRoot, 'api'))
    const beforePrimary = await snapshotUserCheckout(primaryPath)
    const beforeApi = await snapshotUserCheckout(apiPath)
    await store.linkProject({ projectId: 'P-1', repoPath: primaryPath })

    const project = await store.linkRepo({ projectId: 'P-1', repoId: 'api', repoPath: apiPath })
    const api = project.repos.find((repo) => repo.repoId === 'api')
    if (!api) throw new Error('Expected linked api Repo')

    expect(api).toEqual({
      repoId: 'api',
      repoPath: await realpath(apiPath),
      integrationRoot: store.paths.repoIntegrationRoot('P-1', 'api', 'primary'),
      primary: false,
    })
    expect(await git(api.integrationRoot, ['branch', '--show-current'])).toBe(HOPI_RELEASE_BRANCH)
    expect(await readYaml(store.paths.projectDocumentPath('P-1'))).toEqual({
      version: 2,
      projectId: 'P-1',
      primaryRepoId: 'primary',
      repos: [{ repoId: 'primary' }, { repoId: 'api', releaseCommit: beforeApi.head }],
    })
    expect(await snapshotUserCheckout(primaryPath)).toEqual(beforePrimary)
    expect(await snapshotUserCheckout(apiPath)).toEqual(beforeApi)
    expect(await store.validateProject('P-1')).toEqual(project)
    await expect(
      store.linkRepo({ projectId: 'P-1', repoId: 'api', repoPath: apiPath }),
    ).resolves.toEqual(project)
  })

  test('preflights and links a complete multi-Repo Project behind one durable link', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const store = createAssistantHomeStore(homeRoot)
    const webPath = await createRepo(join(temporaryRoot, 'web'))
    const apiPath = await createRepo(join(temporaryRoot, 'api'))
    const duplicateWebPath = join(temporaryRoot, 'web-duplicate')
    await git(webPath, ['worktree', 'add', '-b', 'duplicate-selection', duplicateWebPath, 'HEAD'])
    const beforeWeb = await snapshotUserCheckout(webPath)
    const beforeApi = await snapshotUserCheckout(apiPath)

    await expect(
      store.linkProject({
        projectId: 'P-1',
        primaryRepoId: 'web',
        repos: [
          { repoId: 'web', repoPath: webPath },
          { repoId: 'duplicate', repoPath: duplicateWebPath },
        ],
      }),
    ).rejects.toThrow('same Git Repo')
    expect(await readYaml(store.paths.projectLinksPath)).toEqual({ version: 2, projects: [] })
    expect(await Bun.file(store.paths.integrationRoot('P-1')).exists()).toBe(false)

    const linked = await store.linkProject({
      projectId: 'P-1',
      primaryRepoId: 'web',
      repos: [
        { repoId: 'web', repoPath: webPath },
        { repoId: 'api', repoPath: apiPath },
      ],
    })

    expect(linked.primaryRepoId).toBe('web')
    expect(linked.repos.map((repo) => repo.repoId)).toEqual(['web', 'api'])
    expect(await readYaml(store.paths.projectLinksPath)).toMatchObject({
      projects: [
        { projectId: 'P-1', primaryRepoId: 'web', repos: [{ repoId: 'web' }, { repoId: 'api' }] },
      ],
    })
    expect(await readYaml(store.paths.projectDocumentPath('P-1'))).toMatchObject({
      projectId: 'P-1',
      primaryRepoId: 'web',
      repos: [{ repoId: 'web' }, { repoId: 'api', releaseCommit: beforeApi.head }],
    })
    expect(await snapshotUserCheckout(webPath)).toEqual(beforeWeb)
    expect(await snapshotUserCheckout(apiPath)).toEqual(beforeApi)
  })

  test('rebinds a moved Home and complete Repo set in one publication', async () => {
    const originalHome = join(temporaryRoot, 'source-home')
    const originalWeb = await createRepo(join(temporaryRoot, 'source-web'))
    const originalApi = await createRepo(join(temporaryRoot, 'source-api'))
    const source = createAssistantHomeStore(originalHome)
    await source.linkProject({
      projectId: 'P-1',
      primaryRepoId: 'web',
      repos: [
        { repoId: 'web', repoPath: originalWeb },
        { repoId: 'api', repoPath: originalApi },
      ],
    })
    const movedHome = join(temporaryRoot, 'moved-home')
    const movedWeb = join(temporaryRoot, 'moved-web')
    const movedApi = join(temporaryRoot, 'moved-api')
    await rename(originalHome, movedHome)
    await rename(originalWeb, movedWeb)
    await rename(originalApi, movedApi)
    const destination = createAssistantHomeStore(movedHome)
    const linksBefore = await Bun.file(destination.paths.projectLinksPath).text()

    await expect(
      destination.rebindRepos({
        projectId: 'P-1',
        repos: [{ repoId: 'web', repoPath: movedWeb }],
      }),
    ).rejects.toThrow('complete Repo set')
    expect(await Bun.file(destination.paths.projectLinksPath).text()).toBe(linksBefore)

    const rebound = await destination.rebindRepos({
      projectId: 'P-1',
      repos: [
        { repoId: 'web', repoPath: movedWeb },
        { repoId: 'api', repoPath: movedApi },
      ],
    })

    expect(rebound.repos.map((repo) => repo.repoPath)).toEqual([
      await realpath(movedWeb),
      await realpath(movedApi),
    ])
    await expect(destination.validateProject('P-1')).resolves.toEqual(rebound)
  })

  test('rebinds one secondary Repo without changing the primary binding', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const primaryPath = await createRepo(join(temporaryRoot, 'primary'))
    const apiPath = await createRepo(join(temporaryRoot, 'api'))
    const linked = await store.linkProject({ projectId: 'P-1', repoPath: primaryPath })
    await store.linkRepo({ projectId: 'P-1', repoId: 'api', repoPath: apiPath })
    const movedApi = join(temporaryRoot, 'moved-api')
    await rename(apiPath, movedApi)

    const rebound = await store.rebindRepo({
      projectId: 'P-1',
      repoId: 'api',
      repoPath: movedApi,
    })

    expect(rebound.repoPath).toBe(linked.repoPath)
    expect(rebound.repos.find((repo) => repo.repoId === 'api')?.repoPath).toBe(
      await realpath(movedApi),
    )
    expect(await store.validateProject('P-1')).toEqual(rebound)
  })

  test('reconstructs a missing secondary managed root only from its documented release', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const primaryPath = await createRepo(join(temporaryRoot, 'primary'))
    const apiPath = await createRepo(join(temporaryRoot, 'api'))
    await store.linkProject({ projectId: 'P-1', repoPath: primaryPath })
    const linked = await store.linkRepo({ projectId: 'P-1', repoId: 'api', repoPath: apiPath })
    const api = linked.repos.find((repo) => repo.repoId === 'api')
    if (!api) throw new Error('Expected linked api Repo')
    await git(apiPath, ['worktree', 'remove', '--force', api.integrationRoot])
    const movedApi = join(temporaryRoot, 'moved-api')
    await rename(apiPath, movedApi)

    const rebound = await store.rebindRepo({
      projectId: 'P-1',
      repoId: 'api',
      repoPath: movedApi,
    })

    expect(rebound.repos.find((repo) => repo.repoId === 'api')?.repoPath).toBe(
      await realpath(movedApi),
    )
    expect(await store.validateProject('P-1')).toEqual(rebound)
  })

  test('rejects secondary reconstruction when its release diverged from project.yml', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const primaryPath = await createRepo(join(temporaryRoot, 'primary'))
    const apiPath = await createRepo(join(temporaryRoot, 'api'))
    await store.linkProject({ projectId: 'P-1', repoPath: primaryPath })
    const linked = await store.linkRepo({ projectId: 'P-1', repoId: 'api', repoPath: apiPath })
    const api = linked.repos.find((repo) => repo.repoId === 'api')
    if (!api) throw new Error('Expected linked api Repo')
    await git(apiPath, ['worktree', 'remove', '--force', api.integrationRoot])
    await Bun.write(join(apiPath, 'unexpected.txt'), 'unexpected release\n')
    await git(apiPath, ['add', 'unexpected.txt'])
    await git(apiPath, ['commit', '-m', 'unexpected release'])
    await git(apiPath, ['update-ref', HOPI_RELEASE_REF, 'HEAD'])
    const movedApi = join(temporaryRoot, 'moved-api')
    await rename(apiPath, movedApi)

    await expect(
      store.rebindRepo({ projectId: 'P-1', repoId: 'api', repoPath: movedApi }),
    ).rejects.toThrow('disagrees with project.yml')
    expect(await readYaml(store.paths.projectLinksPath)).toMatchObject({
      projects: [{ repos: [{ repoId: 'primary' }, { repoId: 'api', repoPath: apiPath }] }],
    })
  })

  test('reuses an exact link request and rejects identity or Repo conflicts', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const firstRepo = await createRepo(join(temporaryRoot, 'repo-a'))
    const secondRepo = await createRepo(join(temporaryRoot, 'repo-b'))
    const first = await store.linkProject({ projectId: 'P-1', repoPath: firstRepo })

    await expect(store.linkProject({ projectId: 'P-1', repoPath: firstRepo })).resolves.toEqual(
      first,
    )
    await expect(
      store.linkProject({ projectId: 'P-1', repoPath: secondRepo }),
    ).rejects.toMatchObject({ code: 'project_conflict' })
    await expect(
      store.linkProject({ projectId: 'P-2', repoPath: firstRepo }),
    ).rejects.toMatchObject({ code: 'project_conflict' })
  })

  test('persists and clears one Project coding-default override in projects.yml', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    await store.linkProject({ projectId: 'P-1', repoPath })

    const configured = await store.updateProjectSettings({
      projectId: 'P-1',
      codingDefaults: {
        transport: 'codex',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'high',
      },
    })

    expect(configured.codingDefaults).toEqual({
      transport: 'codex',
      model: 'gpt-5.3-codex',
      reasoningEffort: 'high',
    })
    expect(await readYaml(store.paths.projectLinksPath)).toMatchObject({
      projects: [
        {
          projectId: 'P-1',
          codingDefaults: {
            transport: 'codex',
            model: 'gpt-5.3-codex',
            reasoningEffort: 'high',
          },
        },
      ],
    })

    const inherited = await store.updateProjectSettings({
      projectId: 'P-1',
      codingDefaults: null,
    })

    expect(inherited.codingDefaults).toBeUndefined()
    expect(await readYaml(store.paths.projectLinksPath)).not.toHaveProperty(
      'projects.0.codingDefaults',
    )
  })

  test('rejects another checkout of an already linked Repo', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const alternateCheckout = join(temporaryRoot, 'alternate-checkout')
    await git(repoPath, ['worktree', 'add', '-b', 'alternate', alternateCheckout, 'HEAD'])
    await store.linkProject({ projectId: 'P-1', repoPath })

    await expect(
      store.linkProject({ projectId: 'P-2', repoPath: alternateCheckout }),
    ).rejects.toMatchObject({ code: 'project_conflict' })
  })

  test('recovers an initialized managed root whose final project link was not written', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const store = createAssistantHomeStore(homeRoot)
    await store.initialize()

    const integrationRoot = store.paths.integrationRoot('P-1')
    await mkdir(join(integrationRoot, '..'), { recursive: true })
    await git(repoPath, ['worktree', 'add', '-b', HOPI_RELEASE_BRANCH, integrationRoot, 'HEAD'])
    await mkdir(dirname(store.paths.projectDocumentPath('P-1')), { recursive: true })
    await Bun.write(store.paths.projectDocumentPath('P-1'), 'version: 1\nprojectId: P-1\n')

    const project = await store.linkProject({ projectId: 'P-1', repoPath })

    expect(project.integrationRoot).toBe(integrationRoot)
    expect(await store.listProjects()).toEqual([project])
  })

  test('fails closed when canonical project identity no longer matches', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    await store.linkProject({ projectId: 'P-1', repoPath })
    await Bun.write(store.paths.projectDocumentPath('P-1'), 'version: 1\nprojectId: P-other\n')

    const validation = store.validateProject('P-1')

    await expect(validation).rejects.toBeInstanceOf(AssistantHomeStoreError)
    await expect(validation).rejects.toMatchObject({ code: 'invalid_project' })
  })

  test('rebinds an exported managed worktree after its Repo path moves', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const originalRepo = await createRepo(join(temporaryRoot, 'repo'))
    const project = await store.linkProject({ projectId: 'P-1', repoPath: originalRepo })
    const canonicalPath = join(project.integrationRoot, '.hopi/docs/preserved.md')
    await mkdir(dirname(canonicalPath), { recursive: true })
    await Bun.write(canonicalPath, '# Preserved canonical state\n')
    const movedRepo = join(temporaryRoot, 'moved-repo')
    await rename(originalRepo, movedRepo)
    const before = await snapshotUserCheckout(movedRepo)

    const rebound = await store.rebindProject({ projectId: 'P-1', repoPath: movedRepo })

    expect(rebound.repoPath).toBe(await realpath(movedRepo))
    expect(await store.validateProject('P-1')).toEqual(rebound)
    expect(await Bun.file(canonicalPath).text()).toBe('# Preserved canonical state\n')
    expect(await snapshotUserCheckout(movedRepo)).toEqual(before)
  })

  test('does not reconstruct a missing managed root from a potentially stale release ref', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const originalRepo = await createRepo(join(temporaryRoot, 'repo'))
    const project = await store.linkProject({ projectId: 'P-1', repoPath: originalRepo })
    await git(originalRepo, ['worktree', 'remove', '--force', project.integrationRoot])
    const movedRepo = join(temporaryRoot, 'moved-repo')
    await rename(originalRepo, movedRepo)

    await expect(store.rebindProject({ projectId: 'P-1', repoPath: movedRepo })).rejects.toThrow(
      'refusing to reconstruct',
    )
    expect(await Bun.file(store.paths.projectDocumentPath('P-1')).exists()).toBe(false)
  })
})

async function createRepo(path: string) {
  await mkdir(path, { recursive: true })
  await git(path, ['init', '-b', 'main'])
  await git(path, ['config', 'user.email', 'hopi@example.test'])
  await git(path, ['config', 'user.name', 'HOPI Test'])
  await Bun.write(join(path, 'README.md'), '# Test Repo\n')
  await git(path, ['add', 'README.md'])
  await git(path, ['commit', '-m', 'initial'])
  return realpath(path)
}

async function snapshotUserCheckout(repoPath: string) {
  const [head, branch, status] = await Promise.all([
    git(repoPath, ['rev-parse', 'HEAD']),
    git(repoPath, ['branch', '--show-current']),
    git(repoPath, ['status', '--porcelain']),
  ])
  return { head, branch, status }
}

async function readYaml(path: string) {
  return parse(await Bun.file(path).text())
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`)
  }
  return stdout.trim()
}
