import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { LinkedProjectRepo } from '../domain/project'
import { projectReleaseRef } from '../domain/project'
import { materializeCommit } from './c1Integrator'
import type {
  DeliveryOperation,
  DeliveryOperationResult,
  DeliveryOperationStore,
} from './deliveryOperationStore'
import type { RunChangeSet, RunChangeSetStore } from './runChangeSet'

export interface DeliveryOperationExecutor {
  execute(operationId: string, approvedByEventId: string): Promise<DeliveryOperation>
}

export function createDeliveryOperationExecutor(input: {
  projectId: string
  repos: readonly LinkedProjectRepo[]
  operations: DeliveryOperationStore
  changeSets: RunChangeSetStore
}): DeliveryOperationExecutor {
  const active = new Map<string, Promise<DeliveryOperation>>()

  return {
    execute(operationId, approvedByEventId) {
      const current = active.get(operationId)
      if (current) return current
      const execution = executeOnce(input, operationId, approvedByEventId).finally(() => {
        if (active.get(operationId) === execution) active.delete(operationId)
      })
      active.set(operationId, execution)
      return execution
    },
  }
}

async function executeOnce(
  input: {
    projectId: string
    repos: readonly LinkedProjectRepo[]
    operations: DeliveryOperationStore
    changeSets: RunChangeSetStore
  },
  operationId: string,
  approvedByEventId: string,
) {
  const operation = await input.operations.begin(operationId, approvedByEventId)
  if (operation.status !== 'executing') return operation
  try {
    if (operation.projectId !== input.projectId) {
      throw new Error(`Delivery Operation is outside Project ${input.projectId}: ${operation.id}`)
    }
    const changeSet = await input.changeSets.readById(operation.intent.changeSetId)
    if (!changeSet) throw new Error(`ChangeSet not found: ${operation.intent.changeSetId}`)
    assertOperationScope(operation, changeSet)

    if (operation.intent.kind === 'baseline_integration') {
      const result = await integrateBaseline(input.projectId, input.repos, changeSet, operation)
      return result.kind === 'baseline_conflict'
        ? input.operations.fail(operation.id, result)
        : input.operations.succeed(operation.id, result)
    }

    const result = await createArchive(
      input.repos,
      changeSet,
      input.operations.operationRoot(operation.id),
      operation.intent.outputName,
    )
    return input.operations.succeed(operation.id, result)
  } catch (error) {
    return input.operations.fail(operation.id, {
      kind: 'operation_failed',
      summary: error instanceof Error ? error.message : String(error),
    })
  }
}

function assertOperationScope(operation: DeliveryOperation, changeSet: RunChangeSet) {
  if (
    changeSet.projectId !== operation.projectId ||
    changeSet.goalId !== operation.goalId ||
    (operation.workId !== null && changeSet.workId !== operation.workId)
  ) {
    throw new Error(`ChangeSet is outside Delivery Operation scope: ${changeSet.id}`)
  }
}

async function integrateBaseline(
  projectId: string,
  linkedRepos: readonly LinkedProjectRepo[],
  changeSet: RunChangeSet,
  operation: DeliveryOperation,
): Promise<DeliveryOperationResult> {
  const releaseRef = projectReleaseRef(projectId)
  const repos = changeSet.repos.map((candidate) => {
    const linked = linkedRepos.find((repo) => repo.repoId === candidate.repoId)
    if (!linked) throw new Error(`ChangeSet Repo is not linked: ${candidate.repoId}`)
    return { linked, candidate }
  })
  const observed = await Promise.all(
    repos.map(async ({ linked, candidate }) => ({
      repoId: linked.repoId,
      expectedBase: candidate.baseCommit,
      resultCommit: candidate.resultCommit,
      observedCommit: await gitOutput(linked.integrationRoot, ['rev-parse', releaseRef]),
    })),
  )
  for (const { linked, candidate } of repos) {
    if (!(await isAncestor(linked.integrationRoot, candidate.baseCommit, candidate.resultCommit))) {
      return {
        kind: 'baseline_conflict',
        changeSetId: changeSet.id,
        summary: `Repo ${linked.repoId} result does not descend from its expected base.`,
        repos: observed,
      }
    }
    const sourceStatus = await gitOutput(linked.integrationRoot, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      '.',
      ':(exclude).hopi/**',
    ])
    if (sourceStatus) {
      return {
        kind: 'baseline_conflict',
        changeSetId: changeSet.id,
        summary: `Repo ${linked.repoId} managed integration contains uncommitted source state.`,
        repos: observed,
      }
    }
    const current = observed.find((repo) => repo.repoId === linked.repoId)?.observedCommit
    if (!current) throw new Error(`Missing observed baseline for Repo ${linked.repoId}`)
    if (
      current !== candidate.baseCommit &&
      current !== candidate.resultCommit &&
      !(await isAncestor(linked.integrationRoot, candidate.resultCommit, current)) &&
      (await hasSourceDelta(linked.integrationRoot, candidate.baseCommit, current))
    ) {
      return {
        kind: 'baseline_conflict',
        changeSetId: changeSet.id,
        summary: `Repo ${linked.repoId} source baseline changed from ${candidate.baseCommit} to ${current}.`,
        repos: observed,
      }
    }
  }

  for (const { linked, candidate } of repos) {
    const current = await gitOutput(linked.integrationRoot, ['rev-parse', releaseRef])
    let integratedCommit = candidate.resultCommit
    if (
      current === candidate.resultCommit ||
      (await isAncestor(linked.integrationRoot, candidate.resultCommit, current))
    ) {
      integratedCommit = current
    } else if (current === candidate.baseCommit) {
      await gitOutput(linked.integrationRoot, [
        'update-ref',
        releaseRef,
        candidate.resultCommit,
        candidate.baseCommit,
      ])
    } else if (!(await hasSourceDelta(linked.integrationRoot, candidate.baseCommit, current))) {
      integratedCommit = await createAncestryPreservingMerge(
        linked.integrationRoot,
        current,
        candidate,
        operation,
      )
      const updated = await updateRefIfExpected(
        linked.integrationRoot,
        releaseRef,
        integratedCommit,
        current,
      )
      if (!updated) {
        const currentObserved = await observedRepos(repos, releaseRef)
        return {
          kind: 'baseline_conflict',
          changeSetId: changeSet.id,
          summary: `Repo ${linked.repoId} baseline changed during integration.`,
          repos: currentObserved,
        }
      }
    } else {
      const currentObserved = await Promise.all(
        repos.map(async ({ linked: currentRepo, candidate: currentCandidate }) => ({
          repoId: currentRepo.repoId,
          expectedBase: currentCandidate.baseCommit,
          resultCommit: currentCandidate.resultCommit,
          observedCommit: await gitOutput(currentRepo.integrationRoot, ['rev-parse', releaseRef]),
        })),
      )
      return {
        kind: 'baseline_conflict',
        changeSetId: changeSet.id,
        summary: `Repo ${linked.repoId} baseline changed during integration.`,
        repos: currentObserved,
      }
    }
    await materializeCommit(linked.integrationRoot, current, integratedCommit)
  }

  return {
    kind: 'baseline_integrated',
    changeSetId: changeSet.id,
    repos: await Promise.all(
      repos.map(async ({ linked, candidate }) => ({
        repoId: linked.repoId,
        expectedBase: candidate.baseCommit,
        resultCommit: candidate.resultCommit,
        observedCommit: await gitOutput(linked.integrationRoot, ['rev-parse', releaseRef]),
      })),
    ),
  }
}

async function observedRepos(
  repos: ReadonlyArray<{
    linked: LinkedProjectRepo
    candidate: RunChangeSet['repos'][number]
  }>,
  releaseRef: string,
) {
  return Promise.all(
    repos.map(async ({ linked, candidate }) => ({
      repoId: linked.repoId,
      expectedBase: candidate.baseCommit,
      resultCommit: candidate.resultCommit,
      observedCommit: await gitOutput(linked.integrationRoot, ['rev-parse', releaseRef]),
    })),
  )
}

async function hasSourceDelta(cwd: string, before: string, after: string) {
  const child = Bun.spawn(
    ['git', 'diff', '--quiet', before, after, '--', '.', ':(exclude).hopi/**'],
    { cwd, stdout: 'pipe', stderr: 'pipe' },
  )
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (exitCode === 0) return false
  if (exitCode === 1) return true
  throw new Error(`git diff failed in ${cwd}: ${stderr.trim()}`)
}

async function createAncestryPreservingMerge(
  cwd: string,
  current: string,
  candidate: RunChangeSet['repos'][number],
  operation: DeliveryOperation,
) {
  const gitIndexPath = await gitOutput(cwd, [
    'rev-parse',
    '--git-path',
    `hopi-operation/${operation.id}/${candidate.repoId}.index`,
  ])
  const indexFile = resolve(cwd, gitIndexPath)
  const environment = { ...process.env, GIT_INDEX_FILE: indexFile }
  await mkdir(dirname(indexFile), { recursive: true })
  await rm(indexFile, { force: true })
  try {
    await gitOutput(cwd, ['read-tree', current], environment)
    const patch = await gitBytes(cwd, [
      'diff',
      '--binary',
      candidate.baseCommit,
      candidate.resultCommit,
      '--',
      '.',
      ':(exclude).hopi/**',
    ])
    await gitInput(cwd, ['apply', '--cached', '--binary', '-'], patch, environment)
    const tree = await gitOutput(cwd, ['write-tree'], environment)
    const message = [
      `hopi: accept ChangeSet ${operation.intent.changeSetId}`,
      '',
      `HOPI-Operation: ${operation.id}`,
      `HOPI-ChangeSet: ${operation.intent.changeSetId}`,
      `HOPI-Candidate: ${candidate.resultCommit}`,
      '',
    ].join('\n')
    return gitInputText(
      cwd,
      ['commit-tree', tree, '-p', current, '-p', candidate.resultCommit],
      message,
      {
        ...environment,
        GIT_AUTHOR_NAME: 'HOPI Operation',
        GIT_AUTHOR_EMAIL: 'hopi@local',
        GIT_COMMITTER_NAME: 'HOPI Coordinator',
        GIT_COMMITTER_EMAIL: 'hopi@local',
        GIT_AUTHOR_DATE: operation.proposedAt,
        GIT_COMMITTER_DATE: operation.proposedAt,
      },
    )
  } finally {
    await rm(indexFile, { force: true })
  }
}

async function updateRefIfExpected(cwd: string, ref: string, next: string, expected: string) {
  const child = Bun.spawn(['git', 'update-ref', ref, next, expected], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exitCode = await child.exited
  return exitCode === 0
}

async function createArchive(
  linkedRepos: readonly LinkedProjectRepo[],
  changeSet: RunChangeSet,
  operationRoot: string,
  outputName: string,
): Promise<DeliveryOperationResult> {
  const stagingRoot = join(operationRoot, 'archive-staging')
  const outputRoot = join(operationRoot, 'artifacts')
  const outputPath = join(outputRoot, outputName)
  await rm(stagingRoot, { recursive: true, force: true })
  await mkdir(stagingRoot, { recursive: true })
  await mkdir(outputRoot, { recursive: true })
  await rm(outputPath, { force: true })
  try {
    for (const candidate of changeSet.repos) {
      const linked = linkedRepos.find((repo) => repo.repoId === candidate.repoId)
      if (!linked) throw new Error(`ChangeSet Repo is not linked: ${candidate.repoId}`)
      const tarPath = join(operationRoot, `${candidate.repoId}.tar`)
      await rm(tarPath, { force: true })
      const pathspec =
        linked.projectPath === '.' ? ['.', ':(exclude).hopi/**'] : [linked.projectPath]
      await run(
        [
          'git',
          '-c',
          'core.autocrlf=false',
          'archive',
          '--format=tar',
          `--prefix=${candidate.repoId}/`,
          `--output=${tarPath}`,
          candidate.resultCommit,
          '--',
          ...pathspec,
        ],
        linked.integrationRoot,
      )
      await run(['tar', '-xf', tarPath, '-C', stagingRoot], operationRoot)
      await rm(tarPath, { force: true })
    }
    await run(['zip', '-X', '-q', '-r', outputPath, '.'], stagingRoot)
    const bytes = new Uint8Array(await Bun.file(outputPath).arrayBuffer())
    const info = await stat(outputPath)
    return {
      kind: 'archive_created',
      changeSetId: changeSet.id,
      path: outputPath,
      contentHash: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
      size: info.size,
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}

async function isAncestor(cwd: string, ancestor: string, descendant: string) {
  const child = Bun.spawn(['git', 'merge-base', '--is-ancestor', ancestor, descendant], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (exitCode === 0) return true
  if (exitCode === 1) return false
  throw new Error(`git merge-base failed in ${cwd}: ${stderr.trim()}`)
}

async function gitOutput(
  cwd: string,
  args: string[],
  env: Record<string, string | undefined> = process.env,
) {
  const child = Bun.spawn(['git', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${stderr.trim()}`)
  return stdout.trim()
}

async function gitBytes(
  cwd: string,
  args: string[],
  env: Record<string, string | undefined> = process.env,
) {
  const child = Bun.spawn(['git', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${stderr.trim()}`)
  return new Uint8Array(stdout)
}

async function gitInput(
  cwd: string,
  args: string[],
  input: Uint8Array,
  env: Record<string, string | undefined> = process.env,
) {
  const child = Bun.spawn(['git', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })
  if (typeof child.stdin === 'number' || !child.stdin) {
    throw new Error('git stdin is unavailable')
  }
  child.stdin.write(input)
  child.stdin.end()
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${stderr.trim()}`)
  return stdout.trim()
}

function gitInputText(
  cwd: string,
  args: string[],
  input: string,
  env: Record<string, string | undefined> = process.env,
) {
  return gitInput(cwd, args, new TextEncoder().encode(input), env)
}

async function run(command: string[], cwd: string) {
  const child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`${command[0]} failed in ${cwd}: ${(stderr || stdout).trim()}`)
  }
}
