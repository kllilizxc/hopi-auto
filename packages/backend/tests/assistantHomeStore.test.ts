import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'
import { DEFAULT_ASSISTANT_PREFERENCE } from '../src/domain/assistantPreference'
import {
  LEGACY_HOPI_RELEASE_BRANCH,
  projectReleaseBranch,
  projectReleaseRef,
} from '../src/domain/project'
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
    expect(await readYaml(store.paths.projectLinksPath)).toEqual({ version: 4, projects: [] })
    expect(await Bun.file(store.paths.preferenceDocumentPath).text()).toBe(
      DEFAULT_ASSISTANT_PREFERENCE,
    )
  })

  test('adds the preference document to an existing Home without replacing user content', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const store = createAssistantHomeStore(homeRoot)
    await store.initialize()
    await rm(store.paths.preferenceDocumentPath)

    await store.initialize()
    expect(await Bun.file(store.paths.preferenceDocumentPath).text()).toBe(
      DEFAULT_ASSISTANT_PREFERENCE,
    )

    await Bun.write(
      store.paths.preferenceDocumentPath,
      '# Preferences\r\n\r\n- Keep replies concise.',
    )
    await store.initialize()
    expect(await Bun.file(store.paths.preferenceDocumentPath).text()).toBe(
      '# Preferences\n\n- Keep replies concise.\n',
    )
  })

  test('links a Repo through a Project release without changing the user checkout', async () => {
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
          projectPath: '.',
          integrationRoot: store.paths.managedIntegrationRoot('P-1', repoPath),
          primary: true,
        },
      ],
      repoPath: await realpath(repoPath),
      projectPath: '.',
      integrationRoot: store.paths.managedIntegrationRoot('P-1', repoPath),
    })
    expect(await snapshotUserCheckout(repoPath)).toEqual(before)
    expect(await git(project.integrationRoot, ['branch', '--show-current'])).toBe(
      projectReleaseBranch('P-1'),
    )
    expect(await git(project.integrationRoot, ['rev-parse', 'HEAD'])).toBe(before.head)
    expect(await readYaml(join(project.integrationRoot, '.hopi', 'project.yml'))).toEqual({
      version: 2,
      projectId: 'P-1',
      primaryRepoId: 'primary',
      repos: [{ repoId: 'primary' }],
    })
    expect(await store.validateProject('P-1')).toEqual(project)
  })

  test('derives a readable Project ID from the primary selected folder', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const firstRepo = await createRepo(join(temporaryRoot, 'first-monorepo'))
    const firstScope = join(firstRepo, 'apps', 'customer-portal')
    await mkdir(firstScope, { recursive: true })
    const firstInput = {
      primaryRepoId: 'web',
      repos: [{ repoId: 'web', repoPath: firstRepo, projectPath: 'apps/customer-portal' }],
    }

    const first = await store.linkProject(firstInput)
    const repeated = await store.linkProject(firstInput)

    expect(first.projectId).toBe('P-customer-portal')
    expect(repeated).toEqual(first)

    const secondRepo = await createRepo(join(temporaryRoot, 'second-monorepo'))
    const secondScope = join(secondRepo, 'products', 'customer-portal')
    await mkdir(secondScope, { recursive: true })
    const second = await store.linkProject({
      primaryRepoId: 'web',
      repos: [{ repoId: 'web', repoPath: secondRepo, projectPath: 'products/customer-portal' }],
    })

    expect(second.projectId).toBe('P-customer-portal-2')

    const localizedRepo = await createRepo(join(temporaryRoot, 'localized-monorepo'))
    const localizedScope = join(localizedRepo, 'products', '像素游戏')
    await mkdir(localizedScope, { recursive: true })
    const localized = await store.linkProject({
      primaryRepoId: 'game',
      repos: [{ repoId: 'game', repoPath: localizedRepo, projectPath: 'products/像素游戏' }],
    })

    expect(localized.projectId).toBe('P-像素游戏')
  })

  test('persists a selected Git subdirectory as the portable Project scope', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const selectedPath = join(repoPath, 'apps', 'new-product')
    await mkdir(selectedPath, { recursive: true })
    const store = createAssistantHomeStore(homeRoot)

    const project = await store.linkProject({ projectId: 'P-scoped', repoPath: selectedPath })

    expect(project.repoPath).toBe(repoPath)
    expect(project.projectPath).toBe('apps/new-product')
    expect(project.repos[0]).toMatchObject({
      repoPath,
      projectPath: 'apps/new-product',
    })
    expect(await readYaml(join(project.integrationRoot, '.hopi', 'project.yml'))).toEqual({
      version: 2,
      projectId: 'P-scoped',
      primaryRepoId: 'primary',
      repos: [{ repoId: 'primary', projectPath: 'apps/new-product' }],
    })
    await expect(createAssistantHomeStore(homeRoot).readProject('P-scoped')).resolves.toEqual(
      project,
    )
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
    const legacyIntegration = store.paths.integrationRoot('P-1')
    await mkdir(dirname(legacyIntegration), { recursive: true })
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      LEGACY_HOPI_RELEASE_BRANCH,
      legacyIntegration,
      'HEAD',
    ])
    await mkdir(join(legacyIntegration, '.hopi'), { recursive: true })
    await Bun.write(
      join(legacyIntegration, '.hopi', 'project.yml'),
      'version: 2\nprojectId: P-1\nprimaryRepoId: primary\nrepos:\n  - repoId: primary\n',
    )
    await Bun.write(
      store.paths.projectLinksPath,
      `version: 1\nprojects:\n  - projectId: P-1\n    repoPath: ${repoPath}\n`,
    )

    await store.initialize()

    expect(await readYaml(store.paths.projectLinksPath)).toEqual({
      version: 4,
      projects: [
        {
          projectId: 'P-1',
          primaryRepoId: 'primary',
          repos: [{ repoId: 'primary', repoPath: await realpath(repoPath) }],
        },
      ],
    })
  })

  test('relocates legacy integration and task worktrees without losing dirty state', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const store = createAssistantHomeStore(homeRoot)
    await store.initialize()
    await Bun.write(
      store.paths.projectLinksPath,
      [
        'version: 2',
        'projects:',
        '  - projectId: P-1',
        '    primaryRepoId: primary',
        '    repos:',
        '      - repoId: primary',
        `        repoPath: ${repoPath}`,
        '',
      ].join('\n'),
    )
    const legacyIntegration = store.paths.integrationRoot('P-1')
    const legacyTask = join(homeRoot, '.hopi', 'runtime', 'worktrees', 'P-1', 'G-1', 'W-1')
    await mkdir(dirname(legacyIntegration), { recursive: true })
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      LEGACY_HOPI_RELEASE_BRANCH,
      legacyIntegration,
      'HEAD',
    ])
    await mkdir(join(legacyIntegration, '.hopi', 'docs'), { recursive: true })
    await Bun.write(
      join(legacyIntegration, '.hopi', 'project.yml'),
      'version: 2\nprojectId: P-1\nprimaryRepoId: primary\nrepos:\n  - repoId: primary\n',
    )
    await Bun.write(join(legacyIntegration, '.hopi', 'docs', 'preserved.md'), '# Preserved\n')
    await mkdir(dirname(legacyTask), { recursive: true })
    await git(repoPath, ['worktree', 'add', '-b', 'hopi/work/P-1/G-1/W-1', legacyTask, 'HEAD'])
    await Bun.write(join(legacyTask, 'unfinished.txt'), 'unfinished task state\n')
    const integrationStatus = await git(legacyIntegration, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ])
    const taskStatus = await git(legacyTask, ['status', '--porcelain=v1', '--untracked-files=all'])

    await store.initialize()

    const project = await store.readProject('P-1')
    const taskRoot = join(store.paths.managedRepoRoot('P-1', repoPath), 'work', 'G-1', 'W-1')
    expect(project.integrationRoot).toBe(store.paths.managedIntegrationRoot('P-1', repoPath))
    expect(await Bun.file(legacyIntegration).exists()).toBe(false)
    expect(await Bun.file(legacyTask).exists()).toBe(false)
    expect(
      await Bun.file(join(project.integrationRoot, '.hopi', 'docs', 'preserved.md')).text(),
    ).toBe('# Preserved\n')
    expect(await Bun.file(join(taskRoot, 'unfinished.txt')).text()).toBe('unfinished task state\n')
    expect(
      await git(project.integrationRoot, ['status', '--porcelain=v1', '--untracked-files=all']),
    ).toBe(integrationStatus)
    expect(await git(taskRoot, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe(
      taskStatus,
    )
  })

  test('finishes a version 3 migration after the Project projection was already created', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const store = createAssistantHomeStore(homeRoot)
    const project = await store.linkProject({ projectId: 'P-1', repoPath })
    const selectedBefore = await snapshotUserCheckout(repoPath)
    const releaseHead = await git(repoPath, ['rev-parse', projectReleaseRef('P-1')])
    await git(repoPath, ['update-ref', `refs/heads/${LEGACY_HOPI_RELEASE_BRANCH}`, releaseHead])
    await Bun.write(
      store.paths.projectLinksPath,
      [
        'version: 3',
        'projects:',
        '  - projectId: P-1',
        '    primaryRepoId: primary',
        '    repos:',
        '      - repoId: primary',
        `        repoPath: ${repoPath}`,
        '        deliveryBranch: main',
        '',
      ].join('\n'),
    )

    await store.initialize()

    expect(await readYaml(store.paths.projectLinksPath)).toMatchObject({ version: 4 })
    expect(await git(project.integrationRoot, ['branch', '--show-current'])).toBe(
      projectReleaseBranch('P-1'),
    )
    expect(await git(repoPath, ['rev-parse', projectReleaseRef('P-1')])).toBe(releaseHead)
    await expect(
      git(repoPath, ['rev-parse', '--verify', `refs/heads/${LEGACY_HOPI_RELEASE_BRANCH}`]),
    ).rejects.toThrow()
    expect(await snapshotUserCheckout(repoPath)).toEqual(selectedBefore)
  })

  test('rejects divergent legacy and Project release refs without choosing one', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const store = createAssistantHomeStore(homeRoot)
    const project = await store.linkProject({ projectId: 'P-1', repoPath })
    const legacyHead = await git(repoPath, ['rev-parse', 'HEAD'])
    await Bun.write(join(project.integrationRoot, 'project-only.txt'), 'new Project release\n')
    await git(project.integrationRoot, ['add', 'project-only.txt'])
    await git(project.integrationRoot, ['commit', '-m', 'advance Project release'])
    await git(repoPath, ['update-ref', `refs/heads/${LEGACY_HOPI_RELEASE_BRANCH}`, legacyHead])
    await Bun.write(
      store.paths.projectLinksPath,
      [
        'version: 3',
        'projects:',
        '  - projectId: P-1',
        '    primaryRepoId: primary',
        '    repos:',
        '      - repoId: primary',
        `        repoPath: ${repoPath}`,
        '        deliveryBranch: main',
        '',
      ].join('\n'),
    )

    await expect(store.initialize()).rejects.toThrow('migration cannot choose a release')

    expect(await readYaml(store.paths.projectLinksPath)).toMatchObject({ version: 3 })
    expect(await git(repoPath, ['rev-parse', `refs/heads/${LEGACY_HOPI_RELEASE_BRANCH}`])).toBe(
      legacyHead,
    )
    expect(await git(repoPath, ['rev-parse', projectReleaseRef('P-1')])).not.toBe(legacyHead)
  })

  test('reconstructs a missing legacy primary integration from its exact release', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const store = createAssistantHomeStore(homeRoot)
    await store.initialize()
    const temporaryIntegration = join(temporaryRoot, 'removed-legacy-integration')
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      LEGACY_HOPI_RELEASE_BRANCH,
      temporaryIntegration,
      'HEAD',
    ])
    await mkdir(join(temporaryIntegration, '.hopi'), { recursive: true })
    await Bun.write(
      join(temporaryIntegration, '.hopi', 'project.yml'),
      'version: 2\nprojectId: P-1\nprimaryRepoId: primary\nrepos:\n  - repoId: primary\n',
    )
    await git(temporaryIntegration, ['add', '.hopi/project.yml'])
    await git(temporaryIntegration, ['commit', '-m', 'publish legacy Project'])
    const releaseHead = await git(temporaryIntegration, ['rev-parse', 'HEAD'])
    await git(repoPath, ['worktree', 'remove', temporaryIntegration])
    await Bun.write(
      store.paths.projectLinksPath,
      `version: 1\nprojects:\n  - projectId: P-1\n    repoPath: ${repoPath}\n`,
    )
    const selectedBefore = await snapshotUserCheckout(repoPath)

    await store.initialize()

    const project = await store.readProject('P-1')
    expect(await git(project.integrationRoot, ['branch', '--show-current'])).toBe(
      projectReleaseBranch('P-1'),
    )
    expect(await git(project.integrationRoot, ['rev-parse', 'HEAD'])).toBe(releaseHead)
    expect(await snapshotUserCheckout(repoPath)).toEqual(selectedBefore)
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
      projectPath: '.',
      integrationRoot: store.paths.managedIntegrationRoot('P-1', apiPath),
      primary: false,
    })
    expect(await git(api.integrationRoot, ['branch', '--show-current'])).toBe(
      projectReleaseBranch('P-1'),
    )
    expect(await readYaml(join(project.integrationRoot, '.hopi', 'project.yml'))).toEqual({
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
    expect(await readYaml(store.paths.projectLinksPath)).toEqual({ version: 4, projects: [] })
    expect(await Bun.file(store.paths.managedIntegrationRoot('P-1', webPath)).exists()).toBe(false)

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
    expect(await readYaml(join(linked.integrationRoot, '.hopi', 'project.yml'))).toMatchObject({
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

  test('rebinds to a different Git Repo and Project scope while preserving canonical documents', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const originalRepo = await createRepo(join(temporaryRoot, 'original'))
    const linked = await store.linkProject({ projectId: 'P-1', repoPath: originalRepo })
    const canonicalPath = join(linked.integrationRoot, '.hopi', 'docs', 'preserved.md')
    await mkdir(dirname(canonicalPath), { recursive: true })
    await Bun.write(canonicalPath, '# Preserve this Project truth\n')
    const targetRepo = await createRepo(join(temporaryRoot, 'replacement'))
    const targetScope = join(targetRepo, 'products', 'knowledge-base')
    await mkdir(targetScope, { recursive: true })
    await Bun.write(join(targetScope, 'README.md'), '# Replacement source\n')
    await git(targetRepo, ['add', 'products/knowledge-base/README.md'])
    await git(targetRepo, ['commit', '-m', 'add replacement scope'])
    const targetBefore = await snapshotUserCheckout(targetRepo)

    const rebound = await store.rebindProject({
      projectId: 'P-1',
      repoPath: targetScope,
    })

    expect(rebound.repoPath).toBe(await realpath(targetRepo))
    expect(rebound.projectPath).toBe('products/knowledge-base')
    expect(await Bun.file(join(rebound.integrationRoot, '.hopi/docs/preserved.md')).text()).toBe(
      '# Preserve this Project truth\n',
    )
    expect(await readYaml(join(rebound.integrationRoot, '.hopi/project.yml'))).toEqual({
      version: 2,
      projectId: 'P-1',
      primaryRepoId: 'primary',
      repos: [{ repoId: 'primary', projectPath: 'products/knowledge-base' }],
    })
    expect(await snapshotUserCheckout(targetRepo)).toEqual(targetBefore)
    expect(await Bun.file(join(linked.integrationRoot, '.hopi/docs/preserved.md')).exists()).toBe(
      true,
    )
    await expect(store.validateProject('P-1')).resolves.toEqual(rebound)
  })

  test('rolls back freshly materialized Rebind projections before the binding gate', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const originalPrimary = await createRepo(join(temporaryRoot, 'original-primary'))
    const originalApi = await createRepo(join(temporaryRoot, 'original-api'))
    await store.linkProject({
      projectId: 'P-1',
      primaryRepoId: 'primary',
      repos: [
        { repoId: 'primary', repoPath: originalPrimary },
        { repoId: 'api', repoPath: originalApi },
      ],
    })
    const replacementPrimary = await createRepo(join(temporaryRoot, 'replacement-primary'))
    const blockedApi = await createRepo(join(temporaryRoot, 'blocked-api'))
    await git(blockedApi, ['switch', '-c', projectReleaseBranch('P-1')])
    const linksBefore = await Bun.file(store.paths.projectLinksPath).text()

    await expect(
      store.rebindRepos({
        projectId: 'P-1',
        repos: [
          { repoId: 'primary', repoPath: replacementPrimary },
          { repoId: 'api', repoPath: blockedApi },
        ],
      }),
    ).rejects.toThrow('Cannot materialize rebound Repo api')

    expect(await Bun.file(store.paths.projectLinksPath).text()).toBe(linksBefore)
    expect(
      await Bun.file(store.paths.managedProjectDocumentPath('P-1', replacementPrimary)).exists(),
    ).toBe(false)
    const replacementRelease = await gitResult(replacementPrimary, [
      'rev-parse',
      '--verify',
      projectReleaseRef('P-1'),
    ])
    expect(replacementRelease.exitCode).not.toBe(0)
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

  test('adopts the selected target release when a rebound Repo release changed', async () => {
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
    await git(apiPath, ['update-ref', projectReleaseRef('P-1'), 'HEAD'])
    const movedApi = join(temporaryRoot, 'moved-api')
    await rename(apiPath, movedApi)

    const rebound = await store.rebindRepo({
      projectId: 'P-1',
      repoId: 'api',
      repoPath: movedApi,
    })
    const reboundApi = rebound.repos.find((repo) => repo.repoId === 'api')
    expect(reboundApi?.repoPath).toBe(await realpath(movedApi))
    expect(await readYaml(join(rebound.integrationRoot, '.hopi/project.yml'))).toMatchObject({
      repos: [{ repoId: 'primary' }, { repoId: 'api', releaseCommit: expect.any(String) }],
    })
  })

  test('reuses an exact link request, rejects Project ID conflicts, and permits shared Repos', async () => {
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
    ).resolves.toMatchObject({ projectId: 'P-2' })
  })

  test('removes legacy Project coding defaults during Home initialization', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    await store.linkProject({ projectId: 'P-1', repoPath })
    const links = (await readYaml(store.paths.projectLinksPath)) as {
      version: number
      projects: Array<Record<string, unknown>>
    }
    links.version = 3
    links.projects[0] = {
      ...links.projects[0],
      repos: (links.projects[0]?.repos as Array<Record<string, unknown>>).map((repo) => ({
        ...repo,
        deliveryBranch: 'main',
      })),
      codingDefaults: {
        transport: 'codex',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'high',
      },
    }
    await Bun.write(store.paths.projectLinksPath, JSON.stringify(links))

    await store.initialize()

    expect(await readYaml(store.paths.projectLinksPath)).not.toHaveProperty(
      'projects.0.codingDefaults',
    )
  })

  test('binds one Git Repo to two Projects with isolated releases', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const selectedBefore = await snapshotUserCheckout(repoPath)
    const first = await store.linkProject({ projectId: 'P-1', repoPath })

    const second = await store.linkProject({ projectId: 'P-2', repoPath })

    expect(first.integrationRoot).not.toBe(second.integrationRoot)
    expect(await git(first.integrationRoot, ['branch', '--show-current'])).toBe(
      projectReleaseBranch('P-1'),
    )
    expect(await git(second.integrationRoot, ['branch', '--show-current'])).toBe(
      projectReleaseBranch('P-2'),
    )
    await Bun.write(join(first.integrationRoot, 'shared.txt'), 'P-1 release\n')
    await git(first.integrationRoot, ['add', 'shared.txt'])
    await git(first.integrationRoot, ['commit', '-m', 'advance P-1 only'])

    expect(await Bun.file(join(first.integrationRoot, 'shared.txt')).text()).toBe('P-1 release\n')
    expect(await Bun.file(join(second.integrationRoot, 'shared.txt')).exists()).toBe(false)
    expect(await snapshotUserCheckout(repoPath)).toEqual(selectedBefore)
    expect(await git(repoPath, ['rev-parse', projectReleaseRef('P-1')])).not.toBe(
      await git(repoPath, ['rev-parse', projectReleaseRef('P-2')]),
    )
  })

  test('binds one Repo as primary in one Project and secondary in another', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const sharedPath = await createRepo(join(temporaryRoot, 'shared'))
    const otherPath = await createRepo(join(temporaryRoot, 'other'))
    const first = await store.linkProject({ projectId: 'P-1', repoPath: sharedPath })
    await store.linkProject({ projectId: 'P-2', repoPath: otherPath })

    const second = await store.linkRepo({
      projectId: 'P-2',
      repoId: 'shared-secondary',
      repoPath: sharedPath,
    })

    expect(first.repos[0]?.primary).toBe(true)
    expect(second.repos.find((repo) => repo.repoId === 'shared-secondary')).toMatchObject({
      repoPath: sharedPath,
      primary: false,
      integrationRoot: store.paths.managedIntegrationRoot('P-2', sharedPath),
    })
    expect(store.paths.managedIntegrationRoot('P-1', sharedPath)).not.toBe(
      store.paths.managedIntegrationRoot('P-2', sharedPath),
    )
  })

  test('recovers an initialized managed root whose final project link was not written', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const store = createAssistantHomeStore(homeRoot)
    await store.initialize()

    const integrationRoot = store.paths.managedIntegrationRoot('P-1', repoPath)
    await mkdir(join(integrationRoot, '..'), { recursive: true })
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      projectReleaseBranch('P-1'),
      integrationRoot,
      'HEAD',
    ])
    const projectDocumentPath = join(integrationRoot, '.hopi', 'project.yml')
    await mkdir(dirname(projectDocumentPath), { recursive: true })
    await Bun.write(projectDocumentPath, 'version: 1\nprojectId: P-1\n')

    const project = await store.linkProject({ projectId: 'P-1', repoPath })

    expect(project.integrationRoot).toBe(integrationRoot)
    expect(await store.listProjects()).toEqual([project])
  })

  test('fails closed when canonical project identity no longer matches', async () => {
    const store = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    await store.linkProject({ projectId: 'P-1', repoPath })
    const project = await store.readProject('P-1')
    await Bun.write(
      join(project.integrationRoot, '.hopi', 'project.yml'),
      'version: 1\nprojectId: P-other\n',
    )

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
    expect(await Bun.file(join(rebound.integrationRoot, '.hopi/docs/preserved.md')).text()).toBe(
      '# Preserved canonical state\n',
    )
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
      'project.yml is missing',
    )
    expect(
      await Bun.file(
        join(store.paths.managedIntegrationRoot('P-1', movedRepo), '.hopi', 'project.yml'),
      ).exists(),
    ).toBe(false)
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
  const result = await gitResult(cwd, args)
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

async function gitResult(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}
