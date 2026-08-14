import { chmod, cp, lstat, mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { parseWorkAttentionTarget, workAttentionTarget } from '../domain/attentionTarget'
import {
  type WorkDocument,
  isEngineeringWork,
  isWorkTerminal,
  parseWorkDocument,
  renderWorkDocument,
} from '../domain/canonicalDocuments'
import { validateGoalPackageTransition } from '../domain/goalPackage'
import {
  PROJECT_RESET_TRAILER_KEY,
  type ProjectDocument,
  projectReleaseRef,
} from '../domain/project'
import {
  parseProjectDocument,
  renderProjectDocument,
  repoRelease,
  withRepoRelease,
} from '../domain/projectDocument'
import { normalizeProjectPath } from '../domain/projectPath'
import { type PublicationCoordinator, hashBytes } from '../publication/publisher'
import { publicationCandidateFromSnapshot } from '../publication/snapshotCandidate'
import type { PublicationSnapshot, PublicationWrite } from '../publication/types'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import { stageSourceMerge } from './sourceMergePreflight'

export interface C1CompletionInput {
  goalId: string
  workId: string
  sourceEventId: string
  decision: string
  expectedWorkHash: string
  taskWorktrees: Readonly<Record<string, string>>
  expectedTaskHeads: Readonly<Record<string, string>>
  completedWork: WorkDocument
}

export type C1CompletionResult =
  | {
      kind: 'integrated'
      commit: string
      recoveredUncertainUpdate: boolean
    }
  | {
      kind: 'already_integrated'
      commit: string
    }
  | { kind: 'rejected'; reason: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'blocked_after_boundary'; commit: string; reason: string }

export interface C1FaultHooks {
  updateRef?(input: {
    oldTarget: string
    commit: string
    move(): Promise<void>
  }): Promise<void>
  afterRefUpdate?(commit: string): Promise<void> | void
  beforeMaterialization?(commit: string): Promise<void> | void
  beforeSecondaryProjection?(commit: string): Promise<void> | void
  afterSecondaryProjection?(repoId: string, commit: string): Promise<void> | void
}

export interface C1ProjectRepo {
  repoId: string
  integrationRoot: string
  projectPath?: string
  primary: boolean
}

export interface C1ProjectLayout {
  projectId: string
  primaryRepoId: string
  repos: readonly C1ProjectRepo[]
}

export interface C1Integrator {
  complete(input: C1CompletionInput, faultHooks?: C1FaultHooks): Promise<C1CompletionResult>
}

export class C1IntegrationError extends Error {}
class ManagedIntegrationDriftError extends C1IntegrationError {}

export function createC1Integrator(
  homeRoot: string,
  store: GoalPackageStore,
  publisher: PublicationCoordinator,
  now: () => Date,
  layout: C1ProjectLayout,
): C1Integrator {
  const temporaryRoot = join(resolve(homeRoot), '.hopi', 'runtime', 'integration')
  const projectLayout = normalizeProjectLayout(store, layout)
  const releaseRef = projectReleaseRef(projectLayout.projectId)

  return {
    async complete(input, faultHooks = {}) {
      validateInput(store, input)
      const projectRepos = engineeringProjectRepos(projectLayout, input.completedWork)
      const taskWorktrees = resolveTaskWorktrees(projectLayout, projectRepos, input)
      const workReference = workRef(store, input.goalId, input.workId)
      const existing = await findIntegrationCommits(
        store.paths.projectRoot,
        releaseRef,
        workReference,
      )
      if (existing.length > 1) {
        return {
          kind: 'blocked_after_boundary',
          commit: existing[0] ?? 'unknown',
          reason: `More than one reachable C1 owns ${workReference}`,
        }
      }
      if (existing[0]) {
        await validateIntegratedCommit(store, input, existing[0])
        try {
          await recoverProjectProjection(projectLayout, existing[0], faultHooks)
          await store.invalidateCache()
          return { kind: 'already_integrated', commit: existing[0] }
        } catch (error) {
          return {
            kind: 'blocked_after_boundary',
            commit: existing[0],
            reason: `Existing C1 is not materialized: ${errorMessage(error)}`,
          }
        }
      }

      await mkdir(temporaryRoot, { recursive: true })
      const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'c1-'))

      try {
        return await publisher.runExclusive(async (session) => {
          const projectRoot = store.paths.projectRoot
          const oldTarget = await git(projectRoot, ['rev-parse', releaseRef])

          const snapshot = await session.snapshotSelection(store.paths.publicationRoot, {
            paths: [store.paths.agentsPath, store.paths.preparePath],
            prefixes: ['.hopi'],
          })
          const currentCandidate = publicationCandidateFromSnapshot(snapshot)
          const currentPackage = await validateGoalPackageTransition(
            currentCandidate,
            currentCandidate,
            store.paths,
            input.goalId,
          )
          validateCurrentCompletionAuthority(snapshot, currentPackage, store, input)
          await verifyTaskHeads(projectRepos, taskWorktrees, input.expectedTaskHeads)

          const projectFile = snapshot.files.find((file) => file.path === '.hopi/project.yml')
          if (!projectFile?.content || !projectFile.hash) {
            throw new C1IntegrationError('Current project.yml is missing from canonical authority')
          }
          const currentProject = parseProjectDocument(new TextDecoder().decode(projectFile.content))
          validateProjectLayoutDocument(projectLayout, currentProject)

          const oldSecondaryTargets = new Map<string, string>()
          for (const repo of projectLayout.repos) {
            if (repo.primary) continue
            const actual = await git(repo.integrationRoot, ['rev-parse', releaseRef])
            const documented = repoRelease(currentProject, repo.repoId)
            if (!documented || actual !== documented) {
              return {
                kind: 'blocked',
                reason: `Repo ${repo.repoId} release ${actual} disagrees with project.yml ${documented ?? 'missing'}`,
              }
            }
            oldSecondaryTargets.set(repo.repoId, actual)
          }

          let nextProject = currentProject
          for (const repo of projectRepos) {
            if (repo.primary) continue
            const oldRepoTarget = oldSecondaryTargets.get(repo.repoId)
            if (!oldRepoTarget) {
              throw new C1IntegrationError(`Missing old release for Repo ${repo.repoId}`)
            }
            const component = await buildComponentCandidate({
              repo,
              oldTarget: oldRepoTarget,
              taskWorktreePath: requireTaskWorktree(taskWorktrees, repo.repoId),
              indexPath: join(temporaryDirectory, `component-${repo.repoId}.index`),
              store,
              input,
              timestamp: now(),
            })
            if (component.kind === 'rejected') return component
            nextProject = withRepoRelease(nextProject, repo.repoId, component.commit)
          }

          const writes = integrationDocumentWrites(store, input, projectFile.hash, nextProject)
          const candidate = publicationCandidateFromSnapshot(snapshot, writes)
          const nextPackage = await validateGoalPackageTransition(
            currentCandidate,
            candidate,
            store.paths,
            input.goalId,
          )
          validateIntegrationDocumentDelta(input, currentPackage, nextPackage)

          const gitEnv = { GIT_INDEX_FILE: join(temporaryDirectory, 'primary.index') }
          const primary = requireLayoutRepo(projectLayout, projectLayout.primaryRepoId)
          if (!primary.primary) {
            throw new C1IntegrationError(`C1 primary Repo must be ${projectLayout.primaryRepoId}`)
          }
          const primarySource = await buildSourceCandidate({
            repo: primary,
            oldTarget,
            taskWorktreePath: requireTaskWorktree(taskWorktrees, projectLayout.primaryRepoId),
            expectedTaskHead: requireTaskHead(input.expectedTaskHeads, projectLayout.primaryRepoId),
            env: gitEnv,
          })
          if (primarySource.kind === 'rejected') return primarySource

          await replaceCanonicalIndex(projectRoot, gitEnv, snapshot, writes)
          await overlayBootstrapAgents(
            projectRoot,
            gitEnv,
            snapshot,
            store.paths.agentsPath,
            primarySource.mergeBase,
            primarySource.taskHead,
          )
          const tree = await durableGit(projectRoot, ['write-tree'], gitEnv)
          const unsupported = await changedUnsupportedTreeEntries(projectRoot, oldTarget, tree)
          if (unsupported.length > 0) {
            return {
              kind: 'rejected',
              reason: `C1 contains unsupported changed Git entries: ${unsupported.join(', ')}`,
            }
          }

          const commit = await createIntegrationCommit(
            projectRoot,
            tree,
            oldTarget,
            store,
            input,
            now(),
          )
          for (const [repoId, expected] of oldSecondaryTargets) {
            const repo = requireLayoutRepo(projectLayout, repoId)
            const actual = await git(repo.integrationRoot, ['rev-parse', releaseRef])
            if (actual !== expected) {
              return {
                kind: 'blocked',
                reason: `Repo ${repoId} release changed before primary C1 (${expected} -> ${actual})`,
              }
            }
          }
          const changedTaskHead = await firstChangedTaskHead(
            projectRepos,
            taskWorktrees,
            input.expectedTaskHeads,
          )
          if (changedTaskHead) {
            return {
              kind: 'rejected',
              reason: `Repo ${changedTaskHead.repoId} task branch changed before C1 (${changedTaskHead.expected} -> ${changedTaskHead.actual})`,
            }
          }
          let recoveredUncertainUpdate = false
          const move = () => durableUpdateRef(projectRoot, releaseRef, commit, oldTarget)
          try {
            if (faultHooks.updateRef) {
              await faultHooks.updateRef({ oldTarget, commit, move })
            } else {
              await move()
            }
          } catch (error) {
            const actual = await git(projectRoot, ['rev-parse', releaseRef])
            if (actual === oldTarget) {
              return {
                kind: 'rejected',
                reason: `C1 ref update left the old target: ${errorMessage(error)}`,
              }
            }
            if (actual !== commit) {
              return {
                kind: 'blocked_after_boundary',
                commit,
                reason: `C1 ref update is ambiguous at ${actual}: ${errorMessage(error)}`,
              }
            }
            recoveredUncertainUpdate = true
          }

          try {
            await durabilitySync(projectRoot)
            await faultHooks.afterRefUpdate?.(commit)
            await faultHooks.beforeMaterialization?.(commit)
            await materializeCommit(projectRoot, oldTarget, commit)
            await ensureMaterializedCommit(
              requireLayoutRepo(projectLayout, projectLayout.primaryRepoId),
              releaseRef,
              commit,
            )
            await faultHooks.beforeSecondaryProjection?.(commit)
            await materializeSecondaryProjections(
              projectLayout,
              currentProject,
              nextProject,
              faultHooks,
            )
            return { kind: 'integrated', commit, recoveredUncertainUpdate }
          } catch (error) {
            return {
              kind: 'blocked_after_boundary',
              commit,
              reason: `C1 moved but managed projection is not verified: ${errorMessage(error)}`,
            }
          }
        })
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true })
      }
    },
  }
}

function normalizeProjectLayout(store: GoalPackageStore, layout: C1ProjectLayout) {
  const candidate = layout
  const normalized: C1ProjectLayout = {
    ...candidate,
    repos: candidate.repos.map((repo) => ({
      ...repo,
      projectPath: normalizeProjectPath(
        repo.projectPath ?? (repo.primary ? store.paths.projectPath : undefined),
      ),
    })),
  }
  const repoIds = new Set<string>()
  for (const repo of normalized.repos) {
    if (repoIds.has(repo.repoId)) throw new C1IntegrationError(`Duplicate Repo ${repo.repoId}`)
    repoIds.add(repo.repoId)
  }
  const primary = normalized.repos.filter((repo) => repo.primary)
  if (primary.length !== 1 || primary[0]?.repoId !== normalized.primaryRepoId) {
    throw new C1IntegrationError(`C1 primary Repo must be ${normalized.primaryRepoId}`)
  }
  if (resolve(primary[0].integrationRoot) !== resolve(store.paths.projectRoot)) {
    throw new C1IntegrationError('C1 primary Repo must own the canonical Project root')
  }
  return normalized
}

function engineeringProjectRepos(layout: C1ProjectLayout, work: WorkDocument) {
  if (!isEngineeringWork(work.attributes)) {
    throw new C1IntegrationError('C1 Work must be Engineering Work')
  }
  return layout.repos
}

function requireLayoutRepo(layout: C1ProjectLayout, repoId: string) {
  const repo = layout.repos.find((candidate) => candidate.repoId === repoId)
  if (!repo) throw new C1IntegrationError(`Work references unlinked Repo ${repoId}`)
  return repo
}

function resolveTaskWorktrees(
  layout: C1ProjectLayout,
  projectRepos: readonly C1ProjectRepo[],
  input: C1CompletionInput,
) {
  const worktrees = new Map(Object.entries(input.taskWorktrees))
  for (const repo of projectRepos) {
    if (!worktrees.get(repo.repoId)) {
      throw new C1IntegrationError(`C1 is missing task worktree for Repo ${repo.repoId}`)
    }
  }
  for (const repoId of worktrees.keys()) requireLayoutRepo(layout, repoId)
  return worktrees
}

function requireTaskWorktree(worktrees: ReadonlyMap<string, string>, repoId: string) {
  const path = worktrees.get(repoId)
  if (!path) throw new C1IntegrationError(`C1 is missing task worktree for Repo ${repoId}`)
  return path
}

function requireTaskHead(taskHeads: Readonly<Record<string, string>>, repoId: string) {
  const head = taskHeads[repoId]
  if (!head) throw new C1IntegrationError(`C1 is missing task head for Repo ${repoId}`)
  return head
}

function validateProjectLayoutDocument(layout: C1ProjectLayout, document: ProjectDocument) {
  if (document.primaryRepoId !== layout.primaryRepoId) {
    throw new C1IntegrationError('project.yml primary Repo disagrees with runtime layout')
  }
  const runtimeIds = layout.repos.map((repo) => repo.repoId).sort()
  const documentIds = document.repos.map((repo) => repo.repoId).sort()
  if (JSON.stringify(runtimeIds) !== JSON.stringify(documentIds)) {
    throw new C1IntegrationError('project.yml Repo membership disagrees with runtime layout')
  }
}

type SourceCandidateResult =
  | { kind: 'ready'; mergeBase?: string; taskHead?: string }
  | { kind: 'rejected'; reason: string }

async function buildSourceCandidate(input: {
  repo: C1ProjectRepo
  oldTarget: string
  taskWorktreePath: string
  expectedTaskHead: string
  env: Record<string, string> & { GIT_INDEX_FILE: string }
}): Promise<SourceCandidateResult> {
  const taskStatus = await git(input.taskWorktreePath, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  if (taskStatus) {
    return {
      kind: 'rejected',
      reason: `Repo ${input.repo.repoId} task worktree is not checkpoint-clean`,
    }
  }
  const taskHead = await git(input.taskWorktreePath, ['rev-parse', 'HEAD'])
  if (taskHead !== input.expectedTaskHead) {
    return {
      kind: 'rejected',
      reason: `Repo ${input.repo.repoId} task branch changed before C1 (${input.expectedTaskHead} -> ${taskHead})`,
    }
  }
  const mergeBase = await git(input.repo.integrationRoot, ['merge-base', input.oldTarget, taskHead])
  const projectPath = normalizeProjectPath(input.repo.projectPath)
  if (projectPath !== '.') {
    const changedPaths = (
      await git(input.repo.integrationRoot, [
        'diff',
        '--name-only',
        '--no-renames',
        '-z',
        mergeBase,
        taskHead,
      ])
    )
      .split('\0')
      .filter(Boolean)
    const escapedPaths = changedPaths.filter(
      (path) => path !== projectPath && !path.startsWith(`${projectPath}/`),
    )
    if (escapedPaths.length > 0) {
      return {
        kind: 'rejected',
        reason: `Repo ${input.repo.repoId} task changes escape Project scope ${projectPath}: ${escapedPaths.join(', ')}`,
      }
    }
  }
  const merge = await stageSourceMerge({
    repoRoot: input.repo.integrationRoot,
    mergeBase,
    releaseHead: input.oldTarget,
    taskHead,
    indexPath: input.env.GIT_INDEX_FILE,
  })
  if (merge.kind === 'failed') {
    return {
      kind: 'rejected',
      reason: `Cannot construct Repo ${input.repo.repoId} source merge: ${merge.detail}`,
    }
  }
  if (merge.kind === 'conflict') {
    return {
      kind: 'rejected',
      reason: `Repo ${input.repo.repoId} task changes conflict with its current release: ${merge.paths.join(', ')}`,
    }
  }
  return { kind: 'ready', mergeBase, taskHead }
}

async function buildComponentCandidate(input: {
  repo: C1ProjectRepo
  oldTarget: string
  taskWorktreePath: string
  indexPath: string
  store: GoalPackageStore
  input: C1CompletionInput
  timestamp: Date
}): Promise<{ kind: 'ready'; commit: string } | { kind: 'rejected'; reason: string }> {
  const env = { GIT_INDEX_FILE: input.indexPath }
  const source = await buildSourceCandidate({
    repo: input.repo,
    oldTarget: input.oldTarget,
    taskWorktreePath: input.taskWorktreePath,
    expectedTaskHead: requireTaskHead(input.input.expectedTaskHeads, input.repo.repoId),
    env,
  })
  if (source.kind === 'rejected') return source
  const tree = await durableGit(input.repo.integrationRoot, ['write-tree'], env)
  const unsupported = await changedUnsupportedTreeEntries(
    input.repo.integrationRoot,
    input.oldTarget,
    tree,
  )
  if (unsupported.length > 0) {
    return {
      kind: 'rejected',
      reason: `Repo ${input.repo.repoId} contains unsupported changed Git entries: ${unsupported.join(', ')}`,
    }
  }
  const oldTree = await git(input.repo.integrationRoot, [
    'show',
    '-s',
    '--format=%T',
    input.oldTarget,
  ])
  if (tree === oldTree) return { kind: 'ready', commit: input.oldTarget }
  return {
    kind: 'ready',
    commit: await createComponentCommit(
      input.repo.integrationRoot,
      tree,
      input.oldTarget,
      input.repo.repoId,
      input.store,
      input.input,
      input.timestamp,
    ),
  }
}

async function createComponentCommit(
  repoRoot: string,
  tree: string,
  oldTarget: string,
  repoId: string,
  store: GoalPackageStore,
  input: C1CompletionInput,
  timestamp: Date,
) {
  const decisionDigest = await completionDecisionDigest(input.decision)
  const message = [
    `hopi: component ${repoId} for ${input.goalId}/${input.workId}`,
    '',
    `HOPI-Project: ${store.paths.projectId}`,
    `HOPI-Goal: ${input.goalId}`,
    `HOPI-Work: ${input.workId}`,
    `HOPI-Repo: ${repoId}`,
    `HOPI-Assistant-Event: ${input.sourceEventId}`,
    `HOPI-Completion-Decision: ${decisionDigest}`,
    `HOPI-Repo-Commit: ${repoId}=${requireTaskHead(input.expectedTaskHeads, repoId)}`,
    'Generation-Mode: AI-Pure',
    '',
  ].join('\n')
  return durableGit(
    repoRoot,
    ['commit-tree', tree, '-p', oldTarget],
    {
      GIT_AUTHOR_NAME: 'HOPI Assistant',
      GIT_AUTHOR_EMAIL: 'hopi@local',
      GIT_COMMITTER_NAME: 'HOPI Coordinator',
      GIT_COMMITTER_EMAIL: 'hopi@local',
      GIT_AUTHOR_DATE: timestamp.toISOString(),
      GIT_COMMITTER_DATE: timestamp.toISOString(),
    },
    new TextEncoder().encode(message),
  )
}

async function recoverProjectProjection(
  layout: C1ProjectLayout,
  commit: string,
  faultHooks: C1FaultHooks,
) {
  const primary = requireLayoutRepo(layout, layout.primaryRepoId)
  const releaseRef = projectReleaseRef(layout.projectId)
  const primaryTarget = await git(primary.integrationRoot, ['rev-parse', releaseRef])
  if (primaryTarget !== commit) {
    throw new C1IntegrationError(`Primary release no longer points at existing C1 ${commit}`)
  }
  const primaryHead = await git(primary.integrationRoot, ['rev-parse', 'HEAD'])
  if (primaryHead !== commit) {
    await materializeCommit(primary.integrationRoot, primaryHead, commit)
  }
  await ensureMaterializedCommit(primary, releaseRef, commit)

  const nextProject = await readProjectDocumentAt(primary.integrationRoot, commit)
  validateProjectLayoutDocument(layout, nextProject)
  const parent = await git(primary.integrationRoot, ['show', '-s', '--format=%P', commit])
  const firstParent = parent.split(/\s+/)[0]
  const previousProject = firstParent
    ? await readProjectDocumentAtIfPresent(primary.integrationRoot, firstParent)
    : null
  await faultHooks.beforeSecondaryProjection?.(commit)
  for (const repo of layout.repos) {
    if (repo.primary) continue
    const desired = repoRelease(nextProject, repo.repoId)
    if (!desired) throw new C1IntegrationError(`C1 is missing Repo ${repo.repoId} release`)
    let expected = previousProject ? repoRelease(previousProject, repo.repoId) : undefined
    if (!expected) {
      const parentResult = await gitResult(repo.integrationRoot, ['rev-parse', `${desired}^`])
      expected = parentResult.exitCode === 0 ? parentResult.stdout : undefined
    }
    await materializeSecondaryRepo(repo, releaseRef, expected ?? null, desired)
    await faultHooks.afterSecondaryProjection?.(repo.repoId, desired)
  }
}

export async function reconcileProjectReleaseProjection(layout: C1ProjectLayout) {
  const primary = requireLayoutRepo(layout, layout.primaryRepoId)
  const releaseRef = projectReleaseRef(layout.projectId)
  const target = await git(primary.integrationRoot, ['rev-parse', releaseRef])
  const [targetTree, initialIndexTree] = await Promise.all([
    git(primary.integrationRoot, ['show', '-s', '--format=%T', target]),
    git(primary.integrationRoot, ['write-tree']),
  ])
  let indexTree = initialIndexTree
  const parentLine = await git(primary.integrationRoot, ['show', '-s', '--format=%P', target])
  const parent = parentLine.split(/\s+/)[0] || null
  if (indexTree !== targetTree) {
    const parentTree = parent
      ? await git(primary.integrationRoot, ['show', '-s', '--format=%T', parent])
      : null
    if (indexTree !== parentTree) {
      const projectPath = normalizeProjectPath(primary.projectPath)
      await reconcileManagedIntegrationSource(primary, target, [
        projectPath === '.' ? 'AGENTS.md' : posix.join(projectPath, 'AGENTS.md'),
      ])
      indexTree = await git(primary.integrationRoot, ['write-tree'])
    }
    if (indexTree !== targetTree && indexTree !== parentTree) {
      throw new C1IntegrationError(
        `Repo ${primary.repoId} managed integration ${resolve(primary.integrationRoot)} index ${indexTree} is neither current ${targetTree} nor parent ${parentTree ?? 'none'}`,
      )
    }
    if (parent && indexTree === parentTree) {
      await materializeCommit(primary.integrationRoot, parent, target)
    }
  }

  const projectFile = Bun.file(join(primary.integrationRoot, '.hopi', 'project.yml'))
  if (!(await projectFile.exists())) {
    throw new C1IntegrationError('Primary managed root is missing project.yml')
  }
  const currentProject = parseProjectDocument(await projectFile.text())
  validateProjectLayoutDocument(layout, currentProject)
  const previousProject = parent
    ? await readProjectDocumentAtIfPresent(primary.integrationRoot, parent)
    : null

  for (const repo of layout.repos) {
    if (repo.primary) continue
    const desired = repoRelease(currentProject, repo.repoId)
    if (!desired) throw new C1IntegrationError(`project.yml is missing Repo ${repo.repoId} release`)
    let expected = previousProject ? repoRelease(previousProject, repo.repoId) : undefined
    if (!expected) {
      const componentParent = await gitResult(repo.integrationRoot, ['rev-parse', `${desired}^`])
      expected = componentParent.exitCode === 0 ? componentParent.stdout : undefined
    }
    await materializeSecondaryRepo(repo, releaseRef, expected ?? null, desired)
  }
}

async function materializeSecondaryProjections(
  layout: C1ProjectLayout,
  previousProject: ProjectDocument,
  nextProject: ProjectDocument,
  faultHooks: C1FaultHooks,
) {
  for (const repo of layout.repos) {
    if (repo.primary) continue
    const desired = repoRelease(nextProject, repo.repoId)
    const expected = repoRelease(previousProject, repo.repoId)
    if (!desired || !expected) {
      throw new C1IntegrationError(`Cannot project Repo ${repo.repoId} without release commits`)
    }
    await materializeSecondaryRepo(repo, projectReleaseRef(layout.projectId), expected, desired)
    await faultHooks.afterSecondaryProjection?.(repo.repoId, desired)
  }
}

async function materializeSecondaryRepo(
  repo: C1ProjectRepo,
  releaseRef: string,
  expectedOld: string | null,
  desired: string,
) {
  const current = await git(repo.integrationRoot, ['rev-parse', releaseRef])
  const [indexTree, desiredTree, expectedOldTree] = await Promise.all([
    git(repo.integrationRoot, ['write-tree']),
    git(repo.integrationRoot, ['show', '-s', '--format=%T', desired]),
    expectedOld
      ? git(repo.integrationRoot, ['show', '-s', '--format=%T', expectedOld])
      : Promise.resolve(null),
  ])
  const materializedCommit =
    indexTree === desiredTree
      ? desired
      : expectedOld && indexTree === expectedOldTree
        ? expectedOld
        : null
  if (current !== desired) {
    if (!expectedOld || current !== expectedOld) {
      throw new C1IntegrationError(
        `Repo ${repo.repoId} release is ${current}, expected ${expectedOld ?? desired} or ${desired}`,
      )
    }
    await durableUpdateRef(repo.integrationRoot, releaseRef, desired, expectedOld)
    await durabilitySync(repo.integrationRoot)
  }
  if (!materializedCommit) {
    await ensureMaterializedCommit(repo, releaseRef, desired)
    return
  }
  if (materializedCommit !== desired) {
    await materializeCommit(repo.integrationRoot, materializedCommit, desired)
  }
  await ensureMaterializedCommit(repo, releaseRef, desired)
}

async function readProjectDocumentAt(repoRoot: string, commit: string) {
  const content = await gitBytes(repoRoot, ['show', `${commit}:.hopi/project.yml`])
  return parseProjectDocument(new TextDecoder().decode(content))
}

async function readProjectDocumentAtIfPresent(repoRoot: string, commit: string) {
  const paths = await gitBytes(repoRoot, [
    'ls-tree',
    '-z',
    '--name-only',
    commit,
    '--',
    '.hopi/project.yml',
  ])
  return paths.length === 0 ? null : readProjectDocumentAt(repoRoot, commit)
}

async function replaceCanonicalIndex(
  projectRoot: string,
  env: Record<string, string>,
  snapshot: PublicationSnapshot,
  writes: readonly PublicationWrite[],
) {
  const canonicalPaths = (await gitBytes(projectRoot, ['ls-files', '-z', '--', '.hopi'], env))
    .toString()
    .split('\0')
    .filter(Boolean)
  for (const path of canonicalPaths) {
    await git(projectRoot, ['update-index', '--force-remove', '--', path], env)
  }

  const overlays = new Map(
    writes.map((write) => [
      write.path,
      typeof write.content === 'string' ? new TextEncoder().encode(write.content) : write.content,
    ]),
  )
  for (const file of snapshot.files) {
    if (!file.path.startsWith('.hopi/') || file.content === null) continue
    await addBlobToIndex(projectRoot, env, file.path, overlays.get(file.path) ?? file.content)
    overlays.delete(file.path)
  }
  for (const [path, content] of overlays) {
    if (!path.startsWith('.hopi/')) {
      throw new C1IntegrationError(`Integration document is outside .hopi: ${path}`)
    }
    await addBlobToIndex(projectRoot, env, path, content)
  }
}

async function overlayBootstrapAgents(
  projectRoot: string,
  env: Record<string, string>,
  snapshot: PublicationSnapshot,
  agentsPath: string,
  mergeBase?: string,
  taskHead?: string,
) {
  if (mergeBase && taskHead) {
    const taskChanged = await gitResult(
      projectRoot,
      ['diff', '--quiet', mergeBase, taskHead, '--', agentsPath],
      env,
    )
    if (taskChanged.exitCode !== 0 && taskChanged.exitCode !== 1) {
      throw new C1IntegrationError(taskChanged.stderr || 'Cannot inspect AGENTS.md task change')
    }
    if (taskChanged.exitCode === 1) return
  }

  const agents = snapshot.files.find((file) => file.path === agentsPath)
  if (agents?.content) {
    await addBlobToIndex(projectRoot, env, agentsPath, agents.content)
  } else {
    await git(projectRoot, ['update-index', '--force-remove', '--', agentsPath], env, true)
  }
}

async function addBlobToIndex(
  projectRoot: string,
  env: Record<string, string>,
  path: string,
  content: Uint8Array,
) {
  const blob = await durableGit(projectRoot, ['hash-object', '-w', '--stdin'], env, content)
  await git(projectRoot, ['update-index', '--add', '--cacheinfo', '100644', blob, path], env)
}

async function createIntegrationCommit(
  projectRoot: string,
  tree: string,
  oldTarget: string,
  store: GoalPackageStore,
  input: C1CompletionInput,
  timestamp: Date,
) {
  const workReference = workRef(store, input.goalId, input.workId)
  const decisionDigest = await completionDecisionDigest(input.decision)
  const message = [
    `hopi: complete ${input.goalId}/${input.workId}`,
    '',
    `HOPI-Project: ${store.paths.projectId}`,
    `HOPI-Goal: ${input.goalId}`,
    `HOPI-Work: ${input.workId}`,
    `HOPI-Work-Ref: ${workReference}`,
    `HOPI-Assistant-Event: ${input.sourceEventId}`,
    `HOPI-Completion-Decision: ${decisionDigest}`,
    ...Object.entries(input.expectedTaskHeads)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([repoId, commit]) => `HOPI-Repo-Commit: ${repoId}=${commit}`),
    'Generation-Mode: AI-Pure',
    '',
  ].join('\n')
  return durableGit(
    projectRoot,
    ['commit-tree', tree, '-p', oldTarget],
    {
      GIT_AUTHOR_NAME: 'HOPI Assistant',
      GIT_AUTHOR_EMAIL: 'hopi@local',
      GIT_COMMITTER_NAME: 'HOPI Coordinator',
      GIT_COMMITTER_EMAIL: 'hopi@local',
      GIT_AUTHOR_DATE: timestamp.toISOString(),
      GIT_COMMITTER_DATE: timestamp.toISOString(),
    },
    new TextEncoder().encode(message),
  )
}

async function durableUpdateRef(
  projectRoot: string,
  releaseRef: string,
  commit: string,
  oldTarget: string,
) {
  await durableGit(projectRoot, ['update-ref', releaseRef, commit, oldTarget])
}

async function durabilitySync(projectRoot: string) {
  const commonDir = await git(projectRoot, ['rev-parse', '--git-common-dir'])
  const absoluteCommonDir = resolve(projectRoot, commonDir)
  const sync = Bun.spawn(['sync', '-f', absoluteCommonDir], { stdout: 'pipe', stderr: 'pipe' })
  const [stderr, exitCode] = await Promise.all([new Response(sync.stderr).text(), sync.exited])
  if (exitCode !== 0) {
    throw new C1IntegrationError(`Cannot make C1 ref durable: ${stderr.trim()}`)
  }
}

async function materializeCommit(projectRoot: string, oldTarget: string, commit: string) {
  const changes = (
    await gitBytes(projectRoot, ['diff', '--name-status', '--no-renames', '-z', oldTarget, commit])
  )
    .toString()
    .split('\0')
    .filter(Boolean)
  if (changes.length % 2 !== 0) {
    throw new C1IntegrationError('Cannot parse C1 materialization diff')
  }

  for (let index = 0; index < changes.length; index += 2) {
    const status = changes[index]
    const path = changes[index + 1]
    if (!status || !path) throw new C1IntegrationError('Invalid C1 materialization entry')
    const target = await safeProjectPath(projectRoot, path)
    if (status === 'D') {
      await rm(target, { force: true })
      continue
    }
    const entry = await treeEntry(projectRoot, commit, path)
    if (!entry) throw new C1IntegrationError(`C1 tree entry is missing: ${path}`)
    const content = await gitBytes(projectRoot, ['cat-file', 'blob', entry.hash])
    await mkdir(dirname(target), { recursive: true })
    if (entry.mode === '120000') {
      const temporary = `${target}.hopi-tmp-${crypto.randomUUID()}`
      await symlink(content.toString(), temporary)
      await rename(temporary, target)
      continue
    }
    const temporary = `${target}.hopi-tmp-${crypto.randomUUID()}`
    await Bun.write(temporary, content)
    await chmod(temporary, entry.mode === '100755' ? 0o755 : 0o644)
    await rename(temporary, target)
  }
  await git(projectRoot, ['read-tree', commit])
}

async function ensureMaterializedCommit(repo: C1ProjectRepo, releaseRef: string, commit: string) {
  try {
    await validateMaterializedCommit(repo, commit)
    return
  } catch (initialError) {
    if (!(initialError instanceof ManagedIntegrationDriftError)) throw initialError
    const recoveryPath = await archiveManagedIntegrationDrift(repo, commit)
    try {
      await rematerializeManagedIntegration(repo, releaseRef, commit)
      await validateMaterializedCommit(repo, commit)
    } catch (recoveryError) {
      throw new C1IntegrationError(
        `Repo ${repo.repoId} managed integration ${resolve(repo.integrationRoot)} could not be recovered to ${commit}; archived at ${recoveryPath}; initial=${errorMessage(initialError)}; recovery=${errorMessage(recoveryError)}`,
      )
    }
  }
}

export async function reconcileManagedIntegrationSource(
  repo: C1ProjectRepo,
  commit: string,
  allowedPaths: readonly string[] = [],
) {
  const projectRoot = resolve(repo.integrationRoot)
  const [changed, untracked] = await Promise.all([
    gitBytes(projectRoot, ['diff', '--name-only', '-z', 'HEAD']),
    gitBytes(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  const allowed = new Set(allowedPaths)
  const unsafePaths = [...new Set([...nulPaths(changed), ...nulPaths(untracked)])].filter(
    (path) => path !== '.hopi' && !path.startsWith('.hopi/') && !allowed.has(path),
  )
  if (unsafePaths.length === 0) return null

  const recoveryPath = await archiveManagedIntegrationDrift(repo, commit, unsafePaths)
  try {
    await rematerializeManagedIntegrationPaths(repo, commit, unsafePaths)
  } catch (error) {
    throw new C1IntegrationError(
      `Repo ${repo.repoId} managed integration ${projectRoot} source could not be recovered to ${commit}; archived at ${recoveryPath}; recovery=${errorMessage(error)}`,
    )
  }
  return recoveryPath
}

async function archiveManagedIntegrationDrift(
  repo: C1ProjectRepo,
  commit: string,
  requestedPaths?: readonly string[],
) {
  const projectRoot = resolve(repo.integrationRoot)
  const recoveryPath = join(
    dirname(projectRoot),
    'recovery',
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${repo.repoId}-${crypto.randomUUID()}`,
  )
  // Index-reading commands may refresh and lock a worktree index, so never race them.
  const head = await git(projectRoot, ['rev-parse', 'HEAD'])
  const indexTree = await git(projectRoot, ['write-tree'])
  const commitTree = await git(projectRoot, ['show', '-s', '--format=%T', commit])
  const status = await git(projectRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  const changed = await gitBytes(projectRoot, ['diff', '--name-only', '-z', 'HEAD'])
  const staged = await gitBytes(projectRoot, ['diff', '--cached', '--name-only', '-z', 'HEAD'])
  const untracked = await gitBytes(projectRoot, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ])
  const preservedPaths = requestedPaths
    ? [...new Set(requestedPaths)]
    : [...new Set([...nulPaths(changed), ...nulPaths(staged), ...nulPaths(untracked)])]
  const pathspec = preservedPaths.length > 0 ? ['--', ...preservedPaths] : []
  const [workingPatch, indexPatch] = await Promise.all([
    gitBytes(projectRoot, ['diff', '--binary', 'HEAD', ...pathspec]),
    gitBytes(projectRoot, ['diff', '--cached', '--binary', 'HEAD', ...pathspec]),
  ])
  await mkdir(join(recoveryPath, 'files'), { recursive: true })
  for (const path of preservedPaths) {
    const source = await safeProjectPath(projectRoot, path)
    if (!(await pathExists(source))) continue
    const destination = join(recoveryPath, 'files', ...path.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, {
      recursive: true,
      preserveTimestamps: true,
    })
  }
  await Promise.all([
    Bun.write(join(recoveryPath, 'working.patch'), workingPatch),
    Bun.write(join(recoveryPath, 'index.patch'), indexPatch),
    Bun.write(
      join(recoveryPath, 'manifest.json'),
      `${JSON.stringify(
        {
          repoId: repo.repoId,
          integrationRoot: projectRoot,
          expectedCommit: commit,
          observedHead: head,
          observedIndexTree: indexTree,
          expectedTree: commitTree,
          status: status || 'clean',
          preservedPaths,
          archivedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    ),
  ])
  return recoveryPath
}

async function rematerializeManagedIntegration(
  repo: C1ProjectRepo,
  releaseRef: string,
  commit: string,
) {
  const projectRoot = resolve(repo.integrationRoot)
  const [tracked, untracked] = await Promise.all([
    gitBytes(projectRoot, ['ls-files', '-z']),
    gitBytes(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  for (const path of new Set([...nulPaths(tracked), ...nulPaths(untracked)])) {
    await rm(await safeProjectPath(projectRoot, path), {
      recursive: true,
      force: true,
    })
  }
  await git(projectRoot, ['symbolic-ref', 'HEAD', releaseRef])
  await git(projectRoot, ['read-tree', commit])
  await git(projectRoot, ['checkout-index', '--all', '--force'])
}

async function rematerializeManagedIntegrationPaths(
  repo: C1ProjectRepo,
  commit: string,
  paths: readonly string[],
) {
  const projectRoot = resolve(repo.integrationRoot)
  for (const path of paths) {
    await rm(await safeProjectPath(projectRoot, path), {
      recursive: true,
      force: true,
    })
    const entry = await treeEntry(projectRoot, commit, path, true)
    if (!entry) {
      await git(projectRoot, ['update-index', '--force-remove', '--', path])
      continue
    }
    await git(projectRoot, ['update-index', '--add', '--cacheinfo', entry.mode, entry.hash, path])
    await git(projectRoot, ['checkout-index', '--force', '--', path])
  }
}

function nulPaths(value: Uint8Array) {
  return new TextDecoder().decode(value).split('\0').filter(Boolean)
}

async function pathExists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function validateMaterializedCommit(repo: C1ProjectRepo, commit: string) {
  const projectRoot = resolve(repo.integrationRoot)
  // Both write-tree and status may refresh and lock this worktree's index.
  const head = await git(projectRoot, ['rev-parse', 'HEAD'])
  const indexTree = await git(projectRoot, ['write-tree'])
  const status = await git(projectRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  const commitTree = await git(projectRoot, ['show', '-s', '--format=%T', commit])
  if (head !== commit || indexTree !== commitTree || status) {
    throw new ManagedIntegrationDriftError(
      `Repo ${repo.repoId} managed integration ${projectRoot} does not exactly materialize ${commit} (head=${head}, index=${indexTree}, tree=${commitTree}, status=${status || 'clean'})`,
    )
  }
}

async function changedUnsupportedTreeEntries(projectRoot: string, oldTarget: string, tree: string) {
  const changes = (
    await gitBytes(projectRoot, ['diff', '--name-only', '--no-renames', '-z', oldTarget, tree])
  )
    .toString()
    .split('\0')
    .filter(Boolean)
  const unsupported: string[] = []
  for (const path of changes) {
    const entry = await treeEntry(projectRoot, tree, path, true)
    if (entry && !['100644', '100755', '120000'].includes(entry.mode)) {
      unsupported.push(`${path} (${entry.mode})`)
    }
  }
  return unsupported
}

async function treeEntry(projectRoot: string, treeish: string, path: string, missingOkay = false) {
  const output = await git(projectRoot, ['ls-tree', treeish, '--', path])
  if (!output) {
    if (missingOkay) return null
    throw new C1IntegrationError(`C1 tree entry is missing: ${path}`)
  }
  const match = /^(\d+)\s+\w+\s+([a-f0-9]+)\t/.exec(output)
  if (!match?.[1] || !match[2]) throw new C1IntegrationError(`Invalid C1 tree entry: ${path}`)
  return { mode: match[1], hash: match[2] }
}

async function safeProjectPath(projectRoot: string, path: string) {
  if (!path || path.includes('\\') || posix.normalize(path) !== path || path.startsWith('../')) {
    throw new C1IntegrationError(`Unsafe C1 path: ${path}`)
  }
  const target = resolve(projectRoot, path)
  const fromRoot = relative(projectRoot, target)
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw new C1IntegrationError(`C1 path escapes project root: ${path}`)
  }
  let current = projectRoot
  const parts = path.split('/')
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    const stats = await lstat(current).catch(() => null)
    if (stats?.isSymbolicLink() || (stats && !stats.isDirectory())) {
      throw new C1IntegrationError(`C1 path has unsafe parent: ${path}`)
    }
  }
  return target
}

function integrationDocumentWrites(
  store: GoalPackageStore,
  input: C1CompletionInput,
  projectDocumentHash: string,
  projectDocument: ProjectDocument,
) {
  return [
    {
      path: '.hopi/project.yml',
      expectedHash: projectDocumentHash,
      content: renderProjectDocument(projectDocument),
    },
    {
      path: store.paths.workDocument(input.goalId, input.completedWork.attributes.id),
      expectedHash: input.expectedWorkHash,
      content: renderWorkDocument(input.completedWork),
    },
  ] satisfies PublicationWrite[]
}

function validateIntegrationDocumentDelta(
  input: C1CompletionInput,
  current: Awaited<ReturnType<typeof validateGoalPackageTransition>>,
  candidate: Awaited<ReturnType<typeof validateGoalPackageTransition>>,
) {
  const currentWork = current.works.get(input.workId)
  const nextWork = candidate.works.get(input.workId)
  if (
    !currentWork ||
    !isEngineeringWork(currentWork.attributes) ||
    currentWork.attributes.status === 'done' ||
    currentWork.attributes.status === 'cancelled' ||
    !nextWork ||
    JSON.stringify(nextWork) !== JSON.stringify(input.completedWork)
  ) {
    throw new C1IntegrationError('C1 documents do not express the explicit Work completion')
  }
  for (const [workId, work] of current.works) {
    if (
      workId !== input.workId &&
      JSON.stringify(work) !== JSON.stringify(candidate.works.get(workId))
    ) {
      throw new C1IntegrationError(`C1 unexpectedly changes Work ${workId}`)
    }
  }
}

function validateCurrentCompletionAuthority(
  snapshot: PublicationSnapshot,
  current: Awaited<ReturnType<typeof validateGoalPackageTransition>>,
  store: GoalPackageStore,
  input: C1CompletionInput,
) {
  if (current.goal.attributes.lifecycle !== 'active') {
    throw new C1IntegrationError(
      `Cannot complete Work in ${current.goal.attributes.lifecycle} Goal ${input.goalId}`,
    )
  }
  const work = current.works.get(input.workId)
  if (!work || !isEngineeringWork(work.attributes) || isWorkTerminal(work.attributes)) {
    throw new C1IntegrationError(`Engineering Work is missing or terminal: ${input.workId}`)
  }
  const incompleteDependency = work.attributes.dependsOn.find(
    (dependencyId) => current.works.get(dependencyId)?.attributes.status !== 'done',
  )
  if (incompleteDependency) {
    throw new C1IntegrationError(`Dependency is not done: ${incompleteDependency}`)
  }
  const path = store.paths.workDocument(input.goalId, input.workId)
  const file = snapshot.files.find((candidate) => candidate.path === path)
  if (!file?.content || file.hash !== input.expectedWorkHash) {
    throw new C1IntegrationError(`Work authority changed before C1: ${input.workId}`)
  }
}

async function verifyTaskHeads(
  repos: readonly C1ProjectRepo[],
  taskWorktrees: ReadonlyMap<string, string>,
  expectedTaskHeads: Readonly<Record<string, string>>,
) {
  const changed = await firstChangedTaskHead(repos, taskWorktrees, expectedTaskHeads)
  if (changed) {
    throw new C1IntegrationError(
      `Repo ${changed.repoId} task branch changed before C1 (${changed.expected} -> ${changed.actual})`,
    )
  }
}

async function firstChangedTaskHead(
  repos: readonly C1ProjectRepo[],
  taskWorktrees: ReadonlyMap<string, string>,
  expectedTaskHeads: Readonly<Record<string, string>>,
) {
  for (const repo of repos) {
    const expected = requireTaskHead(expectedTaskHeads, repo.repoId)
    const actual = await git(requireTaskWorktree(taskWorktrees, repo.repoId), ['rev-parse', 'HEAD'])
    if (actual !== expected) return { repoId: repo.repoId, expected, actual }
  }
  return null
}

async function completionDecisionDigest(decision: string) {
  return `sha256:${await hashBytes(new TextEncoder().encode(decision.trim()))}`
}

function validateInput(_store: GoalPackageStore, input: C1CompletionInput) {
  if (
    input.workId !== input.completedWork.attributes.id ||
    !isEngineeringWork(input.completedWork.attributes) ||
    input.completedWork.attributes.status !== 'done' ||
    !input.sourceEventId.trim() ||
    !input.decision.trim()
  ) {
    throw new C1IntegrationError('C1 requires one explicit Engineering Work completion')
  }
  for (const repoId of Object.keys(input.taskWorktrees))
    requireTaskHead(input.expectedTaskHeads, repoId)
}

export async function findIntegrationCommits(
  projectRoot: string,
  target: string,
  workReference: string,
) {
  const identity = parseWorkAttentionTarget(workReference)
  if (!identity) return []
  return (await listIntegrationRecords(projectRoot, target, identity.projectId))
    .filter((record) => record.workReference === workReference)
    .map((record) => record.commit)
}

export interface IntegrationRecord {
  commit: string
  workReference: string
  assistantEventId: string | null
  completionDecision: string | null
  repoCommits: Readonly<Record<string, string>>
}

export async function listIntegrationRecords(
  projectRoot: string,
  target: string,
  projectId: string,
) {
  const bytes = await gitBytes(projectRoot, ['log', target, '--format=%H%x00%B%x00'])
  const fields = bytes.toString().split('\0')
  const records: IntegrationRecord[] = []
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const commit = fields[index]?.trim()
    const message = fields[index + 1] ?? ''
    if (trailerValue(message, PROJECT_RESET_TRAILER_KEY) === projectId) break
    const workReference = trailerValue(message, 'HOPI-Work-Ref')
    if (!commit || !workReference) continue
    records.push({
      commit,
      workReference,
      assistantEventId: trailerValue(message, 'HOPI-Assistant-Event') ?? null,
      completionDecision: trailerValue(message, 'HOPI-Completion-Decision') ?? null,
      repoCommits: Object.fromEntries(
        trailerValues(message, 'HOPI-Repo-Commit').map((value) => {
          const separator = value.indexOf('=')
          return separator > 0
            ? [value.slice(0, separator), value.slice(separator + 1)]
            : [value, '']
        }),
      ),
    })
  }
  return records
}

async function validateIntegratedCommit(
  store: GoalPackageStore,
  input: C1CompletionInput,
  commit: string,
) {
  const workPath = store.paths.workDocument(input.goalId, input.workId)
  const workBytes = await gitBytes(store.paths.projectRoot, ['show', `${commit}:${workPath}`])
  const workSource = new TextDecoder().decode(workBytes)
  const workMatches =
    renderWorkDocument(parseWorkDocument(workSource)) === renderWorkDocument(input.completedWork)
  const message = await git(store.paths.projectRoot, ['show', '-s', '--format=%B', commit])
  const eventMatches = trailerValue(message, 'HOPI-Assistant-Event') === input.sourceEventId
  const decisionMatches =
    trailerValue(message, 'HOPI-Completion-Decision') ===
    (await completionDecisionDigest(input.decision))
  const repoCommits = new Map(
    trailerValues(message, 'HOPI-Repo-Commit').map((value) => {
      const separator = value.indexOf('=')
      return [value.slice(0, separator), value.slice(separator + 1)] as const
    }),
  )
  const reposMatch = Object.entries(input.expectedTaskHeads).every(
    ([repoId, taskHead]) => repoCommits.get(repoId) === taskHead,
  )
  if (!workMatches || !eventMatches || !decisionMatches || !reposMatch) {
    throw new C1IntegrationError(
      `Existing C1 ${commit} does not match the completion request (work=${workMatches}, event=${eventMatches}, decision=${decisionMatches}, repos=${reposMatch})`,
    )
  }
}

function workRef(store: GoalPackageStore, goalId: string, workId: string) {
  return workAttentionTarget(store.paths.projectId, goalId, workId)
}

async function durableGit(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
  stdin?: Uint8Array,
) {
  return git(cwd, ['-c', 'core.fsyncObjectFiles=true', ...args], env, false, stdin)
}

async function git(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
  allowFailure = false,
  stdin?: Uint8Array,
) {
  const result = await gitResult(cwd, args, env, stdin)
  if (result.exitCode !== 0 && !allowFailure) {
    throw new C1IntegrationError(
      `git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`,
    )
  }
  return result.stdout
}

async function gitBytes(cwd: string, args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(['git', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new C1IntegrationError(`git ${args.join(' ')} failed: ${stderr.trim()}`)
  }
  return Buffer.from(stdout)
}

async function gitResult(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
  stdin?: Uint8Array,
) {
  const child = Bun.spawn(['git', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: stdin ? 'pipe' : 'ignore',
    env: { ...process.env, ...env },
  })
  if (stdin && typeof child.stdin !== 'number' && child.stdin) {
    child.stdin.write(stdin)
    child.stdin.end()
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function trailerValue(message: string, key: string) {
  const prefix = `${key}: `
  return message
    .split(/\r?\n/)
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim()
}

function trailerValues(message: string, key: string) {
  const prefix = `${key}: `
  return message
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim())
}
