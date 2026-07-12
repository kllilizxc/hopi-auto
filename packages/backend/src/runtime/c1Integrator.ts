import { chmod, lstat, mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import {
  type EvidenceDocument,
  type WorkDocument,
  isEngineeringWork,
  parseEvidenceDocument,
  parseWorkDocument,
  renderEvidenceDocument,
  renderWorkDocument,
} from '../domain/canonicalDocuments'
import { validateGoalPackageTransition } from '../domain/goalPackage'
import { HOPI_RELEASE_REF } from '../domain/project'
import type { PublicationCoordinator } from '../publication/publisher'
import { publicationCandidateFromSnapshot } from '../publication/snapshotCandidate'
import type { PublicationSnapshot, PublicationWrite } from '../publication/types'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import type { ApplyPassOutcomeInput } from './passOutcomeCoordinator'
import { validatePassSemanticGuard } from './passOutcomeCoordinator'

export interface C1IntegrationInput {
  pass: ApplyPassOutcomeInput
  taskWorktreePath: string
  evidence: EvidenceDocument
  completedWork: WorkDocument
}

export type C1IntegrationResult =
  | { kind: 'integrated'; commit: string; recoveredUncertainUpdate: boolean }
  | { kind: 'already_integrated'; commit: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'blocked_after_boundary'; commit: string; reason: string }

export interface C1FaultHooks {
  updateRef?(input: {
    oldTarget: string
    commit: string
    move(): Promise<void>
  }): Promise<void>
  afterRefUpdate?(commit: string): Promise<void> | void
  beforeMaterialization?(commit: string): Promise<void> | void
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
): C1Integrator {
  const temporaryRoot = join(resolve(homeRoot), '.hopi', 'runtime', 'integration')

  return {
    async integrate(input, faultHooks = {}) {
      validateInput(store, input)
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
          await validateMaterializedCommit(store.paths.projectRoot, existing[0])
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
      const indexPath = join(temporaryDirectory, 'index')
      const gitEnv = { GIT_INDEX_FILE: indexPath }

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

          const writes = integrationDocumentWrites(store, input)
          const candidate = publicationCandidateFromSnapshot(snapshot, writes)
          const nextPackage = await validateGoalPackageTransition(
            currentCandidate,
            candidate,
            store.paths,
            input.pass.goalId,
          )
          validateIntegrationDocumentDelta(input, currentPackage, nextPackage)

          const taskHead = await git(input.taskWorktreePath, ['rev-parse', 'HEAD'])
          const taskStatus = await git(input.taskWorktreePath, [
            'status',
            '--porcelain=v1',
            '--untracked-files=all',
          ])
          if (taskStatus) {
            return { kind: 'rejected', reason: 'Task worktree is not checkpoint-clean' }
          }
          const mergeBase = await git(projectRoot, ['merge-base', oldTarget, taskHead])
          const merge = await gitResult(
            projectRoot,
            ['read-tree', '-m', mergeBase, oldTarget, taskHead],
            gitEnv,
          )
          if (merge.exitCode !== 0) {
            return {
              kind: 'rejected',
              reason: `Cannot construct C1 source merge: ${merge.stderr || merge.stdout}`,
            }
          }
          const conflicts = await git(projectRoot, ['ls-files', '-u'], gitEnv)
          if (conflicts) {
            return {
              kind: 'rejected',
              reason: 'Task changes conflict with current integration target',
            }
          }

          await replaceCanonicalIndex(projectRoot, gitEnv, snapshot, writes)
          await overlayBootstrapAgents(projectRoot, gitEnv, snapshot, mergeBase, taskHead)
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
  mergeBase: string,
  taskHead: string,
) {
  const taskChanged = await gitResult(
    projectRoot,
    ['diff', '--quiet', mergeBase, taskHead, '--', 'AGENTS.md'],
    env,
  )
  if (taskChanged.exitCode !== 0 && taskChanged.exitCode !== 1) {
    throw new C1IntegrationError(taskChanged.stderr || 'Cannot inspect AGENTS.md task change')
  }
  if (taskChanged.exitCode === 1) return

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
  const [head, indexTree, status] = await Promise.all([
    git(projectRoot, ['rev-parse', 'HEAD']),
    git(projectRoot, ['write-tree']),
    git(projectRoot, ['status', '--porcelain=v1', '--untracked-files=all']),
  ])
  const commitTree = await git(projectRoot, ['show', '-s', '--format=%T', commit])
  if (head !== commit || indexTree !== commitTree || status) {
    throw new C1IntegrationError('Managed integration worktree does not exactly materialize C1')
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

function integrationDocumentWrites(store: GoalPackageStore, input: C1IntegrationInput) {
  return [
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
