import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { resetProjectAssistantConversationEpoch } from '../assistant/assistantConversationEpoch'
import { assistantConversationScopeForEvent } from '../assistant/assistantConversationScope'
import { createAssistantWorkspacePaths } from '../domain/assistantWorkspace'
import {
  parseInboxEventDocument,
  parseWorkspaceAttentionDocument,
} from '../domain/assistantWorkspaceDocuments'
import { goalAttentionReference } from '../domain/attentionReference'
import { projectReleaseRef } from '../domain/project'
import { assertStableId } from '../domain/stableId'
import { acquireCoordinatorInstanceLock } from '../publication/instanceLock'
import { PublicationCoordinator } from '../publication/publisher'
import { createAssistantHomeStore } from '../storage/assistantHomeStore'
import { managedRepoWorktreePaths } from './managedWorktreePaths'

const GOALS_ROOT = '.hopi/docs/goals'

export interface ProjectResetRepoPlan {
  repoId: string
  repoPath: string
  taskWorktrees: string[]
  workRefs: string[]
}

export interface ProjectResetPlan {
  version: 1
  projectId: string
  homeRoot: string
  primaryIntegrationRoot: string
  releaseRef: string
  goals: {
    ids: string[]
    trackedFiles: string[]
  }
  assistant: {
    eventIds: string[]
    attentionIds: string[]
    orphanAttachments: string[]
    turnRoots: string[]
    feedEntryIds: string[]
  }
  runtime: {
    runRoots: string[]
    reflectionRunRoots: string[]
    paths: string[]
  }
  repos: ProjectResetRepoPlan[]
  blockers: string[]
}

export interface ProjectResetResult {
  kind: 'reset'
  projectId: string
  releaseCommit: string | null
  conversationStreamId: string
  manifestPath: string
  plan: ProjectResetPlan
}

export async function planProjectReset(input: {
  homeRoot: string
  projectId: string
}): Promise<ProjectResetPlan> {
  assertStableId(input.projectId, 'projectId')
  const homeRoot = resolve(input.homeRoot)
  const projectId = input.projectId
  const publisher = new PublicationCoordinator()
  const project = await createAssistantHomeStore(homeRoot, publisher).readProject(projectId)
  const workspacePaths = createAssistantWorkspacePaths()
  const goalsRoot = join(project.integrationRoot, ...GOALS_ROOT.split('/'))
  const blockers: string[] = []

  if (!(await pathExists(project.integrationRoot))) {
    blockers.push(`Primary managed integration is missing: ${project.integrationRoot}`)
  }

  const [goalDirectories, trackedGoalFiles, releaseState, assistantState, repos] =
    await Promise.all([
      directoryNames(goalsRoot),
      gitNullList(project.integrationRoot, ['ls-files', '-z', '--', GOALS_ROOT]).catch((error) => {
        blockers.push(errorMessage(error))
        return []
      }),
      inspectReleaseState(project.integrationRoot, projectReleaseRef(projectId)).catch((error) => {
        blockers.push(errorMessage(error))
        return null
      }),
      inspectAssistantState(homeRoot, projectId, workspacePaths, blockers),
      Promise.all(
        project.repos.map(async (repo) => {
          const managed = managedRepoWorktreePaths(repo.repoPath, projectId)
          const legacyRuntimeRoot = join(homeRoot, '.hopi', 'runtime', 'worktrees', projectId)
          const [worktrees, refs] = await Promise.all([
            listGitWorktrees(repo.repoPath),
            gitRefList(repo.repoPath, [
              'for-each-ref',
              '--format=%(refname)%00',
              `refs/heads/hopi/work/${projectId}/`,
            ]),
          ])
          const taskWorktrees = (
            await Promise.all(
              worktrees.map(async (path) =>
                (await isInsideCanonical(managed.work, path)) ||
                (await isInsideCanonical(legacyRuntimeRoot, path))
                  ? path
                  : null,
              ),
            )
          ).filter((path): path is string => path !== null)
          return {
            repoId: repo.repoId,
            repoPath: repo.repoPath,
            taskWorktrees: taskWorktrees.toSorted(),
            workRefs: refs.toSorted(),
          }
        }),
      ),
    ])
  const runtimeState = await inspectRuntimeState(homeRoot, projectId, assistantState.eventIds)

  if (releaseState) {
    if (releaseState.head !== releaseState.releaseHead) {
      blockers.push(
        `Primary managed integration HEAD ${releaseState.head} does not match ${projectReleaseRef(projectId)} ${releaseState.releaseHead}`,
      )
    }
    if (releaseState.symbolicRef !== projectReleaseRef(projectId)) {
      blockers.push(
        `Primary managed integration is attached to ${releaseState.symbolicRef || 'detached HEAD'}, expected ${projectReleaseRef(projectId)}`,
      )
    }
    if (releaseState.stagedFiles.some((path) => !path.startsWith(`${GOALS_ROOT}/`))) {
      blockers.push(
        `Primary managed integration has staged changes outside reset ownership: ${project.integrationRoot}`,
      )
    }
  }

  const goalIds = new Set(goalDirectories)
  for (const path of trackedGoalFiles) {
    const goalId = path.slice(`${GOALS_ROOT}/`.length).split('/')[0]
    if (goalId) goalIds.add(goalId)
  }
  const goalAttentionFeedEntryIds = (
    await Promise.all(
      [...goalIds].map(async (goalId) =>
        (
          await markdownFiles(join(goalsRoot, goalId, 'attention'))
        ).map((path) => {
          const attentionId = basename(path, '.md')
          return `completion:${goalAttentionReference(projectId, goalId, attentionId)}`
        }),
      ),
    )
  ).flat()
  assistantState.feedEntryIds = [
    ...assistantState.eventIds.map((eventId) => `event:${eventId}`),
    ...goalAttentionFeedEntryIds,
  ].toSorted()

  return {
    version: 1,
    projectId,
    homeRoot,
    primaryIntegrationRoot: project.integrationRoot,
    releaseRef: projectReleaseRef(projectId),
    goals: {
      ids: [...goalIds].toSorted(),
      trackedFiles: trackedGoalFiles.toSorted(),
    },
    assistant: assistantState,
    runtime: runtimeState,
    repos,
    blockers: [...new Set(blockers)].toSorted(),
  }
}

export async function applyProjectReset(input: {
  homeRoot: string
  projectId: string
  confirm: string
}): Promise<ProjectResetResult> {
  assertStableId(input.projectId, 'projectId')
  if (input.confirm !== input.projectId) {
    throw new ProjectResetError(
      `Reset confirmation must exactly match Project ID ${input.projectId}`,
    )
  }

  const homeRoot = resolve(input.homeRoot)
  const lock = await acquireCoordinatorInstanceLock(
    join(homeRoot, '.hopi', 'runtime', 'coordinator.lock'),
  ).catch((error) => {
    throw new ProjectResetError(
      `Project reset requires the HOPI service to be stopped: ${errorMessage(error)}`,
    )
  })

  try {
    const plan = await planProjectReset({
      homeRoot,
      projectId: input.projectId,
    })
    if (plan.blockers.length > 0) {
      throw new ProjectResetError(
        `Project reset plan is blocked:\n${plan.blockers.map((item) => `- ${item}`).join('\n')}`,
      )
    }

    const releaseCommit = await removeGoalHistoryFromRelease(plan)

    for (const repo of plan.repos) {
      for (const worktree of repo.taskWorktrees) {
        await git(repo.repoPath, ['worktree', 'remove', '--force', '--force', worktree])
      }
      for (const ref of repo.workRefs) {
        await git(repo.repoPath, ['update-ref', '-d', ref])
      }
    }

    await Promise.all([
      ...plan.assistant.eventIds.map((eventId) =>
        rm(join(homeRoot, ...createAssistantWorkspacePaths().inboxEvent(eventId).split('/')), {
          force: true,
        }),
      ),
      ...plan.assistant.attentionIds.map((attentionId) =>
        rm(join(homeRoot, ...createAssistantWorkspacePaths().attention(attentionId).split('/')), {
          force: true,
        }),
      ),
      ...plan.assistant.turnRoots.map((path) => rm(path, { recursive: true, force: true })),
      ...plan.assistant.orphanAttachments.map((path) => rm(path, { force: true })),
      ...plan.runtime.runRoots.map((path) => rm(path, { recursive: true, force: true })),
      ...plan.runtime.reflectionRunRoots.map((path) => rm(path, { recursive: true, force: true })),
      ...plan.runtime.paths.map((path) => rm(path, { recursive: true, force: true })),
    ])

    await removeEmptyAttachmentDirectories(homeRoot, plan.assistant.orphanAttachments)
    const priorRemovedFeedEntryIds = await readPriorResetFeedEntryIds(homeRoot, plan.projectId)
    const conversationEpoch = await resetProjectAssistantConversationEpoch({
      homeRoot,
      projectId: plan.projectId,
      removedFeedEntryIds: [...priorRemovedFeedEntryIds, ...plan.assistant.feedEntryIds],
    })

    const manifestPath = join(
      homeRoot,
      '.hopi',
      'runtime',
      'project-resets',
      `RS-${crypto.randomUUID()}.json`,
    )
    await mkdir(dirname(manifestPath), { recursive: true })
    await Bun.write(
      manifestPath,
      `${JSON.stringify(
        {
          version: 1,
          kind: 'project_reset',
          projectId: plan.projectId,
          appliedAt: new Date().toISOString(),
          releaseCommit,
          conversationStreamId: conversationEpoch.streamId,
          plan,
        },
        null,
        2,
      )}\n`,
    )

    return {
      kind: 'reset',
      projectId: plan.projectId,
      releaseCommit,
      conversationStreamId: conversationEpoch.streamId,
      manifestPath,
      plan,
    }
  } finally {
    await lock.release()
  }
}

export class ProjectResetError extends Error {}

async function inspectReleaseState(integrationRoot: string, releaseRef: string) {
  const [head, releaseHead, symbolicRef, staged] = await Promise.all([
    git(integrationRoot, ['rev-parse', 'HEAD']),
    git(integrationRoot, ['rev-parse', releaseRef]),
    git(integrationRoot, ['symbolic-ref', '-q', 'HEAD'], true),
    git(integrationRoot, ['diff', '--cached', '--name-only', '-z']),
  ])
  return {
    head: head.stdout,
    releaseHead: releaseHead.stdout,
    symbolicRef: symbolicRef.exitCode === 0 ? symbolicRef.stdout : null,
    stagedFiles: staged.rawStdout.split('\0').filter(Boolean),
  }
}

async function inspectAssistantState(
  homeRoot: string,
  projectId: string,
  paths: ReturnType<typeof createAssistantWorkspacePaths>,
  blockers: string[],
) {
  const inboxRoot = join(homeRoot, ...paths.inboxRoot.split('/'))
  const attentionRoot = join(homeRoot, ...paths.attentionRoot.split('/'))
  const events = await Promise.all(
    (await markdownFiles(inboxRoot)).map(async (path) => ({
      path,
      event: parseInboxEventDocument(await Bun.file(path).text()),
    })),
  )
  const removedEvents = events.filter(
    ({ event }) =>
      assistantConversationScopeForEvent(event).kind === 'project' &&
      event.attributes.context?.projectId === projectId,
  )
  const removedEventIds = new Set(removedEvents.map(({ event }) => event.attributes.id))
  const retainedAttachments = new Set(
    events
      .filter(({ event }) => !removedEventIds.has(event.attributes.id))
      .flatMap(({ event }) => event.attributes.attachments),
  )
  const orphanAttachments = [
    ...new Set(
      removedEvents
        .flatMap(({ event }) => event.attributes.attachments)
        .filter((reference) => !retainedAttachments.has(reference))
        .map((reference) => assistantAttachmentPath(homeRoot, paths.attachmentRoot, reference))
        .filter((path): path is string => path !== null),
    ),
  ].toSorted()

  const attentionIds: string[] = []
  for (const path of await markdownFiles(attentionRoot)) {
    const attention = parseWorkspaceAttentionDocument(await Bun.file(path).text())
    const projectIds = workspaceAttentionProjectIds(attention.attributes.refs)
    if (!projectIds.has(projectId)) continue
    if (projectIds.size > 1) {
      blockers.push(
        `Workspace Attention ${attention.attributes.id} refers to multiple Projects: ${[...projectIds].toSorted().join(', ')}`,
      )
      continue
    }
    attentionIds.push(attention.attributes.id)
  }

  const eventIds = [...removedEventIds].toSorted()
  return {
    eventIds,
    attentionIds: attentionIds.toSorted(),
    orphanAttachments,
    turnRoots: eventIds.map((eventId) =>
      join(homeRoot, '.hopi', 'runtime', 'assistant', 'turns', eventId),
    ),
    feedEntryIds: [] as string[],
  }
}

async function inspectRuntimeState(
  homeRoot: string,
  projectId: string,
  removedEventIds: readonly string[],
) {
  const runtimeRoot = join(homeRoot, '.hopi', 'runtime')
  const assistantRoot = join(runtimeRoot, 'assistant')
  const runRoots = await matchingManifestRoots(
    join(runtimeRoot, 'runs'),
    'attempt.json',
    (manifest) => manifest.projectId === projectId,
  )
  const reflectionRunRoots = await matchingManifestRoots(
    join(assistantRoot, 'wakes', 'runs'),
    'reflection.json',
    (manifest) =>
      (isRecord(manifest.scope) &&
        manifest.scope.kind === 'project' &&
        manifest.scope.projectId === projectId) ||
      (typeof manifest.handoffEventId === 'string' &&
        removedEventIds.includes(manifest.handoffEventId)),
  )
  const paths = [
    join(runtimeRoot, 'responsibility-sessions', projectId),
    join(runtimeRoot, 'worktrees', projectId),
    join(runtimeRoot, 'preview', projectId),
    join(assistantRoot, 'sessions', 'projects', `${projectId}.json`),
    join(assistantRoot, 'workspace', 'projects', encodeURIComponent(projectId)),
    join(assistantRoot, 'wakes', 'cursors', `project-${projectId}.json`),
  ]
  return {
    runRoots: runRoots.toSorted(),
    reflectionRunRoots: reflectionRunRoots.toSorted(),
    paths: (await existingPaths(paths)).toSorted(),
  }
}

async function removeGoalHistoryFromRelease(plan: ProjectResetPlan) {
  const goalsRoot = join(plan.primaryIntegrationRoot, ...GOALS_ROOT.split('/'))
  await rm(goalsRoot, { recursive: true, force: true })
  if (plan.goals.trackedFiles.length === 0) return null

  const parent = (await git(plan.primaryIntegrationRoot, ['rev-parse', plan.releaseRef])).stdout
  await git(plan.primaryIntegrationRoot, ['add', '-A', '--', GOALS_ROOT])
  const tree = (await git(plan.primaryIntegrationRoot, ['write-tree'])).stdout
  const message = `chore(hopi): reset ${plan.projectId} goals\n\nGeneration-Mode: AI-Pure\n`
  const commit = (
    await git(plan.primaryIntegrationRoot, ['commit-tree', tree, '-p', parent], false, message)
  ).stdout
  const changedPaths = await gitNullList(plan.primaryIntegrationRoot, [
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    '-z',
    parent,
    commit,
  ])
  if (changedPaths.some((path) => !path.startsWith(`${GOALS_ROOT}/`))) {
    throw new ProjectResetError(
      `Project reset commit changed source outside ${GOALS_ROOT}: ${changedPaths.join(', ')}`,
    )
  }
  await git(plan.primaryIntegrationRoot, ['update-ref', plan.releaseRef, commit, parent])
  const staged = await git(plan.primaryIntegrationRoot, ['diff', '--cached', '--quiet'], true)
  if (staged.exitCode !== 0) {
    throw new ProjectResetError(
      `Project release index did not converge after Goal deletion: ${plan.primaryIntegrationRoot}`,
    )
  }
  return commit
}

async function matchingManifestRoots(
  root: string,
  fileName: string,
  matches: (manifest: Record<string, unknown>) => boolean,
) {
  if (!(await pathExists(root))) return []
  const result: string[] = []
  const glob = new Bun.Glob(`**/${fileName}`)
  for await (const path of glob.scan({ cwd: root, onlyFiles: true })) {
    const absolute = join(root, path)
    const manifest = await Bun.file(absolute)
      .json()
      .catch(() => null)
    if (isRecord(manifest) && matches(manifest)) result.push(dirname(absolute))
  }
  return result
}

async function readPriorResetFeedEntryIds(homeRoot: string, projectId: string) {
  const root = join(homeRoot, '.hopi', 'runtime', 'project-resets')
  if (!(await pathExists(root))) return []
  const ids = new Set<string>()
  const glob = new Bun.Glob('*.json')
  for await (const fileName of glob.scan({ cwd: root, onlyFiles: true })) {
    const manifest = await Bun.file(join(root, fileName))
      .json()
      .catch(() => null)
    if (!isRecord(manifest) || manifest.projectId !== projectId || !isRecord(manifest.plan)) {
      continue
    }
    const assistant = isRecord(manifest.plan.assistant) ? manifest.plan.assistant : null
    if (!assistant) continue
    if (Array.isArray(assistant.feedEntryIds)) {
      for (const id of assistant.feedEntryIds) {
        if (typeof id === 'string' && id) ids.add(id)
      }
      continue
    }
    if (Array.isArray(assistant.eventIds)) {
      for (const eventId of assistant.eventIds) {
        if (typeof eventId === 'string' && eventId) ids.add(`event:${eventId}`)
      }
    }
  }
  return [...ids].toSorted()
}

async function listGitWorktrees(repoPath: string) {
  const output = await gitNullList(repoPath, ['worktree', 'list', '--porcelain', '-z'])
  return output.filter((token) => token.startsWith('worktree ')).map((token) => token.slice(9))
}

async function gitNullList(cwd: string, args: string[]) {
  const result = await git(cwd, args)
  return result.rawStdout.split('\0').filter(Boolean)
}

async function gitRefList(cwd: string, args: string[]) {
  return (await gitNullList(cwd, args)).map((value) => value.trim()).filter(Boolean)
}

async function git(
  cwd: string,
  args: string[],
  allowFailure = false,
  input?: string,
): Promise<{
  stdout: string
  stderr: string
  rawStdout: string
  exitCode: number
}> {
  const child = Bun.spawn(['git', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [rawStdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const result = {
    stdout: rawStdout.trim(),
    stderr: stderr.trim(),
    rawStdout,
    exitCode,
  }
  if (exitCode !== 0 && !allowFailure) {
    throw new ProjectResetError(
      `git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`,
    )
  }
  return result
}

async function markdownFiles(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(root, entry.name))
    .toSorted()
}

async function directoryNames(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
}

async function existingPaths(paths: string[]) {
  const entries = await Promise.all(
    paths.map(async (path) => ((await pathExists(path)) ? path : null)),
  )
  return entries.filter((path): path is string => path !== null)
}

async function pathExists(path: string) {
  return stat(path)
    .then(() => true)
    .catch(() => false)
}

function workspaceAttentionProjectIds(refs: readonly string[]) {
  const projectIds = new Set<string>()
  for (const reference of refs) {
    if (!reference.startsWith('project:')) continue
    const projectId = reference.slice('project:'.length).split('/')[0]
    if (projectId) projectIds.add(projectId)
  }
  return projectIds
}

function assistantAttachmentPath(homeRoot: string, attachmentRoot: string, reference: string) {
  const prefix = `${attachmentRoot}/`
  if (!reference.startsWith(prefix)) return null
  const root = resolve(homeRoot, ...attachmentRoot.split('/'))
  const path = resolve(homeRoot, ...reference.split('/'))
  if (!isInside(root, path)) {
    throw new ProjectResetError(`Assistant attachment escapes its storage root: ${reference}`)
  }
  return path
}

async function removeEmptyAttachmentDirectories(homeRoot: string, paths: readonly string[]) {
  const root = resolve(homeRoot, '.hopi', 'docs', 'assistant', 'attachments')
  for (const path of paths) {
    let directory = dirname(path)
    while (isInside(root, directory)) {
      const entries = await readdir(directory).catch(() => null)
      if (!entries || entries.length > 0) break
      await rm(directory, { recursive: true, force: true })
      directory = dirname(directory)
    }
  }
}

function isInside(root: string, path: string) {
  const candidate = relative(resolve(root), resolve(path))
  return candidate !== '' && !candidate.startsWith('..') && !isAbsolute(candidate)
}

async function isInsideCanonical(root: string, path: string) {
  const [canonicalRoot, canonicalPath] = await Promise.all([
    realpath(root).catch(() => resolve(root)),
    realpath(path).catch(() => resolve(path)),
  ])
  return isInside(canonicalRoot, canonicalPath)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
