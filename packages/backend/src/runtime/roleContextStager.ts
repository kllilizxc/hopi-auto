import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import type { TransportContextBundle } from '../agent/vendorTransport'
import {
  engineeringWorkRepoIds,
  isEngineeringWork,
  isWorkTerminal,
  parseAttentionDocument,
  parseEvidenceDocument,
  parseGoalDocument,
  parseInputDocument,
  parseWorkDocument,
} from '../domain/canonicalDocuments'
import { DEFAULT_PRIMARY_REPO_ID, HOPI_RELEASE_REF } from '../domain/project'
import type { PublicationCoordinator } from '../publication/publisher'
import type { PublicationSnapshot, PublicationSnapshotFile } from '../publication/types'
import { createGoalPackagePaths } from '../storage/goalPackagePaths'

export const RESPONSIBILITIES = ['planner', 'generator', 'reviewer'] as const
export type Responsibility = (typeof RESPONSIBILITIES)[number]

export interface PrepareRoleContextInput {
  projectRoot: string
  projectId: string
  goalId: string
  workId: string
  runId: string
  responsibility: Responsibility
  primaryRepoId?: string
  repoRoots?: readonly RoleRepoRoot[]
}

export interface RoleRepoRoot {
  repoId: string
  path: string
  primary: boolean
}

export interface RoleContextBundle extends TransportContextBundle {
  runRoot: string
  contextRoot: string
  proposalRoot: string
  resultFile: string
  releaseHead: string
  goalHash: string
  workHash: string
  authorityFiles: readonly Pick<PublicationSnapshotFile, 'path' | 'hash'>[]
  guardFiles: Readonly<Record<string, string | null>>
  guardPrefixes: readonly string[]
  bootstrapSourceRoot?: string
  repoRoots: readonly RoleRepoRoot[]
  reposFile: string
}

export interface RoleContextStager {
  prepare(input: PrepareRoleContextInput): Promise<RoleContextBundle>
}

export class RoleContextStagingError extends Error {}

export function createRoleContextStager(
  homeRoot: string,
  publisher: PublicationCoordinator,
): RoleContextStager {
  const absoluteHomeRoot = resolve(homeRoot)

  return {
    async prepare(input) {
      assertStableId(input.projectId, 'projectId')
      assertStableId(input.goalId, 'goalId')
      assertStableId(input.workId, 'workId')
      assertStableId(input.runId, 'runId')

      const projectRoot = resolve(input.projectRoot)
      const primaryRepoId = input.primaryRepoId ?? DEFAULT_PRIMARY_REPO_ID
      assertStableId(primaryRepoId, 'primaryRepoId')
      const repoRoots = normalizeRepoRoots(
        input.repoRoots ?? [{ repoId: primaryRepoId, path: projectRoot, primary: true }],
        primaryRepoId,
      )
      const paths = createGoalPackagePaths(projectRoot, input.projectId)
      const runRoot = join(
        absoluteHomeRoot,
        '.hopi',
        'runtime',
        'runs',
        input.projectId,
        input.goalId,
        input.workId,
        input.runId,
      )
      const contextRoot = join(runRoot, 'context')
      const authorityRoot = join(contextRoot, 'authority')
      const proposalRoot = join(runRoot, 'proposal')
      const resultFile = join(runRoot, 'result.json')
      const contextFile = join(runRoot, 'context.md')
      const promptFile = join(runRoot, 'prompt.md')
      const reposFile = join(runRoot, 'repos.json')
      const browserHarnessArtifactDir = join(runRoot, 'browser-harness')
      const runtimeScratchDir = join(runRoot, 'scratch')

      await rm(runRoot, { recursive: true, force: true })
      await mkdir(authorityRoot, { recursive: true })
      await mkdir(proposalRoot, { recursive: true })
      await mkdir(runtimeScratchDir, { recursive: true })

      const snapshot = await stableAuthoritySnapshot(publisher, paths.publicationRoot, {
        paths: [
          'AGENTS.md',
          'scripts/hopi/prepare',
          '.hopi/project.yml',
          '.hopi/preference.md',
          '.hopi/docs/index.md',
          '.hopi/docs/repos.md',
          '.hopi/docs/tech-debt.md',
        ],
        prefixes: [paths.goalRoot(input.goalId)],
      })
      const releaseHead = snapshot.releaseHead
      const goalPath = paths.goalDocument(input.goalId)
      const workPath = paths.workDocument(input.goalId, input.workId)
      const goalFile = requiredSnapshotFile(snapshot.files, goalPath)
      const workFile = requiredSnapshotFile(snapshot.files, workPath)
      const parsedGoal = parseGoalDocument(decode(goalFile.content))
      const parsedWork = parseWorkDocument(decode(workFile.content))
      if (parsedWork.attributes.id !== input.workId) {
        throw new RoleContextStagingError(
          `Work path ${workPath} owns ${parsedWork.attributes.id}, expected ${input.workId}`,
        )
      }
      if (input.responsibility !== 'planner') {
        if (!isEngineeringWork(parsedWork.attributes)) {
          throw new RoleContextStagingError(
            `${input.responsibility} requires Engineering Work ${input.workId}`,
          )
        }
        const expectedRepoIds = engineeringWorkRepoIds(parsedWork.attributes, primaryRepoId)
        const actualRepoIds = repoRoots.map((repo) => repo.repoId)
        if (
          JSON.stringify([...expectedRepoIds].sort()) !== JSON.stringify([...actualRepoIds].sort())
        ) {
          throw new RoleContextStagingError(
            `Work Repo workspace disagrees with staged roots (${expectedRepoIds.join(', ')} vs ${actualRepoIds.join(', ')})`,
          )
        }
      }

      const referencedImages = collectReferencedImages(parsedWork.body, paths, input.goalId)
      for (const imagePath of referencedImages) requiredSnapshotFile(snapshot.files, imagePath)
      const guardFiles = selectGuardFiles(input, snapshot.files, paths, parsedWork)
      const guardPrefixes =
        input.responsibility === 'planner'
          ? [paths.goalRoot(input.goalId)]
          : [paths.designRoot(input.goalId)]
      const authorityFiles =
        input.responsibility === 'planner'
          ? selectPlannerAuthorityFiles(input, snapshot.files, paths, parsedWork)
          : snapshot.files.filter((file) => Object.hasOwn(guardFiles, file.path))
      const assignment = createRunAssignment(input, paths, parsedGoal, parsedWork, authorityFiles)

      for (const file of authorityFiles) {
        if (file.content === null) continue
        await writeSnapshotFile(authorityRoot, file.path, file.content)
      }
      const imageFiles = [...referencedImages].map((imagePath) =>
        join(authorityRoot, ...imagePath.split('/')),
      )

      const agentsFile = snapshot.files.find((file) => file.path === 'AGENTS.md')
      const prepareFile = snapshot.files.find((file) => file.path === 'scripts/hopi/prepare')
      let bootstrapSourceRoot: string | undefined
      if (input.responsibility === 'planner' && agentsFile?.content === null) {
        bootstrapSourceRoot = join(contextRoot, 'source')
        await stageTrackedSource(projectRoot, releaseHead, bootstrapSourceRoot)
      }

      await Bun.write(
        reposFile,
        `${JSON.stringify(
          {
            primaryRepoId,
            repos: Object.fromEntries(repoRoots.map((repo) => [repo.repoId, repo.path])),
          },
          null,
          2,
        )}\n`,
      )

      await Bun.write(
        contextFile,
        renderContextManifest(input, {
          authorityRoot,
          proposalRoot,
          runtimeScratchDir,
          releaseHead,
          snapshot: authorityFiles,
          evidencePaths: parsedWork.attributes.evidenceRefs
            .map((evidenceId) => paths.evidenceDocument(input.goalId, evidenceId))
            .filter((path) => authorityFiles.some((file) => file.path === path)),
          bootstrapSourceRoot,
          imagePaths: [...referencedImages],
          primaryRepoId,
          repoRoots,
          reposFile,
        }),
      )
      await Bun.write(
        promptFile,
        renderResponsibilityPrompt(
          input,
          {
            contextFile,
            authorityRoot,
            proposalRoot,
            resultFile,
            bootstrapSourceRoot,
            prepareMissing: prepareFile?.content === null,
            attentionRoot: paths.attentionRoot(input.goalId),
            primaryRepoId,
            repoRoots,
            reposFile,
          },
          assignment,
        ),
      )
      await Bun.write(resultFile, '')

      return {
        runtimeScratchDir,
        runRoot,
        contextRoot,
        proposalRoot,
        resultFile,
        releaseHead,
        goalHash: requiredHash(goalFile, goalPath),
        workHash: requiredHash(workFile, workPath),
        authorityFiles: authorityFiles.map(({ path, hash }) => ({
          path,
          hash,
        })),
        guardFiles,
        guardPrefixes,
        bootstrapSourceRoot,
        repoRoots,
        reposFile,
        goalFile: join(authorityRoot, ...goalPath.split('/')),
        designFile: join(authorityRoot, ...paths.designIndex(input.goalId).split('/')),
        extraWritableRoots: [runRoot, ...repoRoots.map((repo) => repo.path)],
        contextFile,
        promptFile,
        outcomeFile: resultFile,
        canonicalOutcomeFile: resultFile,
        browserHarnessDir: 'scripts/hopi/browser-harness',
        browserHarnessArtifactDir,
        canonicalBrowserHarnessArtifactDir: browserHarnessArtifactDir,
        imageFiles,
      }
    },
  }
}

function normalizeRepoRoots(repoRoots: readonly RoleRepoRoot[], primaryRepoId: string) {
  const normalized = repoRoots.map((repo) => {
    assertStableId(repo.repoId, 'repoId')
    return { ...repo, path: resolve(repo.path) }
  })
  if (normalized.length === 0) {
    throw new RoleContextStagingError('Responsibility Repo workspace must not be empty')
  }
  if (new Set(normalized.map((repo) => repo.repoId)).size !== normalized.length) {
    throw new RoleContextStagingError('Responsibility Repo workspace contains duplicate Repo IDs')
  }
  const primary = normalized.filter((repo) => repo.primary)
  if (primary.length > 1 || (primary[0] && primary[0].repoId !== primaryRepoId)) {
    throw new RoleContextStagingError(`Responsibility workspace primary must be ${primaryRepoId}`)
  }
  return normalized
}

function collectReferencedImages(
  body: string,
  paths: ReturnType<typeof createGoalPackagePaths>,
  goalId: string,
) {
  const prefix = paths.assetsRoot(goalId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `${prefix}/[a-f0-9]{64}/[A-Za-z0-9][A-Za-z0-9._-]*\\.(?:png|jpg|webp|gif)`,
    'g',
  )
  return new Set(body.match(pattern) ?? [])
}

function selectGuardFiles(
  input: PrepareRoleContextInput,
  files: readonly PublicationSnapshotFile[],
  paths: ReturnType<typeof createGoalPackagePaths>,
  work: ReturnType<typeof parseWorkDocument>,
) {
  if (input.responsibility === 'planner') {
    return Object.freeze(Object.fromEntries(files.map((file) => [file.path, file.hash])))
  }

  const goalRoot = paths.goalRoot(input.goalId)
  const goalTarget = `project:${input.projectId}/goal:${input.goalId}`
  const workTarget = `${goalTarget}/work:${input.workId}`
  const referencedEvidence = new Set(
    work.attributes.evidenceRefs.map((evidenceId) =>
      paths.evidenceDocument(input.goalId, evidenceId),
    ),
  )
  const dependencyWork = new Set(
    work.attributes.dependsOn.map((workId) => paths.workDocument(input.goalId, workId)),
  )
  const referencedImages = collectReferencedImages(work.body, paths, input.goalId)
  const latestResolvedAttention = latestResolvedAttentionForTarget(
    files,
    `${paths.attentionRoot(input.goalId)}/`,
    workTarget,
  )
  const latestResolutionInput = latestResolvedAttention?.document.attributes.resolutionInput
  const selected = files.filter((file) => {
    if (file.path === '.hopi/project.yml') return false
    if (!file.path.startsWith(`${goalRoot}/`)) return true
    if (file.path === paths.goalDocument(input.goalId)) return true
    if (file.path.startsWith(`${paths.designRoot(input.goalId)}/`)) return true
    if (referencedImages.has(file.path)) return true
    if (file.path === latestResolvedAttention?.path || file.path === latestResolutionInput)
      return true
    if (file.path === paths.workDocument(input.goalId, input.workId)) return true
    if (dependencyWork.has(file.path) || referencedEvidence.has(file.path)) return true
    if (file.path.startsWith(`${paths.workRoot(input.goalId)}/`) && file.content) {
      const candidate = parseWorkDocument(decode(file.content)).attributes
      return candidate.kind === 'planning' && !isWorkTerminal(candidate)
    }
    if (file.path.startsWith(`${paths.attentionRoot(input.goalId)}/`) && file.content) {
      const attention = parseAttentionDocument(decode(file.content)).attributes
      return (
        attention.resolvedAt === null &&
        (attention.target === goalTarget || attention.target === workTarget)
      )
    }
    return false
  })
  return Object.freeze(Object.fromEntries(selected.map((file) => [file.path, file.hash])))
}

function selectPlannerAuthorityFiles(
  input: PrepareRoleContextInput,
  files: readonly PublicationSnapshotFile[],
  paths: ReturnType<typeof createGoalPackagePaths>,
  owningWork: ReturnType<typeof parseWorkDocument>,
) {
  const goalRoot = paths.goalRoot(input.goalId)
  const workRoot = `${paths.workRoot(input.goalId)}/`
  const inputRoot = `${paths.inputsRoot(input.goalId)}/`
  const attentionRoot = `${paths.attentionRoot(input.goalId)}/`
  const evidenceRoot = `${paths.evidenceRoot(input.goalId)}/`
  const selectedWorkPaths = new Set([paths.workDocument(input.goalId, input.workId)])
  const selectedEvidencePaths = new Set<string>()
  const referencedImages = collectReferencedImages(owningWork.body, paths, input.goalId)
  const owningWorkTarget = `project:${input.projectId}/goal:${input.goalId}/work:${input.workId}`
  const latestResolvedAttention = latestResolvedAttentionForTarget(
    files,
    attentionRoot,
    owningWorkTarget,
  )

  for (const file of files) {
    if (!file.content || !file.path.startsWith(workRoot)) continue
    const work = parseWorkDocument(decode(file.content))
    if (work.attributes.kind !== 'engineering' && work.attributes.id !== input.workId) continue
    selectedWorkPaths.add(file.path)
    const latestEvidenceId = work.attributes.evidenceRefs.at(-1)
    if (latestEvidenceId) {
      selectedEvidencePaths.add(paths.evidenceDocument(input.goalId, latestEvidenceId))
    }
  }

  const acceptedInputs = new Set(
    files.flatMap((file) => {
      if (!file.content || !file.path.startsWith(inputRoot)) return []
      const document = parseInputDocument(decode(file.content))
      return owningWork.body.includes(file.path) ||
        owningWork.body.includes(document.attributes.sourceEventId)
        ? [file.path]
        : []
    }),
  )
  if (latestResolvedAttention?.document.attributes.resolutionInput) {
    acceptedInputs.add(latestResolvedAttention.document.attributes.resolutionInput)
  }

  return files.filter((file) => {
    if (!file.path.startsWith(`${goalRoot}/`)) return true
    if (file.path === paths.goalDocument(input.goalId)) return true
    if (file.path.startsWith(`${paths.designRoot(input.goalId)}/`)) return true
    if (referencedImages.has(file.path)) return true
    if (selectedWorkPaths.has(file.path)) return true
    if (acceptedInputs.has(file.path)) return true
    if (selectedEvidencePaths.has(file.path)) return true
    if (file.path === latestResolvedAttention?.path) return true
    if (file.path.startsWith(attentionRoot) && file.content) {
      return parseAttentionDocument(decode(file.content)).attributes.resolvedAt === null
    }
    if (file.path.startsWith(evidenceRoot) || file.path.startsWith(inputRoot)) return false
    return false
  })
}

function latestResolvedAttentionForTarget(
  files: readonly PublicationSnapshotFile[],
  attentionRoot: string,
  target: string,
) {
  return files
    .flatMap((file) => {
      if (!file.content || !file.path.startsWith(attentionRoot)) return []
      const document = parseAttentionDocument(decode(file.content))
      return document.attributes.target === target && document.attributes.resolvedAt !== null
        ? [{ path: file.path, document }]
        : []
    })
    .sort((left, right) =>
      (right.document.attributes.resolvedAt ?? '').localeCompare(
        left.document.attributes.resolvedAt ?? '',
      ),
    )[0]
}

interface RunAssignment {
  goal: {
    path: string
    hash: string
    title: string
    contractRevision: number
    body: string
  }
  work: {
    path: string
    hash: string
    title: string
    kind: string
    stage: string
    body: string
  }
  acceptedInputs: Array<{ path: string; body: string }>
  latestEvidence: { path: string; body: string } | null
}

function createRunAssignment(
  input: PrepareRoleContextInput,
  paths: ReturnType<typeof createGoalPackagePaths>,
  goal: ReturnType<typeof parseGoalDocument>,
  work: ReturnType<typeof parseWorkDocument>,
  authorityFiles: readonly PublicationSnapshotFile[],
): RunAssignment {
  const byPath = new Map(authorityFiles.map((file) => [file.path, file]))
  const goalPath = paths.goalDocument(input.goalId)
  const workPath = paths.workDocument(input.goalId, input.workId)
  const acceptedInputs =
    input.responsibility === 'planner'
      ? authorityFiles.flatMap((file) => {
          if (!file.content || !file.path.startsWith(`${paths.inputsRoot(input.goalId)}/`)) {
            return []
          }
          const document = parseInputDocument(decode(file.content))
          const referencedByResolution = authorityFiles.some((candidate) => {
            if (
              !candidate.content ||
              !candidate.path.startsWith(`${paths.attentionRoot(input.goalId)}/`)
            ) {
              return false
            }
            return (
              parseAttentionDocument(decode(candidate.content)).attributes.resolutionInput ===
              file.path
            )
          })
          return work.body.includes(file.path) ||
            work.body.includes(document.attributes.sourceEventId) ||
            referencedByResolution
            ? [{ path: file.path, body: document.body }]
            : []
        })
      : []
  const latestEvidenceId = work.attributes.evidenceRefs.at(-1)
  const latestEvidencePath = latestEvidenceId
    ? paths.evidenceDocument(input.goalId, latestEvidenceId)
    : null
  const latestEvidenceFile = latestEvidencePath ? byPath.get(latestEvidencePath) : null
  const latestEvidence =
    latestEvidencePath && latestEvidenceFile?.content
      ? {
          path: latestEvidencePath,
          body: parseEvidenceDocument(decode(latestEvidenceFile.content)).body,
        }
      : null

  return {
    goal: {
      path: goalPath,
      hash: requiredHash(requiredSnapshotFile(authorityFiles, goalPath), goalPath),
      title: goal.attributes.title,
      contractRevision: goal.attributes.contractRevision,
      body: goal.body,
    },
    work: {
      path: workPath,
      hash: requiredHash(requiredSnapshotFile(authorityFiles, workPath), workPath),
      title: work.attributes.title,
      kind: work.attributes.kind,
      stage: work.attributes.stage,
      body: work.body,
    },
    acceptedInputs,
    latestEvidence,
  }
}

async function stableAuthoritySnapshot(
  publisher: PublicationCoordinator,
  root: { id: string; path: string },
  selection: { paths: string[]; prefixes: string[] },
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await gitOutput(root.path, ['rev-parse', HOPI_RELEASE_REF])
    const snapshot = await publisher.snapshotSelection(root, selection)
    const after = await gitOutput(root.path, ['rev-parse', HOPI_RELEASE_REF])
    if (before === after) {
      return { ...snapshot, releaseHead: before }
    }
  }
  throw new RoleContextStagingError('Integration target changed repeatedly while staging context')
}

function requiredSnapshotFile(files: readonly PublicationSnapshotFile[], path: string) {
  const file = files.find((candidate) => candidate.path === path)
  if (!file?.content || !file.hash) {
    throw new RoleContextStagingError(`Required canonical context is missing: ${path}`)
  }
  return file as PublicationSnapshotFile & {
    content: Uint8Array
    hash: string
  }
}

function requiredHash(file: PublicationSnapshotFile, path: string) {
  if (!file.hash) {
    throw new RoleContextStagingError(`Required canonical context has no hash: ${path}`)
  }
  return file.hash
}

async function writeSnapshotFile(root: string, relativePath: string, content: Uint8Array) {
  const path = safeJoin(root, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, content)
}

async function stageTrackedSource(projectRoot: string, releaseHead: string, destination: string) {
  await mkdir(destination, { recursive: true })
  const tracked = await gitOutput(projectRoot, ['ls-tree', '-r', '-z', '--name-only', releaseHead])
  const paths = tracked.split('\0').filter(Boolean)

  for (const relativePath of paths) {
    if (relativePath === '.hopi' || relativePath.startsWith('.hopi/')) continue
    const normalized = normalizeGitPath(relativePath)
    const target = safeJoin(destination, normalized)
    await mkdir(dirname(target), { recursive: true })
    await Bun.write(target, await gitBytes(projectRoot, ['show', `${releaseHead}:${normalized}`]))
    await chmod(target, 0o444)
  }

  await Bun.write(
    join(destination, '.hopi-source-manifest.txt'),
    [`releaseHead: ${releaseHead}`, `trackedFiles: ${paths.length}`, ''].join('\n'),
  )
}

function renderContextManifest(
  input: PrepareRoleContextInput,
  context: {
    authorityRoot: string
    proposalRoot: string
    runtimeScratchDir: string
    releaseHead: string
    snapshot: PublicationSnapshot['files']
    evidencePaths: readonly string[]
    bootstrapSourceRoot?: string
    imagePaths: readonly string[]
    primaryRepoId: string
    repoRoots: readonly RoleRepoRoot[]
    reposFile: string
  },
) {
  return [
    '# HOPI Responsibility Context',
    '',
    `- Project: ${input.projectId}`,
    `- Goal: ${input.goalId}`,
    `- Work: ${input.workId}`,
    `- Run: ${input.runId}`,
    `- Responsibility: ${input.responsibility}`,
    `- Integration target snapshot: ${context.releaseHead}`,
    `- Immutable authority root: ${context.authorityRoot}`,
    `- Writable proposal root: ${context.proposalRoot}`,
    `- Disposable runtime scratch: ${context.runtimeScratchDir}`,
    `- Project primary Repo: ${context.primaryRepoId}`,
    `- Repo workspace manifest: ${context.reposFile}`,
    ...context.repoRoots.map(
      (repo) => `- Repo ${repo.repoId}${repo.primary ? ' (primary)' : ''}: ${repo.path}`,
    ),
    ...(context.bootstrapSourceRoot
      ? [`- Read-only bootstrap source snapshot: ${context.bootstrapSourceRoot}`]
      : []),
    '',
    '## Authority Files',
    '',
    ...context.snapshot.map((file) => `- ${file.path}: ${file.hash ?? 'missing at snapshot time'}`),
    ...(context.imagePaths.length > 0
      ? ['', '## Attached Reference Images', '', ...context.imagePaths.map((path) => `- ${path}`)]
      : []),
    ...(context.evidencePaths.length > 0
      ? [
          '',
          '## Owning Work Evidence (oldest to newest)',
          '',
          ...context.evidencePaths.map((path, index) =>
            index === context.evidencePaths.length - 1 ? `- ${path} (latest)` : `- ${path}`,
          ),
        ]
      : []),
    '',
    'Files under the authority root are immutable inputs. The proposal is never canonical until the Coordinator validates and publishes it.',
    'The proposal root is an initially empty sparse overlay. Copy in only a document you intend to add or replace; an absent authority path means unchanged, never deleted.',
    '',
  ].join('\n')
}

function renderResponsibilityPrompt(
  input: PrepareRoleContextInput,
  paths: {
    contextFile: string
    authorityRoot: string
    proposalRoot: string
    resultFile: string
    bootstrapSourceRoot?: string
    prepareMissing: boolean
    attentionRoot: string
    primaryRepoId: string
    repoRoots: readonly RoleRepoRoot[]
    reposFile: string
  },
  assignment: RunAssignment,
) {
  const common = [
    '## Canonical Boundary',
    '',
    `Audit manifest: ${paths.contextFile}`,
    `Treat ${paths.authorityRoot} as immutable canonical authority.`,
    `Write control-document proposals only beneath ${paths.proposalRoot}.`,
    'The proposal starts empty and is a sparse overlay: write only added or replaced documents. Read existing content from authority; do not mirror unchanged files. Absence means unchanged, and canonical deletion is unsupported.',
    'Do not invent actions, workflow states, roles, or control fields.',
    'Coordinator validates every proposed document and owns all state transitions.',
    'Targeted Attention is only for an exact operator decision, credential, permission, or external action that retry cannot supply.',
    'Use $HOPI_RUN_SCRATCH for disposable temporary or cache files when a tool default is not writable.',
    `Use ${paths.reposFile} as the exact Repo ID to source-root map for this Run. Never infer Repo identity from directory names.`,
    `Project primary Repo ID is ${paths.primaryRepoId}. This Run's source roots are: ${paths.repoRoots.map((repo) => `${repo.repoId}=${repo.path}`).join(', ')}.`,
    'Any attached image input corresponds to an exact Goal asset path cited by the owning Work. Apply only the purpose and limits written in that Work.',
    'Never create or edit evidence/** or append evidenceRefs. Write the Run-local result.json only; Coordinator derives immutable Evidence and owns its reference.',
    'If you stage targeted Attention, result must be attention. Never combine targeted Attention with success, reject, or fail.',
    ...(input.responsibility === 'planner' ? [] : targetedAttentionInstructions(input, paths)),
    '',
  ]
  const responsibility =
    input.responsibility === 'planner'
      ? plannerPrompt(paths)
      : input.responsibility === 'generator'
        ? generatorPrompt(paths)
        : reviewerPrompt(paths)
  return [
    '# HOPI Responsibility Run',
    '',
    ...renderCurrentAssignment(assignment),
    ...common,
    ...responsibility,
    resultInstruction(paths.resultFile, input.responsibility),
  ].join('\n')
}

function targetedAttentionInstructions(
  input: PrepareRoleContextInput,
  paths: { proposalRoot: string; attentionRoot: string },
) {
  const target = `project:${input.projectId}/goal:${input.goalId}/work:${input.workId}`
  return [
    'Try to resolve blockers safely within the current responsibility and preserve evidence of the relevant attempts.',
    'If a safe retry or later Run may succeed without operator action, return fail and let the Coordinator bounded retry policy decide when to escalate.',
    'Stage targeted Attention immediately only when current evidence shows retry cannot help and identifies the exact operator decision, authority, or external action required. Never ask the operator to do something HOPI can safely do itself.',
    'Do not loop or make unrelated or destructive changes merely to force progress.',
    `When targeted Attention is justified, write exactly one ${join(paths.proposalRoot, paths.attentionRoot, '<id>.md')}; the filename stem must exactly equal its frontmatter id.`,
    'Use this exact frontmatter shape:',
    '```yaml',
    '---',
    'id: <stable-id>',
    `target: ${target}`,
    'createdAt: <ISO-8601-timestamp>',
    'resolvedAt: null',
    'notifiedAt: null',
    '---',
    '```',
    'The Markdown body must state the evidence that retry cannot help, the exact operator action needed, its consequence, and the recommended next step.',
  ]
}

function renderCurrentAssignment(assignment: RunAssignment) {
  return [
    '## Current Assignment',
    '',
    `### Goal: ${assignment.goal.title}`,
    '',
    `Canonical source: ${assignment.goal.path} (${assignment.goal.hash})`,
    `Contract revision: ${assignment.goal.contractRevision}`,
    '',
    assignment.goal.body.trim(),
    '',
    `### Owning Work: ${assignment.work.title}`,
    '',
    `Canonical source: ${assignment.work.path} (${assignment.work.hash})`,
    `Kind and stage: ${assignment.work.kind} / ${assignment.work.stage}`,
    '',
    assignment.work.body.trim(),
    '',
    ...(assignment.acceptedInputs.length > 0
      ? [
          '### Accepted Inputs For This Planning Work',
          '',
          ...assignment.acceptedInputs.flatMap((input) => [
            `Canonical source: ${input.path}`,
            '',
            input.body.trim(),
            '',
          ]),
        ]
      : []),
    ...(assignment.latestEvidence
      ? [
          '### Latest Owning Work Evidence',
          '',
          `Canonical source: ${assignment.latestEvidence.path}`,
          '',
          assignment.latestEvidence.body.trim(),
          '',
        ]
      : []),
  ]
}

function plannerPrompt(paths: {
  proposalRoot: string
  bootstrapSourceRoot?: string
  prepareMissing: boolean
  attentionRoot: string
}) {
  return [
    '## Planner',
    '',
    'Clarify only material ambiguity. First inspect staged code and documents; never ask what the available evidence can answer.',
    'Walk the decision tree in dependency order. One Attention may group all currently knowable independent material questions, but must defer questions whose meaning depends on an earlier answer.',
    'For every question include your recommended answer, alternatives, trade-offs, and the design or acceptance impact. Record established decisions in the relevant design document and in design/decisions.md before asking the next round.',
    'The staged goal.md is immutable accepted authority. Never edit it or change contractRevision; contract changes come only from an operator instruction interpreted by Assistant.',
    'Record established decisions in design/** before exposing implementation Work.',
    'When a Goal reference image matters to Engineering Work, preserve its exact Goal asset path and purpose in that Work Markdown. Do not propagate unrelated images.',
    'Plan the smallest independently schedulable Engineering Work set, with complete acceptance criteria and permanent dependsOn edges for known causal, semantic, or file-writer overlap.',
    'Give every Engineering Work the smallest non-empty repos list that supplies its writable source workspace. A Work may span multiple Repos and still remains one Generator, Reviewer, and C1 unit.',
    'Independent testability alone does not justify a separate Work. Keep prerequisite scaffolding with its only consumer when they share primary files and the prerequisite has no independently useful operator outcome.',
    'Every newly proposed Engineering Work must use kind engineering and stage generate. Mark the owning Planning Work done only with a complete proposal.',
    'Every proposed Work must use exactly the current Goal contractRevision. Do not create next-revision Work support.',
    'Your proposal may contain only design/**, Work, targeted or completion Attention, .hopi/docs/repos.md, and the missing root AGENTS.md bootstrap described below. Maintain repos.md when Repo responsibilities, dependency direction, shared contracts, or combined commands are missing or materially stale; it is semantic context, not workflow configuration. Never create Planner Evidence or add its ID to the Planning Work; Coordinator derives it from result.json during publication.',
    'Never reconstruct or consume stale Run output, synthesize Evidence from runtime directories, or advance Engineering Work to review or done; a fresh Generator or Reviewer Run owns that transition.',
    'The fixed control fields are listed below. Use them directly; never inspect another Goal or historical Run to infer document format. Markdown bodies remain free-form.',
    'New Engineering Work frontmatter:',
    'Write each new Engineering Work as work/<id>.md: the filename stem must exactly equal the frontmatter id.',
    '```yaml',
    '---',
    'id: <stable-id>',
    'title: <title>',
    'notBefore: null',
    'dependsOn: []',
    'contractRevision: <current-positive-integer>',
    'evidenceRefs: []',
    'attempts: 0',
    'kind: engineering',
    'stage: generate',
    'repos: [<one-or-more-listed-repo-ids>]',
    '---',
    '```',
    'New Attention frontmatter (target is null for completion, otherwise the canonical Work reference):',
    'Write each new Attention as attention/<id>.md: the filename stem must exactly equal the frontmatter id.',
    '```yaml',
    '---',
    'id: <stable-id>',
    'target: null',
    'createdAt: <ISO-8601-timestamp>',
    'resolvedAt: null',
    'notifiedAt: null',
    '---',
    '```',
    'Keep exactly one nonterminal Planning Work. Never reopen terminal Work.',
    `Write changed Goal-package documents into the sparse overlay at ${paths.proposalRoot}; do not edit source or ordinary project documents.`,
    ...(paths.bootstrapSourceRoot
      ? [
          `Root AGENTS.md was absent. Scan ${paths.bootstrapSourceRoot} and create ${join(paths.proposalRoot, 'AGENTS.md')} as a concise project entrypoint in this same proposal.`,
        ]
      : ['Root AGENTS.md already exists and must not be replaced automatically.']),
    ...(paths.prepareMissing
      ? [
          'scripts/hopi/prepare is absent. If this delivery needs an executable environment, include creation of the idempotent executable in the first real Engineering Work; do not create a separate Init Work or let Planner write the executable.',
        ]
      : [
          'scripts/hopi/prepare already exists. Preserve it unless accepted dependency, build, runtime, or repository-topology changes require the owning Engineering Work to keep it current.',
        ]),
    `When Assistant management or operator authority is materially required, create one valid targeted Attention under ${join(paths.proposalRoot, paths.attentionRoot)}, return attention, and leave Planning Work at plan.`,
    'Create the one target-null completion Attention only when the entire Goal already has sufficient final proof and the proposal contains zero nonterminal Engineering Work. Never create completion Attention merely because Planning is complete or alongside newly proposed Engineering Work. Otherwise mark Planning Work done only after its complete design and Work proposal is staged.',
    '',
  ]
}

function generatorPrompt(paths: {
  proposalRoot: string
  attentionRoot: string
}) {
  return [
    '## Generator',
    '',
    'Implement the owning Engineering Work in the current stable task worktree and run focused checks.',
    'Read root AGENTS.md and scripts/hopi/prepare before rediscovering project setup or runtime entrypoints. A Project Preparation Diagnostic appended below is exact preflight input, not a separate Work.',
    'The staged canonical context overrides any older .hopi copy in the task branch.',
    'If the owning Work cites a reference image, inspect the attached image and follow the documented purpose rather than treating every visual detail as a requirement.',
    'Never edit .hopi in the task worktree. Do not change Work, Goal, or design files directly.',
    'You may inspect Git status and diff, but never run Git write operations such as add, commit, checkout, switch, merge, rebase, reset, or clean.',
    'Coordinator alone owns the Git index, task-branch checkpoints, and commits after this Run.',
    `If accepted design, missing information, or an external condition prevents safe progress, stage one targeted Attention under ${join(paths.proposalRoot, paths.attentionRoot)} for Assistant management and return attention.`,
    'Do not rerun an unchanged passing check. One passing run after the final relevant source change is sufficient unless distinct acceptance criteria require distinct evidence.',
    'Return success only after the acceptance criteria have evidence. Return attention when Assistant management is required; use fail for a retryable execution failure that does not require Assistant input.',
    '',
  ]
}

function reviewerPrompt(paths: {
  proposalRoot: string
  attentionRoot: string
}) {
  return [
    '## Reviewer',
    '',
    'Independently inspect acceptance criteria, the task-branch diff, checks, and material runtime behavior.',
    `Review the owning Work's cumulative delta from git merge-base ${HOPI_RELEASE_REF} HEAD to HEAD. Do not attribute release-only commits or canonical .hopi movement to this Work; C1 owns integration onto the current release tip.`,
    'Do not edit source, ordinary project documents, or .hopi in the task worktree.',
    'If the owning Work cites a reference image, compare material visual criteria against the attached original image and its documented purpose.',
    'Choose the strongest proportionate proof for every acceptance criterion.',
    'Decide the proof plan before installing optional tools. Reuse root AGENTS.md, scripts/hopi/prepare, and the existing project test/browser stack; do not install a competing harness after decisive proof already exists.',
    'A helper-only change normally needs focused tests, not browser exploration. A visual, crash, or interaction Work needs one direct runtime exercise of the reported path. Do not rerun an unchanged passing check.',
    'When the Work addresses an operator-reported runtime path, crash, interaction, or visual behavior, exercise that exact path through the point after the reported failure. Unit or shell-level tests alone are insufficient unless existing evidence is strictly stronger and you explain why.',
    'This is an evidence obligation, not a fixed browser workflow. You may start short-lived local services for this Run; persistent Project Preview and integration are not your responsibility.',
    `If design, information, or operator authority is required, stage one valid targeted Attention under ${join(paths.proposalRoot, paths.attentionRoot)} for Assistant management.`,
    'Return reject for an implementation defect, attention when Assistant management is required, and fail for a retryable review failure.',
    '',
  ]
}

function resultInstruction(resultFile: string, responsibility: Responsibility) {
  const allowed =
    responsibility === 'planner'
      ? 'success, attention, or fail'
      : responsibility === 'generator'
        ? 'success, attention, or fail'
        : 'success, reject, attention, or fail'
  return [
    '## Required Result',
    '',
    `Write exactly one JSON object to ${resultFile}:`,
    '',
    '```json',
    '{"result":"success","summary":"Concise evidence-backed result","artifacts":[]}',
    '```',
    '',
    `Allowed result for this ${responsibility} Run: ${allowed}.`,
    'Summary is explanatory evidence, never a control protocol. Artifacts lists only preserved Run-local proof such as logs or screenshots; leave it empty when no file adds evidence.',
    '',
  ].join('\n')
}

async function gitOutput(cwd: string, args: string[]) {
  return new TextDecoder().decode(await gitBytes(cwd, args)).trimEnd()
}

async function gitBytes(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new RoleContextStagingError(`git ${args.join(' ')} failed in ${cwd}: ${stderr.trim()}`)
  }
  return new Uint8Array(stdout)
}

function safeJoin(root: string, relativePath: string) {
  const normalized = posix.normalize(relativePath)
  if (
    !relativePath ||
    normalized !== relativePath ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    relativePath.includes('\\')
  ) {
    throw new RoleContextStagingError(`Unsafe staged path: ${relativePath}`)
  }
  return join(root, ...relativePath.split('/'))
}

function normalizeGitPath(path: string) {
  if (path.startsWith('/') || path.includes('\\')) {
    throw new RoleContextStagingError(`Unsafe Git path: ${path}`)
  }
  const normalized = posix.normalize(path)
  if (normalized !== path || normalized.startsWith('../')) {
    throw new RoleContextStagingError(`Unsafe Git path: ${path}`)
  }
  return normalized
}

function assertStableId(value: string, label: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new RoleContextStagingError(`Invalid ${label}: ${value}`)
  }
}

function decode(content: Uint8Array | null) {
  if (!content) throw new RoleContextStagingError('Missing staged document content')
  return new TextDecoder().decode(content)
}
