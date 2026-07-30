import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { parseWorkDocument } from '../packages/backend/src/domain/canonicalDocuments'
import { managedRepoWorktreePaths } from '../packages/backend/src/runtime/managedWorktreePaths'

let temporaryRoot = ''

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = ''
})

test('epoch 2 migration backs up and replaces legacy Work and Attempt records', async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-schema-2-'))
  const homeRoot = join(temporaryRoot, 'home')
  const hopiRoot = join(homeRoot, '.hopi')
  const repoRoot = join(temporaryRoot, 'repo')
  const integrationRoot = managedRepoWorktreePaths(repoRoot, 'P-1').integration
  const workPath = join(integrationRoot, '.hopi', 'docs', 'goals', 'G-1', 'work', 'plan-0001.md')
  const attemptPath = join(hopiRoot, 'runtime', 'runs', 'R-1', 'attempt.json')
  await mkdir(join(hopiRoot, 'runtime', 'runs', 'R-1'), { recursive: true })
  await mkdir(join(workPath, '..'), { recursive: true })
  await Bun.write(homePath(hopiRoot), 'schemaEpoch: 1\nhomeId: H-1\n')
  await Bun.write(
    join(hopiRoot, 'projects.yml'),
    [
      'projects:',
      '  - projectId: P-1',
      '    primaryRepoId: primary',
      '    repos:',
      '      - repoId: primary',
      `        repoPath: ${repoRoot}`,
      '',
    ].join('\n'),
  )
  const legacyWork = [
    '---',
    'id: plan-0001',
    'title: Plan',
    'kind: planning',
    'stage: plan',
    'notBefore: null',
    'dependsOn: []',
    'contractRevision: 1',
    'evidenceRefs: []',
    '---',
    'Plan it.',
    '',
  ].join('\n')
  await Bun.write(workPath, legacyWork)
  const legacyAttempt = {
    projectId: 'P-1',
    goalId: 'G-1',
    workId: 'plan-0001',
    runId: 'R-1',
    responsibility: 'planner',
    workHash: null,
    execution: null,
    requestedAt: '2026-07-30T00:00:00.000Z',
    startedAt: '2026-07-30T00:00:01.000Z',
    endedAt: '2026-07-30T00:00:02.000Z',
    status: 'finished',
    result: 'attention',
    summary: 'Need owner input.',
    exitCode: 0,
    application: 'attention',
  }
  await Bun.write(attemptPath, `${JSON.stringify(legacyAttempt, null, 2)}\n`)

  const migration = Bun.spawn(
    [
      'bun',
      'run',
      join(import.meta.dir, 'migrate-home-schema-2.ts'),
      '--home',
      homeRoot,
      '--apply',
    ],
    { cwd: join(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe' },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    migration.exited,
    new Response(migration.stdout).text(),
    new Response(migration.stderr).text(),
  ])
  expect(exitCode, stderr).toBe(0)
  const result = JSON.parse(stdout) as { status: string; backupRoot: string }
  expect(result.status).toBe('migrated')

  const home = parse(await Bun.file(homePath(hopiRoot)).text()) as { schemaEpoch: number }
  expect(home.schemaEpoch).toBe(2)
  expect(parseWorkDocument(await Bun.file(workPath).text()).attributes).toMatchObject({
    contextRefs: [],
    ownerMessages: [],
  })
  expect(await Bun.file(attemptPath).json()).toMatchObject({
    result: 'fail',
    application: 'attention',
  })
  expect(
    await Bun.file(join(result.backupRoot, 'attempts', 'R-1', 'attempt.json')).json(),
  ).toMatchObject({ result: 'attention' })
  expect(
    await Bun.file(
      join(result.backupRoot, 'project-goals', 'P-1', 'G-1', 'work', 'plan-0001.md'),
    ).text(),
  ).toBe(legacyWork)
  expect((await readdir(join(result.backupRoot, 'assistant-home'))).toSorted()).toEqual([
    'home.yml',
    'projects.yml',
  ])
})

function homePath(hopiRoot: string) {
  return join(hopiRoot, 'home.yml')
}
