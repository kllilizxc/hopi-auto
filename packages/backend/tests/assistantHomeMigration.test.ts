import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultAssistantHomeRoot,
  migrateRepositoryAssistantHome,
} from '../src/runtime/assistantHomeMigration'
import { managedRepoWorktreePaths } from '../src/runtime/managedWorktreePaths'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('Assistant Home migration', () => {
  test('uses the XDG data directory or the WSL user home by default', () => {
    expect(defaultAssistantHomeRoot({ XDG_DATA_HOME: '/data' }, '/home/test')).toBe('/data/hopi')
    expect(defaultAssistantHomeRoot({}, '/home/test')).toBe('/home/test/.local/share/hopi')
  })

  test('relocates repository state, flattens Runs, preserves proof, and rewrites Evidence', async () => {
    const root = await temporaryRoot()
    const legacyRoot = join(root, 'hopi-source')
    const homeRoot = join(root, 'data', 'hopi')
    const legacyHopi = join(legacyRoot, '.hopi')
    const repoPath = join(root, 'sample-repo')
    const integrationRoot = managedRepoWorktreePaths(repoPath).integration
    const evidencePath = join(
      integrationRoot,
      '.hopi',
      'docs',
      'goals',
      'G-1',
      'evidence',
      'E-R-1.md',
    )
    const nestedRun = join(legacyHopi, 'runtime', 'runs', 'P-1', 'G-1', 'W-1', 'R-1')
    const legacyArtifact = join(nestedRun, 'scratch', 'deep', 'asset.png')
    await mkdir(join(nestedRun, 'scratch', 'deep'), { recursive: true })
    await mkdir(join(evidencePath, '..'), { recursive: true })
    await Bun.write(join(legacyHopi, 'source-fixture.md'), 'tracked source fixture\n')
    await git(legacyRoot, ['init', '-b', 'main'])
    await git(legacyRoot, ['config', 'user.email', 'hopi@example.test'])
    await git(legacyRoot, ['config', 'user.name', 'HOPI Test'])
    await git(legacyRoot, ['add', '.hopi/source-fixture.md'])
    await git(legacyRoot, ['commit', '-m', 'track source fixture'])
    await Bun.write(join(legacyHopi, 'home.yml'), 'version: 1\nhomeId: H-1\n')
    await Bun.write(
      join(legacyHopi, 'projects.yml'),
      `version: 3\nprojects:\n  - projectId: P-1\n    primaryRepoId: primary\n    repos:\n      - repoId: primary\n        repoPath: ${repoPath}\n        deliveryBranch: main\n`,
    )
    await Bun.write(
      join(nestedRun, 'context.md'),
      '# HOPI Responsibility Context\n\n- Project: P-1\n- Goal: G-1\n- Work: W-1\n- Run: R-1\n- Responsibility: reviewer\n',
    )
    await Bun.write(
      join(nestedRun, 'attempt.json'),
      `${JSON.stringify({
        version: 1,
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'W-1',
        runId: 'R-1',
        responsibility: 'reviewer',
        startedAt: '2026-07-16T00:00:00.000Z',
        endedAt: '2026-07-16T00:01:00.000Z',
        status: 'finished',
        result: 'success',
        summary: 'proved',
        exitCode: 0,
        application: 'integrated',
      })}\n`,
    )
    await Bun.write(legacyArtifact, 'pixel-proof')
    await Bun.write(
      join(nestedRun, 'result.json'),
      `${JSON.stringify({ result: 'success', summary: 'proved', artifacts: [legacyArtifact] })}\n`,
    )
    await Bun.write(evidencePath, `artifacts:\n  - ${legacyArtifact}\n`)

    const migration = await migrateRepositoryAssistantHome({ legacyRoot, homeRoot })
    const flatRun = join(homeRoot, '.hopi', 'runtime', 'runs', 'R-1')

    expect(migration).toMatchObject({
      relocated: true,
      flattenedRuns: 1,
      preservedArtifacts: 1,
      rewrittenEvidenceFiles: 1,
      removedScratchRoots: 1,
      warnings: [],
    })
    expect(await Bun.file(join(legacyRoot, '.hopi', 'home.yml')).exists()).toBe(false)
    expect(await Bun.file(join(legacyRoot, '.hopi', 'source-fixture.md')).text()).toBe(
      'tracked source fixture\n',
    )
    expect(await Bun.file(join(homeRoot, '.hopi', 'home.yml')).text()).toContain('homeId: H-1')
    expect(await Bun.file(join(flatRun, 'artifacts', '001-asset.png')).text()).toBe('pixel-proof')
    expect(await Bun.file(join(flatRun, 'scratch', 'deep', 'asset.png')).exists()).toBe(false)
    expect(await Bun.file(join(flatRun, 'result.json')).json()).toMatchObject({
      artifacts: ['artifact:R-1/001-asset.png'],
    })
    expect(await Bun.file(evidencePath).text()).toContain('artifact:R-1/001-asset.png')
    expect(await Bun.file(evidencePath).text()).not.toContain(legacyRoot)

    const recordPath = join(homeRoot, '.hopi', 'runtime', 'migrations', 'external-home-v1.json')
    const record = await Bun.file(recordPath).text()
    expect(await migrateRepositoryAssistantHome({ legacyRoot, homeRoot })).toMatchObject({
      relocated: false,
      flattenedRuns: 0,
      preservedArtifacts: 0,
      rewrittenEvidenceFiles: 0,
      removedScratchRoots: 0,
      warnings: [],
    })
    expect(await Bun.file(recordPath).text()).toBe(record)
  })
})

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-home-migration-'))
  temporaryRoots.push(root)
  return root
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'ignore', stderr: 'pipe' })
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`)
}
