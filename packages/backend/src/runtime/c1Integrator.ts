import { chmod, lstat, mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import {
  type EvidenceDocument,
  type WorkDocument,
  engineeringWorkRepoIds,
  isEngineeringWork,
  parseEvidenceDocument,
  parseWorkDocument,
  renderEvidenceDocument,
  renderWorkDocument,
} from '../domain/canonicalDocuments'
import { validateGoalPackageTransition } from '../domain/goalPackage'
import { DEFAULT_PRIMARY_REPO_ID, HOPI_RELEASE_REF, type ProjectDocument } from '../domain/project'
import {
  parseProjectDocument,
  renderProjectDocument,
  repoRelease,
  withRepoRelease,
} from '../domain/projectDocument'
import type { PublicationCoordinator } from '../publication/publisher'
import { publicationCandidateFromSnapshot } from '../publication/snapshotCandidate'
import type { PublicationSnapshot, PublicationWrite } from '../publication/types'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import type { ApplyPassOutcomeInput } from './passOutcomeCoordinator'
import { validatePassSemanticGuard } from './passOutcomeCoordinator'

export interface C1IntegrationInput {
  pass: ApplyPassOutcomeInput
  taskWorktreePath: string
  taskWorktrees?: Readonly<Record<string, string>>
  evidence: EvidenceDocument
  completedWork: WorkDocument
}

export type C1IntegrationResult =
  | { kind: 'integrated'; commit: string; recoveredUncertainUpdate: boolean }
  | { kind: 'already_integrated'; commit: string }
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
  primary: boolean
}

export interface C1ProjectLayout {
  primaryRepoId: string
  repos: readonly C1ProjectRepo[]
}

export interface C1Integrator {
  integrate(input: C1IntegrationInput, faultHooks?: C1FaultHooks): Promise<C1IntegrationResult>
}

export class C1IntegrationError extends Error {}

export function createC1Integrator(
  homeRoot: string,
  store: GoalPackageStore,
  publisher: PublicationCoordinator,
  now: () => Date = () => new Date(),
  layout?: C1ProjectLayout,
): C1Integrator {
  const temporaryRoot = join(resolve(homeRoot), '.hopi', 'runtime', 'integration')
  const projectLayout = normalizeProjectLayout(store, layout)

  return {
    async integrate(input, faultHooks = {}) {
      validateInput(store, input)
      const selectedRepos = selectedProjectRepos(projectLayout, input.completedWork)
      const taskWorktrees = resolveTaskWorktrees(projectLayout, selectedRepos, input)
      const workReference = workRef(store, input.pass.goalId, input.pass.workId)
      const existing = await findIntegrationCommits(
        store.paths.projectRoot,
        HOPI_RELEASE_REF,
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
        } catch (error) {
          return {
            kind: 'blocked_after_boundary',
            commit: existing[0],
            reason: `Existing C1 is not materialized: ${errorMessage(error)}`,
          }
        }
        return { kind: 'already_integrated', commit: existing[0] }
      }

      await mkdir(temporaryRoot, { recursive: true })
      const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'c1-'))

      try {
        return await publisher.runExclusive(async (session) => {
          const projectRoot = store.paths.projectRoot
          const oldTarget = await git(projectRoot, ['rev-parse', HOPI_RELEASE_REF])

          const snapshot = await session.snapshotSelection(store.paths.publicationRoot, {
            paths: ['AGENTS.md', 'scripts/hopi/prepare'],
            prefixes: ['.hopi'],
          })
          const currentCandidate = publicationCandidateFromSnapshot(snapshot)
          const currentPackage = await validateGoalPackageTransition(
            currentCandidate,
            currentCandidate,
            store.paths,
            input.pass.goalId,
          )
          await validatePassSemanticGuard(store, input.pass, currentPackage, [], {
            allowReleaseHeadChange: true,
            currentAuthority: currentCandidate,
          })

          const projectFile = snapshot.files.find((file) => file.path === '.hopi/project.yml')
          if (!projectFile?.content || !projectFile.hash) {
            throw new C1IntegrationError('Current project.yml is missing from canonical authority')
          }
          const currentProject = parseProjectDocument(
            new TextDecoder().decode(projectFile.content),
            projectLayout.primaryRepoId,
          )
          validateProjectLayoutDocument(projectLayout, currentProject)

          const oldSecondaryTargets = new Map<string, string>()
          for (const repo of projectLayout.repos) {
            if (repo.primary) continue
            const actual = await git(repo.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])
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
          for (const repo of selectedRepos) {
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
            input.pass.goalId,
          )
          validateIntegrationDocumentDelta(input, currentPackage, nextPackage)

          const gitEnv = { GIT_INDEX_FILE: join(temporaryDirectory, 'primary.index') }
          const primary = requireLayoutRepo(projectLayout, projectLayout.primaryRepoId)
          if (!primary.primary) {
            throw new C1IntegrationError(`C1 primary Repo must be ${projectLayout.primaryRepoId}`)
          }
          const primarySelected = selectedRepos.some((repo) => repo.primary)
          const primarySource = primarySelected
            ? await buildSourceCandidate({
                repo: primary,
                oldTarget,
                taskWorktreePath: requireTaskWorktree(taskWorktrees, projectLayout.primaryRepoId),
                env: gitEnv,
              })
            : await readTargetIntoIndex(projectRoot, oldTarget, gitEnv)
          if (primarySource.kind === 'rejected') return primarySource

          await replaceCanonicalIndex(projectRoot, gitEnv, snapshot, writes)
          await overlayBootstrapAgents(
            projectRoot,
            gitEnv,
            snapshot,
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
            const actual = await git(repo.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])
            if (actual !== expected) {
              return {
                kind: 'blocked',
                reason: `Repo ${repoId} release changed before primary C1 (${expected} -> ${actual})`,
              }
            }
          }
          let recoveredUncertainUpdate = false
          const move = () => durableUpdateRef(projectRoot, commit, oldTarget)
          try {
            if (faultHooks.updateRef) {
              await faultHooks.updateRef({ oldTarget, commit, move })
            } else {
              await move()
            }
          } catch (error) {
            const actual = await git(projectRoot, ['rev-parse', HOPI_RELEASE_REF])
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
            await validateMaterializedCommit(projectRoot, commit)
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

function normalizeProjectLayout(store: GoalPackageStore, layout?: C1ProjectLayout) {
  const normalized: C1ProjectLayout = layout ?? {
    primaryRepoId: DEFAULT_PRIMARY_REPO_ID,
    repos: [
      {
        repoId: DEFAULT_PRIMARY_REPO_ID,
        integrationRoot: store.paths.projectRoot,
        primary: true,
      },
    ],
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

function selectedProjectRepos(layout: C1ProjectLayout, work: WorkDocument) {
  if (!isEngineeringWork(work.attributes)) {
    throw new C1IntegrationError('C1 Work must be Engineering Work')
  }
  return engineeringWorkRepoIds(work.attributes, layout.primaryRepoId).map((repoId) =>
    requireLayoutRepo(layout, repoId),
  )
}

function requireLayoutRepo(layout: C1ProjectLayout, repoId: string) {
  const repo = layout.repos.find((candidate) => candidate.repoId === repoId)
  if (!repo) throw new C1IntegrationError(`Work references unlinked Repo ${repoId}`)
  return repo
}

function resolveTaskWorktrees(
  layout: C1ProjectLayout,
  selectedRepos: readonly C1ProjectRepo[],
  input: C1IntegrationInput,
) {
  let entries: ReadonlyArray<readonly [string, string]>
  if (input.taskWorktrees) {
    entries = Object.entries(input.taskWorktrees)
  } else if (selectedRepos.length === 1) {
    const selected = selectedRepos[0]
    if (!selected) throw new C1IntegrationError('C1 Work has no selected Repo')
    entries = [[selected.repoId, input.taskWorktreePath]]
  } else {
    entries = []
  }
  const worktrees = new Map(entries)
  for (const repo of selectedRepos) {
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

async function readTargetIntoIndex(
  repoRoot: string,
  oldTarget: string,
  env: Record<string, string>,
): Promise<SourceCandidateResult> {
  await git(repoRoot, ['read-tree', oldTarget], env)
  return { kind: 'ready' }
}

async function buildSourceCandidate(input: {
  repo: C1ProjectRepo
  oldTarget: string
  taskWorktreePath: string
  env: Record<string, string>
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
  const mergeBase = await git(input.repo.integrationRoot, ['merge-base', input.oldTarget, taskHead])
  const merge = await gitResult(
    input.repo.integrationRoot,
    ['read-tree', '-m', mergeBase, input.oldTarget, taskHead],
    input.env,
  )
  if (merge.exitCode !== 0) {
    return {
      kind: 'rejected',
      reason: `Cannot construct Repo ${input.repo.repoId} source merge: ${merge.stderr || merge.stdout}`,
    }
  }
  const conflicts = await git(input.repo.integrationRoot, ['ls-files', '-u'], input.env)
  if (conflicts) {
    return {
      kind: 'rejected',
      reason: `Repo ${input.repo.repoId} task changes conflict with its current release`,
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
  input: C1IntegrationInput
  timestamp: Date
}): Promise<{ kind: 'ready'; commit: string } | { kind: 'rejected'; reason: string }> {
  const env = { GIT_INDEX_FILE: input.indexPath }
  const source = await buildSourceCandidate({
    repo: input.repo,
    oldTarget: input.oldTarget,
    taskWorktreePath: input.taskWorktreePath,
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
  input: C1IntegrationInput,
  timestamp: Date,
) {
  const workReference = workRef(store, input.pass.goalId, input.pass.workId)
  const message = [
    `hopi: component ${repoId} for ${input.pass.goalId}/${input.pass.workId}`,
    '',
    `HOPI-Project: ${store.paths.projectId}`,
    `HOPI-Goal: ${input.pass.goalId}`,
    `HOPI-Work: ${input.pass.workId}`,
    `HOPI-Repo: ${repoId}`,
    `HOPI-Producer-Run: ${workReference}/run:${input.pass.runId}`,
    '',
  ].join('\n')
  return durableGit(
    repoRoot,
    ['commit-tree', tree, '-p', oldTarget],
    {
      GIT_AUTHOR_NAME: 'HOPI Reviewer',
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
  const primaryTarget = await git(primary.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])
  if (primaryTarget !== commit) {
    throw new C1IntegrationError(`Primary release no longer points at existing C1 ${commit}`)
  }
  const primaryHead = await git(primary.integrationRoot, ['rev-parse', 'HEAD'])
  if (primaryHead !== commit) {
    await materializeCommit(primary.integrationRoot, primaryHead, commit)
  }
  await validateMaterializedCommit(primary.integrationRoot, commit)

  const nextProject = await readProjectDocumentAt(
    primary.integrationRoot,
    commit,
    layout.primaryRepoId,
  )
  validateProjectLayoutDocument(layout, nextProject)
  const parent = await git(primary.integrationRoot, ['show', '-s', '--format=%P', commit])
  const firstParent = parent.split(/\s+/)[0]
  const previousProject = firstParent
    ? await readProjectDocumentAtOrLegacy(
        primary.integrationRoot,
        firstParent,
        nextProject.projectId,
        layout.primaryRepoId,
      )
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
    await materializeSecondaryRepo(repo, expected ?? null, desired)
    await faultHooks.afterSecondaryProjection?.(repo.repoId, desired)
  }
}

export async function reconcileProjectReleaseProjection(layout: C1ProjectLayout) {
  const primary = requireLayoutRepo(layout, layout.primaryRepoId)
  const target = await git(primary.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])
  const [targetTree, indexTree] = await Promise.all([
    git(primary.integrationRoot, ['show', '-s', '--format=%T', target]),
    git(primary.integrationRoot, ['write-tree']),
  ])
  const parentLine = await git(primary.integrationRoot, ['show', '-s', '--format=%P', target])
  const parent = parentLine.split(/\s+/)[0] || null
  if (indexTree !== targetTree) {
    if (!parent) {
      throw new C1IntegrationError(
        'Primary managed index does not materialize the root release tree',
      )
    }
    const parentTree = await git(primary.integrationRoot, ['show', '-s', '--format=%T', parent])
    if (indexTree !== parentTree) {
      throw new C1IntegrationError(
        `Primary managed index ${indexTree} is neither current ${targetTree} nor parent ${parentTree}`,
      )
    }
    await materializeCommit(primary.integrationRoot, parent, target)
  }

  const projectFile = Bun.file(join(primary.integrationRoot, '.hopi', 'project.yml'))
  if (!(await projectFile.exists())) {
    throw new C1IntegrationError('Primary managed root is missing project.yml')
  }
  const currentProject = parseProjectDocument(await projectFile.text(), layout.primaryRepoId)
  validateProjectLayoutDocument(layout, currentProject)
  const previousProject = parent
    ? await readProjectDocumentAtOrLegacy(
        primary.integrationRoot,
        parent,
        currentProject.projectId,
        layout.primaryRepoId,
      )
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
    await materializeSecondaryRepo(repo, expected ?? null, desired)
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
    await materializeSecondaryRepo(repo, expected, desired)
    await faultHooks.afterSecondaryProjection?.(repo.repoId, desired)
  }
}

async function materializeSecondaryRepo(
  repo: C1ProjectRepo,
  expectedOld: string | null,
  desired: string,
) {
  const current = await git(repo.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])
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
  if (!materializedCommit) {
    throw new C1IntegrationError(
      `Repo ${repo.repoId} index tree ${indexTree} is neither the previous nor desired release`,
    )
  }
  if (current !== desired) {
    if (!expectedOld || current !== expectedOld) {
      throw new C1IntegrationError(
        `Repo ${repo.repoId} release is ${current}, expected ${expectedOld ?? desired} or ${desired}`,
      )
    }
    await durableUpdateRef(repo.integrationRoot, desired, expectedOld)
    await durabilitySync(repo.integrationRoot)
  }
  if (materializedCommit !== desired) {
    await materializeCommit(repo.integrationRoot, materializedCommit, desired)
  }
  await validateMaterializedCommit(repo.integrationRoot, desired)
}

async function readProjectDocumentAt(repoRoot: string, commit: string, primaryRepoId: string) {
  const content = await gitBytes(repoRoot, ['show', `${commit}:.hopi/project.yml`])
  return parseProjectDocument(new TextDecoder().decode(content), primaryRepoId)
}

async function readProjectDocumentAtOrLegacy(
  repoRoot: string,
  commit: string,
  projectId: string,
  primaryRepoId: string,
) {
  const result = await gitResult(repoRoot, ['show', `${commit}:.hopi/project.yml`])
  return result.exitCode === 0
    ? parseProjectDocument(result.stdout, primaryRepoId)
    : {
        version: 2 as const,
        projectId,
        primaryRepoId,
        repos: [{ repoId: primaryRepoId }],
      }
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
  mergeBase?: string,
  taskHead?: string,
) {
  if (mergeBase && taskHead) {
    const taskChanged = await gitResult(
      projectRoot,
      ['diff', '--quiet', mergeBase, taskHead, '--', 'AGENTS.md'],
      env,
    )
    if (taskChanged.exitCode !== 0 && taskChanged.exitCode !== 1) {
      throw new C1IntegrationError(taskChanged.stderr || 'Cannot inspect AGENTS.md task change')
    }
    if (taskChanged.exitCode === 1) return
  }

  const agents = snapshot.files.find((file) => file.path === 'AGENTS.md')
  if (agents?.content) {
    await addBlobToIndex(projectRoot, env, 'AGENTS.md', agents.content)
  } else {
    await git(projectRoot, ['update-index', '--force-remove', '--', 'AGENTS.md'], env, true)
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
  input: C1IntegrationInput,
  timestamp: Date,
) {
  const workReference = workRef(store, input.pass.goalId, input.pass.workId)
  const producerRun = `${workReference}/run:${input.pass.runId}`
  const message = [
    `hopi: integrate ${input.pass.goalId}/${input.pass.workId}`,
    '',
    `HOPI-Project: ${store.paths.projectId}`,
    `HOPI-Goal: ${input.pass.goalId}`,
    `HOPI-Work: ${input.pass.workId}`,
    `HOPI-Work-Ref: ${workReference}`,
    `HOPI-Producer-Run: ${producerRun}`,
    '',
  ].join('\n')
  return durableGit(
    projectRoot,
    ['commit-tree', tree, '-p', oldTarget],
    {
      GIT_AUTHOR_NAME: 'HOPI Reviewer',
      GIT_AUTHOR_EMAIL: 'hopi@local',
      GIT_COMMITTER_NAME: 'HOPI Coordinator',
      GIT_COMMITTER_EMAIL: 'hopi@local',
      GIT_AUTHOR_DATE: timestamp.toISOString(),
      GIT_COMMITTER_DATE: timestamp.toISOString(),
    },
    new TextEncoder().encode(message),
  )
}

async function durableUpdateRef(projectRoot: string, commit: string, oldTarget: string) {
  await durableGit(projectRoot, ['update-ref', HOPI_RELEASE_REF, commit, oldTarget])
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

async function validateMaterializedCommit(projectRoot: string, commit: string) {
  // Both write-tree and status may refresh and lock this worktree's index.
  const head = await git(projectRoot, ['rev-parse', 'HEAD'])
  const indexTree = await git(projectRoot, ['write-tree'])
  const status = await git(projectRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  const commitTree = await git(projectRoot, ['show', '-s', '--format=%T', commit])
  if (head !== commit || indexTree !== commitTree || status) {
    throw new C1IntegrationError(
      `Managed integration worktree does not exactly materialize C1 (head=${head}, commit=${commit}, index=${indexTree}, tree=${commitTree}, status=${status || 'clean'})`,
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
  input: C1IntegrationInput,
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
      path: store.paths.evidenceDocument(input.pass.goalId, input.evidence.attributes.id),
      expectedHash: null,
      content: renderEvidenceDocument(input.evidence),
    },
    {
      path: store.paths.workDocument(input.pass.goalId, input.completedWork.attributes.id),
      expectedHash: input.pass.context.workHash,
      content: renderWorkDocument(input.completedWork),
    },
  ] satisfies PublicationWrite[]
}

function validateIntegrationDocumentDelta(
  input: C1IntegrationInput,
  current: Awaited<ReturnType<typeof validateGoalPackageTransition>>,
  candidate: Awaited<ReturnType<typeof validateGoalPackageTransition>>,
) {
  const currentWork = current.works.get(input.pass.workId)
  const nextWork = candidate.works.get(input.pass.workId)
  const evidence = candidate.evidence.get(input.evidence.attributes.id)
  if (
    !currentWork ||
    !isEngineeringWork(currentWork.attributes) ||
    currentWork.attributes.stage !== 'review' ||
    !nextWork ||
    JSON.stringify(nextWork) !== JSON.stringify(input.completedWork) ||
    !evidence ||
    JSON.stringify(evidence) !== JSON.stringify(input.evidence)
  ) {
    throw new C1IntegrationError('C1 documents do not express the reviewed Work result')
  }
  for (const [workId, work] of current.works) {
    if (
      workId !== input.pass.workId &&
      JSON.stringify(work) !== JSON.stringify(candidate.works.get(workId))
    ) {
      throw new C1IntegrationError(`C1 unexpectedly changes Work ${workId}`)
    }
  }
}

function validateInput(store: GoalPackageStore, input: C1IntegrationInput) {
  if (
    input.pass.responsibility !== 'reviewer' ||
    input.pass.outcome.result !== 'success' ||
    input.pass.workId !== input.completedWork.attributes.id ||
    !isEngineeringWork(input.completedWork.attributes) ||
    input.completedWork.attributes.stage !== 'done' ||
    input.evidence.attributes.producerRun !==
      `${workRef(store, input.pass.goalId, input.pass.workId)}/run:${input.pass.runId}`
  ) {
    throw new C1IntegrationError('C1 requires one valid Reviewer success result')
  }
}

export async function findIntegrationCommits(
  projectRoot: string,
  target: string,
  workReference: string,
) {
  return (await listIntegrationRecords(projectRoot, target))
    .filter((record) => record.workReference === workReference)
    .map((record) => record.commit)
}

export interface IntegrationRecord {
  commit: string
  workReference: string
  producerRun: string | null
}

export async function listIntegrationRecords(projectRoot: string, target = HOPI_RELEASE_REF) {
  const bytes = await gitBytes(projectRoot, ['log', target, '--format=%H%x00%B%x00'])
  const fields = bytes.toString().split('\0')
  const records: IntegrationRecord[] = []
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const commit = fields[index]?.trim()
    const message = fields[index + 1] ?? ''
    const workReference = trailerValue(message, 'HOPI-Work-Ref')
    if (!commit || !workReference) continue
    records.push({
      commit,
      workReference,
      producerRun: trailerValue(message, 'HOPI-Producer-Run') ?? null,
    })
  }
  return records
}

async function validateIntegratedCommit(
  store: GoalPackageStore,
  input: C1IntegrationInput,
  commit: string,
) {
  const workPath = store.paths.workDocument(input.pass.goalId, input.pass.workId)
  const evidencePath = store.paths.evidenceDocument(input.pass.goalId, input.evidence.attributes.id)
  const [workBytes, evidenceBytes] = await Promise.all([
    gitBytes(store.paths.projectRoot, ['show', `${commit}:${workPath}`]),
    gitBytes(store.paths.projectRoot, ['show', `${commit}:${evidencePath}`]),
  ])
  const workSource = new TextDecoder().decode(workBytes)
  const evidenceSource = new TextDecoder().decode(evidenceBytes)
  const workMatches =
    renderWorkDocument(parseWorkDocument(workSource)) === renderWorkDocument(input.completedWork)
  const evidenceMatches =
    renderEvidenceDocument(parseEvidenceDocument(evidenceSource)) ===
    renderEvidenceDocument(input.evidence)
  if (!workMatches || !evidenceMatches) {
    throw new C1IntegrationError(
      `Existing C1 ${commit} does not match its qualified result (work=${workMatches}, evidence=${evidenceMatches})`,
    )
  }
}

function workRef(store: GoalPackageStore, goalId: string, workId: string) {
  return `project:${store.paths.projectId}/goal:${goalId}/work:${workId}`
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
  const child = Bun.spawn(['git', ...args], {
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
  const child = Bun.spawn(['git', ...args], {
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
