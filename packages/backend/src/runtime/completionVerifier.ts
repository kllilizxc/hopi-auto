import { workAttentionTarget } from '../domain/attentionTarget'
import {
  isEngineeringWork,
  parseWorkDocument,
  renderWorkDocument,
} from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import { projectReleaseRef } from '../domain/project'
import { parseProjectDocument, repoRelease } from '../domain/projectDocument'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import { type C1ProjectLayout, findIntegrationCommits } from './c1Integrator'
import type { DeliveryOperationStore } from './deliveryOperationStore'
import type { RunAttemptStore } from './runAttemptStore'
import type { RunChangeSetStore } from './runChangeSet'

export interface CompletionStructureVerifier {
  verify(goalId: string, goalPackage: GoalPackage): Promise<boolean>
}

export interface RunManagedCompletionFacts {
  attempts: RunAttemptStore
  operations: DeliveryOperationStore
  changeSets: RunChangeSetStore
}

export function createCompletionStructureVerifier(
  store: GoalPackageStore,
  layout?: C1ProjectLayout,
  runManaged?: RunManagedCompletionFacts,
): CompletionStructureVerifier {
  return {
    async verify(goalId, goalPackage) {
      const reportManagedWorkIds = runManaged
        ? new Set(
            (
              await Promise.all(
                [...goalPackage.works.keys()].map(async (workId) => ({
                  workId,
                  managed:
                    goalPackage.works
                      .get(workId)
                      ?.attributes.ownerMessages.some((message) =>
                        message.content.startsWith('Completion decision:'),
                      ) === true &&
                    (
                      await runManaged.attempts.list(store.paths.projectId, goalId, workId)
                    ).some((attempt) => attempt.protocol === 'report'),
                })),
              )
            )
              .filter((entry) => entry.managed)
              .map((entry) => entry.workId),
          )
        : new Set<string>()
      if (
        reportManagedWorkIds.size > 0 &&
        runManaged &&
        !(await verifyRunManagedOperations(store, layout, runManaged, goalId, goalPackage))
      ) {
        return false
      }
      for (const work of goalPackage.works.values()) {
        if (!isEngineeringWork(work.attributes) || work.attributes.stage !== 'done') continue
        if (reportManagedWorkIds.has(work.attributes.id)) continue
        const workReference = workAttentionTarget(store.paths.projectId, goalId, work.attributes.id)
        const commits = await findIntegrationCommits(
          store.paths.projectRoot,
          projectReleaseRef(store.paths.projectId),
          workReference,
        )
        if (commits.length !== 1) return false
        const commit = commits[0]
        if (!commit) return false
        const source = await gitBlob(
          store.paths.projectRoot,
          `${commit}:${store.paths.workDocument(goalId, work.attributes.id)}`,
        )
        if (!source || renderWorkDocument(parseWorkDocument(source)) !== renderWorkDocument(work)) {
          return false
        }
        const message = await git(store.paths.projectRoot, ['show', '-s', '--format=%B', commit])
        const producerRun = trailerValue(message, 'HOPI-Producer-Run')
        if (
          !producerRun ||
          !work.attributes.evidenceRefs.some(
            (evidenceId) =>
              goalPackage.evidence.get(evidenceId)?.attributes.producerRun === producerRun,
          )
        ) {
          return false
        }
      }
      if (layout && !(await releaseProjectionMatches(store, layout))) return false
      return true
    },
  }
}

async function verifyRunManagedOperations(
  store: GoalPackageStore,
  layout: C1ProjectLayout | undefined,
  facts: RunManagedCompletionFacts,
  goalId: string,
  goalPackage: GoalPackage,
) {
  const operations = await facts.operations.listGoal(store.paths.projectId, goalId)
  if (
    goalPackage.goal.attributes.lifecycle === 'done' &&
    operations.some((operation) => operation.requiredForGoal && operation.status !== 'succeeded')
  ) {
    return false
  }

  for (const operation of operations) {
    if (operation.status !== 'succeeded') continue
    const changeSet = await facts.changeSets.readById(operation.intent.changeSetId)
    if (
      !changeSet ||
      changeSet.projectId !== store.paths.projectId ||
      changeSet.goalId !== goalId ||
      (operation.workId !== null && changeSet.workId !== operation.workId)
    ) {
      return false
    }
    if (operation.intent.kind === 'archive') {
      if (
        operation.result?.kind !== 'archive_created' ||
        operation.result.changeSetId !== changeSet.id ||
        (operation.requiredForGoal && !(await archiveResultExists(operation.result)))
      ) {
        return false
      }
      continue
    }
    if (operation.result?.kind !== 'baseline_integrated' || !layout) return false
    for (const candidate of changeSet.repos) {
      const repo = layout.repos.find((entry) => entry.repoId === candidate.repoId)
      const observed = operation.result.repos.find((entry) => entry.repoId === candidate.repoId)
      if (
        !repo ||
        !observed ||
        observed.expectedBase !== candidate.baseCommit ||
        observed.resultCommit !== candidate.resultCommit
      ) {
        return false
      }
      const release = await git(repo.integrationRoot, [
        'rev-parse',
        projectReleaseRef(store.paths.projectId),
      ])
      if (!(await isAncestor(repo.integrationRoot, candidate.resultCommit, release.trim()))) {
        return false
      }
    }
  }
  return true
}

async function archiveResultExists(result: {
  path: string
  contentHash: string
  size: number
}) {
  const file = Bun.file(result.path)
  if (!(await file.exists()) || file.size !== result.size) return false
  const hasher = new Bun.CryptoHasher('sha256')
  const reader = file.stream().getReader()
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    hasher.update(chunk.value)
  }
  const hash = hasher.digest('hex')
  return hash === result.contentHash
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

async function releaseProjectionMatches(store: GoalPackageStore, layout: C1ProjectLayout) {
  const releaseRef = projectReleaseRef(layout.projectId)
  const source = await Bun.file(`${store.paths.projectRoot}/.hopi/project.yml`).text()
  const document = parseProjectDocument(source)
  for (const repo of layout.repos) {
    if (repo.primary) continue
    const expected = repoRelease(document, repo.repoId)
    if (!expected) return false
    // Both write-tree and status may refresh and lock this worktree's index.
    const target = await git(repo.integrationRoot, ['rev-parse', releaseRef])
    const head = await git(repo.integrationRoot, ['rev-parse', 'HEAD'])
    const indexTree = await git(repo.integrationRoot, ['write-tree'])
    const expectedTree = await git(repo.integrationRoot, ['show', '-s', '--format=%T', expected])
    const status = await git(repo.integrationRoot, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ])
    if (
      target.trim() !== expected ||
      head.trim() !== expected ||
      indexTree.trim() !== expectedTree.trim() ||
      status
    ) {
      return false
    }
  }
  return true
}

async function gitBlob(cwd: string, object: string) {
  const child = Bun.spawn(['git', 'show', object], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    child.exited,
  ])
  return exitCode === 0 ? new TextDecoder().decode(stdout) : null
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr.trim() || stdout.trim())
  return stdout
}

function trailerValue(message: string, key: string) {
  const prefix = `${key}: `
  return message
    .split(/\r?\n/)
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim()
}
