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
import { type C1ProjectLayout, listIntegrationRecords } from './c1Integrator'

export interface CompletionStructureVerifier {
  verify(goalId: string, goalPackage: GoalPackage): Promise<boolean>
}

export function createCompletionStructureVerifier(
  store: GoalPackageStore,
  layout?: C1ProjectLayout,
): CompletionStructureVerifier {
  return {
    async verify(goalId, goalPackage) {
      for (const work of goalPackage.works.values()) {
        if (!isEngineeringWork(work.attributes) || work.attributes.status !== 'done') continue
        const workReference = workAttentionTarget(store.paths.projectId, goalId, work.attributes.id)
        const records = (
          await listIntegrationRecords(
            store.paths.projectRoot,
            projectReleaseRef(store.paths.projectId),
            store.paths.projectId,
          )
        ).filter((record) => record.workReference === workReference)
        if (records.length !== 1) return false
        const record = records[0]
        if (!record?.assistantEventId || !record.completionDecision) return false
        if (layout?.repos.some((repo) => !record.repoCommits[repo.repoId])) return false
        const commit = record.commit
        const source = await gitBlob(
          store.paths.projectRoot,
          `${commit}:${store.paths.workDocument(goalId, work.attributes.id)}`,
        )
        if (!source || renderWorkDocument(parseWorkDocument(source)) !== renderWorkDocument(work)) {
          return false
        }
      }
      if (layout && !(await releaseProjectionMatches(store, layout))) return false
      return true
    },
  }
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
