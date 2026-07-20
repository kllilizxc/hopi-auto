import { chmod, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import type { TransportContextBundle } from '../agent/vendorTransport'
import { ASSISTANT_PREFERENCE_PATH, readAssistantPreference } from '../domain/assistantPreference'
import { goalAttentionTarget, workAttentionTarget } from '../domain/attentionTarget'
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
import { STABLE_ID_PATTERN } from '../domain/stableId'
import type { PublicationCoordinator } from '../publication/publisher'
import type { PublicationSnapshot, PublicationSnapshotFile } from '../publication/types'
import { createGoalPackagePaths } from '../storage/goalPackagePaths'
import { parsePortableArtifactReference } from './runArtifacts'
import { runStoragePath, runtimeCacheRoot } from './runPaths'

export const RESPONSIBILITIES = ['planner', 'generator', 'reviewer'] as const
export type Responsibility = (typeof RESPONSIBILITIES)[number]

export interface PrepareRoleContextInput {
  projectRoot: string
  projectPath?: string
  projectId: string
  goalId: string
  workId: string
  runId: string
  responsibility: Responsibility
  primaryRepoId?: string
  repoRoots?: readonly RoleRepoRoot[]
  apiOrigin?: string
  runtimeScratchDir?: string
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
  agentsPath?: string
  operatorPreferenceFile?: string
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
      const apiOrigin = input.apiOrigin ? normalizeApiOrigin(input.apiOrigin) : undefined
      const primaryRepoId = input.primaryRepoId ?? DEFAULT_PRIMARY_REPO_ID
      assertStableId(primaryRepoId, 'primaryRepoId')
      const repoRoots = normalizeRepoRoots(
        input.repoRoots ?? [{ repoId: primaryRepoId, path: projectRoot, primary: true }],
        primaryRepoId,
      )
      const paths = createGoalPackagePaths(projectRoot, input.projectId, input.projectPath)
      const runRoot = runStoragePath(absoluteHomeRoot, input.runId)
      const contextRoot = join(runRoot, 'context')
      const authorityRoot = join(contextRoot, 'authority')
      const proposalRoot = join(runRoot, 'proposal')
      const resultFile = join(runRoot, 'result.json')
      const contextFile = join(runRoot, 'context.md')
      const promptFile = join(runRoot, 'prompt.md')
      const reposFile = join(runRoot, 'repos.json')
      const browserHarnessArtifactDir = join(runRoot, 'browser-harness')
      const runtimeScratchDir = resolve(input.runtimeScratchDir ?? join(runRoot, 'scratch'))
      const runtimeCacheDir = runtimeCacheRoot(absoluteHomeRoot)

      await rm(runRoot, { recursive: true, force: true })
      await mkdir(authorityRoot, { recursive: true })
      await mkdir(proposalRoot, { recursive: true })
      await mkdir(runtimeScratchDir, { recursive: true })
      await mkdir(runtimeCacheDir, { recursive: true })

      const snapshot = await stableAuthoritySnapshot(publisher, paths.publicationRoot, {
        paths: [
          paths.agentsPath,
          '.hopi/project.yml',
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
      const evidencePaths = authorityFiles
        .filter((file) => file.path.startsWith(`${paths.evidenceRoot(input.goalId)}/`))
        .map((file) => file.path)
      const evidenceArtifacts = await resolveEvidenceArtifacts(
        absoluteHomeRoot,
        authorityFiles,
        paths,
        input.goalId,
      )
      const artifactManifestFile =
        evidenceArtifacts.length > 0 ? join(contextRoot, 'evidence-artifacts.json') : undefined
      const assignment = createRunAssignment(input, paths, parsedGoal, parsedWork, authorityFiles)
      const operatorPreference =
        input.responsibility === 'planner'
          ? await snapshotOperatorPreference(publisher, absoluteHomeRoot)
          : undefined
      const operatorPreferenceFile = operatorPreference
        ? join(contextRoot, 'operator', 'preference.md')
        : undefined

      for (const file of authorityFiles) {
        if (file.content === null) continue
        await writeSnapshotFile(authorityRoot, file.path, file.content)
      }
      if (operatorPreferenceFile && operatorPreference) {
        await mkdir(dirname(operatorPreferenceFile), { recursive: true })
        await Bun.write(operatorPreferenceFile, operatorPreference.content)
      }
      if (artifactManifestFile) {
        await Bun.write(
          artifactManifestFile,
          `${JSON.stringify({ version: 1, artifacts: evidenceArtifacts }, null, 2)}\n`,
        )
        await chmod(artifactManifestFile, 0o444)
      }
      const imageFiles = [...referencedImages].map((imagePath) =>
        join(authorityRoot, ...imagePath.split('/')),
      )

      const agentsFile = snapshot.files.find((file) => file.path === paths.agentsPath)
      let bootstrapSourceRoot: string | undefined
      if (input.responsibility === 'planner' && agentsFile?.content === null) {
        bootstrapSourceRoot = join(contextRoot, 'source')
        await stageTrackedSource(projectRoot, releaseHead, bootstrapSourceRoot, paths.projectPath)
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
          runtimeCacheDir,
          releaseHead,
          snapshot: authorityFiles,
          evidencePaths,
          artifactManifestFile,
          bootstrapSourceRoot,
          imagePaths: [...referencedImages],
          primaryRepoId,
          repoRoots,
          reposFile,
          projectPath: paths.projectPath,
          apiOrigin,
          operatorPreference: operatorPreferenceFile
            ? { path: operatorPreferenceFile, digest: operatorPreference?.digest ?? '' }
            : undefined,
        }),
      )
      await Bun.write(
        promptFile,
        renderResponsibilityPrompt(
          input,
          {
            runRoot,
            contextFile,
            artifactManifestFile,
            authorityRoot,
            proposalRoot,
            resultFile,
            bootstrapSourceRoot,
            agentsPath: paths.agentsPath,
            attentionRoot: paths.attentionRoot(input.goalId),
            primaryRepoId,
            repoRoots,
            reposFile,
            apiOrigin,
            operatorPreferenceFile,
            hasImages: imageFiles.length > 0,
          },
          assignment,
        ),
      )
      await Bun.write(resultFile, '')

      return {
        runtimeScratchDir,
        runtimeCacheDir,
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
        agentsPath: paths.agentsPath,
        operatorPreferenceFile,
        repoRoots,
        reposFile,
        apiOrigin,
        goalFile: join(authorityRoot, ...goalPath.split('/')),
        designFile: join(authorityRoot, ...paths.designIndex(input.goalId).split('/')),
        extraReadableRoots: [...new Set(repoRoots.map((repo) => repo.path))],
        extraWritableRoots: [
          ...new Set([
            runRoot,
            runtimeScratchDir,
            runtimeCacheDir,
            ...(input.responsibility === 'generator' ? repoRoots.map((repo) => repo.path) : []),
          ]),
        ],
        contextFile,
        artifactManifestFile,
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

async function snapshotOperatorPreference(publisher: PublicationCoordinator, homeRoot: string) {
  const snapshot = await publisher.snapshot({ id: 'assistant-home', path: homeRoot }, [
    ASSISTANT_PREFERENCE_PATH,
  ])
  const content = snapshot.files[0]?.content
  return readAssistantPreference(content ? new TextDecoder().decode(content) : null)
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

function normalizeApiOrigin(value: string) {
  const url = new URL(value)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin === 'null') {
    throw new RoleContextStagingError(`Invalid HOPI API origin: ${value}`)
  }
  return url.origin
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

function collectDependencyContext(
  files: readonly PublicationSnapshotFile[],
  paths: ReturnType<typeof createGoalPackagePaths>,
  goalId: string,
  owningWork: ReturnType<typeof parseWorkDocument>,
) {
  const workRoot = `${paths.workRoot(goalId)}/`
  const workById = new Map<
    string,
    { path: string; document: ReturnType<typeof parseWorkDocument> }
  >()
  for (const file of files) {
    if (!file.content || !file.path.startsWith(workRoot)) continue
    const document = parseWorkDocument(decode(file.content))
    workById.set(document.attributes.id, { path: file.path, document })
  }

  const workPaths = new Set<string>()
  const evidencePaths = new Set<string>()
  const visited = new Set<string>()
  const visit = (workId: string) => {
    if (visited.has(workId)) return
    visited.add(workId)
    const dependency = workById.get(workId)
    if (!dependency) {
      throw new RoleContextStagingError(`Dependency Work is missing from authority: ${workId}`)
    }
    workPaths.add(dependency.path)
    for (const evidencePath of selectedEvidencePaths(dependency.document, paths, goalId)) {
      evidencePaths.add(evidencePath)
    }
    for (const dependencyId of dependency.document.attributes.dependsOn) visit(dependencyId)
  }

  for (const dependencyId of owningWork.attributes.dependsOn) visit(dependencyId)
  return { workPaths, evidencePaths }
}

async function resolveEvidenceArtifacts(
  homeRoot: string,
  files: readonly PublicationSnapshotFile[],
  paths: ReturnType<typeof createGoalPackagePaths>,
  goalId: string,
) {
  const evidenceRoot = `${paths.evidenceRoot(goalId)}/`
  const artifacts = new Map<string, { reference: string; path: string; evidence: Set<string> }>()
  for (const file of files) {
    if (!file.content || !file.path.startsWith(evidenceRoot)) continue
    const evidence = parseEvidenceDocument(decode(file.content))
    for (const reference of evidence.attributes.artifacts) {
      const parsed = parsePortableArtifactReference(reference)
      if (!parsed?.runId) continue
      const path = join(
        runStoragePath(homeRoot, parsed.runId),
        'artifacts',
        ...parsed.artifactPath.split('/'),
      )
      const metadata = await stat(path).catch(() => null)
      if (!metadata?.isFile()) {
        throw new RoleContextStagingError(
          `Canonical Evidence ${file.path} references missing Run artifact ${reference}`,
        )
      }
      const existing = artifacts.get(reference)
      if (existing) {
        existing.evidence.add(file.path)
      } else {
        artifacts.set(reference, { reference, path, evidence: new Set([file.path]) })
      }
    }
  }
  return [...artifacts.values()]
    .map((artifact) => ({ ...artifact, evidence: [...artifact.evidence].sort() }))
    .sort((left, right) => left.reference.localeCompare(right.reference))
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
  const goalTarget = goalAttentionTarget(input.projectId, input.goalId)
  const workTarget = workAttentionTarget(input.projectId, input.goalId, input.workId)
  const dependencyContext = collectDependencyContext(files, paths, input.goalId, work)
  const referencedEvidence = new Set([
    ...selectedEvidencePaths(work, paths, input.goalId),
    ...dependencyContext.evidencePaths,
  ])
  const dependencyWork = dependencyContext.workPaths
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

function selectedEvidencePaths(
  work: ReturnType<typeof parseWorkDocument>,
  paths: ReturnType<typeof createGoalPackagePaths>,
  goalId: string,
) {
  const evidenceIds = work.attributes.evidenceRefs
  const terminalPairSize =
    isEngineeringWork(work.attributes) && work.attributes.stage === 'done' ? 2 : 1
  const selected = new Set(evidenceIds.slice(-terminalPairSize))
  for (const evidenceId of evidenceIds) {
    const evidencePath = paths.evidenceDocument(goalId, evidenceId)
    if (work.body.includes(evidenceId) || work.body.includes(evidencePath)) {
      selected.add(evidenceId)
    }
  }
  return [...selected].map((evidenceId) => paths.evidenceDocument(goalId, evidenceId))
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
  const owningWorkTarget = workAttentionTarget(input.projectId, input.goalId, input.workId)
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
    title: string
    contractRevision: number
    body: string
  }
  work: {
    path: string
    title: string
    kind: string
    stage: string
    body: string
  }
  acceptedInputs: Array<{ path: string; sourceEventId: string; body: string }>
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
      ? authorityFiles
          .flatMap((file) => {
            if (!file.content || !file.path.startsWith(`${paths.inputsRoot(input.goalId)}/`)) {
              return []
            }
            const document = parseInputDocument(decode(file.content))
            return work.body.includes(file.path) ||
              work.body.includes(document.attributes.sourceEventId)
              ? [
                  {
                    path: file.path,
                    sourceEventId: document.attributes.sourceEventId,
                    body: document.body,
                  },
                ]
              : []
          })
          .sort((left, right) => {
            const leftIndex = work.body.indexOf(left.path)
            const rightIndex = work.body.indexOf(right.path)
            if (leftIndex < 0 && rightIndex < 0) return left.path.localeCompare(right.path)
            if (leftIndex < 0) return 1
            if (rightIndex < 0) return -1
            return leftIndex - rightIndex
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
      title: goal.attributes.title,
      contractRevision: goal.attributes.contractRevision,
      body: goal.body,
    },
    work: {
      path: workPath,
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

async function stageTrackedSource(
  projectRoot: string,
  releaseHead: string,
  destination: string,
  projectPath: string,
) {
  await mkdir(destination, { recursive: true })
  const tracked = await gitOutput(projectRoot, ['ls-tree', '-r', '-z', '--name-only', releaseHead])
  const paths = tracked.split('\0').filter(Boolean)
  const scopePrefix = projectPath === '.' ? '' : `${projectPath}/`
  const scopedPaths = paths.filter((path) => !scopePrefix || path.startsWith(scopePrefix))

  for (const gitPath of scopedPaths) {
    const relativePath = scopePrefix ? gitPath.slice(scopePrefix.length) : gitPath
    if (relativePath === '.hopi' || relativePath.startsWith('.hopi/')) continue
    const normalized = normalizeGitPath(relativePath)
    const target = safeJoin(destination, normalized)
    await mkdir(dirname(target), { recursive: true })
    await Bun.write(target, await gitBytes(projectRoot, ['show', `${releaseHead}:${gitPath}`]))
    await chmod(target, 0o444)
  }

  await Bun.write(
    join(destination, '.hopi-source-manifest.txt'),
    [
      `releaseHead: ${releaseHead}`,
      `projectPath: ${projectPath}`,
      `trackedFiles: ${scopedPaths.length}`,
      '',
    ].join('\n'),
  )
}

function renderContextManifest(
  input: PrepareRoleContextInput,
  context: {
    authorityRoot: string
    proposalRoot: string
    runtimeScratchDir: string
    runtimeCacheDir: string
    releaseHead: string
    snapshot: PublicationSnapshot['files']
    evidencePaths: readonly string[]
    artifactManifestFile?: string
    bootstrapSourceRoot?: string
    imagePaths: readonly string[]
    primaryRepoId: string
    repoRoots: readonly RoleRepoRoot[]
    reposFile: string
    projectPath: string
    apiOrigin?: string
    operatorPreference?: { path: string; digest: string }
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
    `- Responsibility session workspace: ${context.runtimeScratchDir}`,
    `- Reusable runtime cache: ${context.runtimeCacheDir}`,
    `- Project primary Repo: ${context.primaryRepoId}`,
    `- Project source scope: ${context.projectPath}`,
    `- Repo workspace manifest: ${context.reposFile}`,
    ...(context.artifactManifestFile
      ? [`- Evidence artifact manifest: ${context.artifactManifestFile}`]
      : []),
    ...(context.operatorPreference
      ? [
          `- Operator preference snapshot: ${context.operatorPreference.path} (${context.operatorPreference.digest})`,
        ]
      : []),
    ...(context.apiOrigin ? [`- HOPI public API origin: ${context.apiOrigin}`] : []),
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
      ? ['', '## Selected Evidence', '', ...context.evidencePaths.map((path) => `- ${path}`)]
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
    runRoot: string
    contextFile: string
    artifactManifestFile?: string
    authorityRoot: string
    proposalRoot: string
    resultFile: string
    bootstrapSourceRoot?: string
    agentsPath: string
    attentionRoot: string
    primaryRepoId: string
    repoRoots: readonly RoleRepoRoot[]
    reposFile: string
    apiOrigin?: string
    operatorPreferenceFile?: string
    hasImages: boolean
  },
  assignment: RunAssignment,
) {
  const boundary = [
    '## Execution Boundary',
    '',
    `Working directory: ${input.responsibility === 'generator' ? 'the assigned task Repo root' : paths.runRoot}`,
    `Authority root: ${paths.authorityRoot}`,
    `Proposal root: ${paths.proposalRoot}`,
    `Result file: ${paths.resultFile}`,
    `Audit manifest: ${paths.contextFile}`,
    ...(paths.artifactManifestFile
      ? [
          `Evidence artifact manifest: ${paths.artifactManifestFile} (also $HOPI_EVIDENCE_ARTIFACTS_FILE)`,
        ]
      : []),
    `Repo manifest: ${paths.reposFile}`,
    `Attention proposal directory: ${paths.attentionRoot} (relative to Proposal root)`,
    `Project guidance: ${paths.agentsPath}`,
    `Repo preparation entrypoints: ${paths.repoRoots.map((repo) => `${repo.repoId}=${join(repo.path, 'scripts', 'hopi', 'prepare')}`).join(', ')}`,
    `Primary Repo: ${paths.primaryRepoId}`,
    `Source roots: ${paths.repoRoots.map((repo) => `${repo.repoId}=${repo.path}`).join(', ')}`,
    ...(paths.operatorPreferenceFile
      ? [`Operator preference snapshot: ${paths.operatorPreferenceFile}`]
      : []),
    ...(paths.apiOrigin
      ? [`Public Preview API origin: ${paths.apiOrigin} (also $HOPI_API_ORIGIN)`]
      : []),
    '',
    'Authority is immutable. Proposal is an initially empty sparse overlay: create only added or replaced control documents and their parent directories. Absence means unchanged; deletion is unsupported.',
    'Permission follows resource ownership, not command allowlists. Use ordinary shell, network, filesystem, and tools freely inside the resources assigned below.',
    'Coordinator alone validates proposals, changes control state, writes Evidence, updates evidenceRefs, and owns HOPI-managed task Git metadata, checkpoints, and integration refs.',
    'The Repo manifest is the complete source-root map. Never infer Repo identity from directory names or inspect sibling, historical, or other Work runtime directories.',
    'Use $HOPI_RUN_SCRATCH for retained files and $HOPI_CACHE_DIR for caches; evidence requires a retained file or log.',
    ...(paths.hasImages
      ? [
          'Attached images correspond only to Goal assets cited by the owning Work. Apply their documented purpose and limits.',
        ]
      : []),
    'Never create or edit evidence/** or append evidenceRefs. Write the Run-local result.json only; Coordinator derives immutable Evidence and owns its reference.',
    'Targeted Attention is for a blocker this role and retry cannot clear. Name Assistant for HOPI repair; name the operator only for an external decision, credential, permission, or action. Technical diagnostics such as local ports are not operator authority.',
    ...targetedAttentionContract(input),
    '',
  ]
  const responsibility =
    input.responsibility === 'planner'
      ? plannerPrompt(paths)
      : input.responsibility === 'generator'
        ? generatorPrompt()
        : reviewerPrompt()
  return [
    '# HOPI Responsibility Run',
    '',
    ...renderCurrentAssignment(input.responsibility, assignment),
    ...boundary,
    ...responsibility,
    resultInstruction(input.responsibility),
  ].join('\n')
}

function targetedAttentionContract(input: PrepareRoleContextInput) {
  const target = workAttentionTarget(input.projectId, input.goalId, input.workId)
  return [
    'Write targeted Attention as exactly one <id>.md in the Attention proposal directory; the filename stem must equal the frontmatter id.',
    'Use this exact frontmatter:',
    '```yaml',
    '---',
    'id: <stable-id>',
    `target: ${target}`,
    'createdAt: 1970-01-01T00:00:00.000Z',
    'resolvedAt: null',
    'notifiedAt: null',
    'operatorRequest: null',
    '---',
    '```',
    'In the body, preserve evidence that retry cannot help, the blocker, and owner; ask the operator only when Assistant cannot act.',
  ]
}

function renderCurrentAssignment(responsibility: Responsibility, assignment: RunAssignment) {
  const expandedAcceptedInputs = assignment.acceptedInputs.filter(
    (input) =>
      !assignment.goal.body.includes(`## Accepted Inbox Instruction ${input.sourceEventId}`),
  )
  const primary =
    responsibility === 'planner'
      ? [
          '## Primary Task',
          '',
          `### Goal Contract: ${assignment.goal.title}`,
          `Source: ${assignment.goal.path}`,
          `Contract revision: ${assignment.goal.contractRevision}`,
          '',
          '<goal-contract>',
          assignment.goal.body.trim(),
          '</goal-contract>',
          '',
          `### Planning Work: ${assignment.work.title}`,
          `Source: ${assignment.work.path}`,
          `Kind and stage: ${assignment.work.kind} / ${assignment.work.stage}`,
          '',
          '<planning-work>',
          assignment.work.body.trim(),
          '</planning-work>',
          '',
          ...(expandedAcceptedInputs.length > 0
            ? [
                '### Accepted Inputs (Planning Work order)',
                '',
                ...expandedAcceptedInputs.flatMap((input, index) => [
                  `#### Input ${index + 1}`,
                  ...(assignment.work.body.includes(input.path) ? [] : [`Source: ${input.path}`]),
                  '<accepted-input>',
                  input.body.trim(),
                  '</accepted-input>',
                  '',
                ]),
              ]
            : []),
        ]
      : [
          '## Primary Task',
          '',
          `### Engineering Work: ${assignment.work.title}`,
          `Source: ${assignment.work.path}`,
          `Kind and stage: ${assignment.work.kind} / ${assignment.work.stage}`,
          '',
          '<engineering-work>',
          assignment.work.body.trim(),
          '</engineering-work>',
          '',
        ]
  const supporting = [
    ...(responsibility === 'planner'
      ? []
      : [
          '## Supporting Authority',
          '',
          `Goal: ${assignment.goal.title}`,
          `Goal source: ${assignment.goal.path}`,
          `Goal contract revision: ${assignment.goal.contractRevision}`,
        ]),
    ...(assignment.latestEvidence
      ? [
          ...(responsibility === 'planner' ? ['## Supporting Authority', ''] : []),
          '',
          '### Latest Owning Work Evidence',
          `Source: ${assignment.latestEvidence.path}`,
          '',
          '<latest-evidence>',
          assignment.latestEvidence.body.trim(),
          '</latest-evidence>',
        ]
      : []),
    '',
  ]
  return [...primary, ...supporting]
}

function plannerPrompt(paths: {
  runRoot: string
  proposalRoot: string
  bootstrapSourceRoot?: string
  agentsPath: string
  attentionRoot: string
  apiOrigin?: string
  operatorPreferenceFile?: string
}) {
  return [
    '## Planner',
    '',
    'Inspect authority and source first. Ask only material ambiguity evidence cannot answer; group independent questions with a recommendation and trade-offs.',
    'Research source, tools, and external facts as deeply as needed. Keep machine-local login, versions/models, transient facts, and one-Run measurements in Evidence unless lasting.',
    'Never propose goal.md or change its contractRevision; only an operator instruction changes it.',
    ...(paths.operatorPreferenceFile
      ? [
          'Apply relevant operator defaults, but current accepted Input and Project/Goal authority override them. Materialize a relevant default into design or Engineering Work; never copy unrelated preferences.',
        ]
      : []),
    'Record durable decisions in design/** before exposing Work.',
    'When a Goal image matters, preserve its exact Goal asset path and purpose in the Engineering Work. Omit unrelated images.',
    'dependsOn is only for required output, overlapping writers, or exclusive resources—not shared reads or expected order. Keep single-use scaffolding with its consumer.',
    'For existing nonterminal Work, dependsOn is monotonic history: preserve every edge, add required predecessors, and never replace an edge.',
    'If accepted current Input explicitly narrows or relaxes delivery, remove superseded objective, acceptance, and proof clauses from nonterminal Work; preserve identity, dependency/Evidence history, and current safety/persistence.',
    'Judge cohesion by proof boundary: one Work follows one canonical fact chain and one primary verification strategy. Split independent proof strategies at stable contracts; never split cohesive Work merely to fill capacity.',
    'For repeated facts, name one canonical owner and one-way derivation.',
    'Each Engineering Work is standalone in outcome, dependencies, Repo scope, and task-worktree proof. Cite canonical design paths; list only Repos it must inspect, execute, or modify.',
    'A minimal contract gives every path and proof a requested outcome, accepted compatibility, safety/persistence, or credible regression. Separate delivery from reusable enforcement; add parser/schema/infrastructure only when requested or already durable, with a finite accepted input grammar.',
    'Public Preview proves only the integrated release; exclude it from Engineering acceptance.',
    'New Work uses kind engineering, stage generate, current contractRevision, and no assistantDispatch. Preserve existing assistantDispatch; Terminal Work is immutable.',
    'One Work ID owns a cumulative stable source lineage. Only a current sync diagnostic justifies repair; old wrong-HEAD/dirty-tree preflights do not prove a new failure. To discard delta, create a distinct Engineering Work.',
    'Proposal may contain only design/**, Engineering Work, Attention, .hopi/docs/repos.md, and an allowed AGENTS.md bootstrap. Planning Work is read-only and must not be copied. Coordinator derives Planner Evidence from result.json.',
    'With a complete Engineering DAG, leave Proposal empty and succeed. This ends only Planning; it never retries, resets, cancels, or resolves Engineering Work or Attention. Never claim Coordinator will.',
    'Resolved Assistant Attention is history. With terminal Work and no targeted Attention, propose target-null completion.',
    'Maintain .hopi/docs/repos.md only when Repo responsibilities or shared contracts are materially stale. It is context, not workflow configuration.',
    'Omitted Evidence is historical. Never repair an unstaged evidenceRef, reconstruct stale Run output, synthesize Evidence from runtime directories, or inspect another Goal/Run.',
    'Coordinator validates proposal schema and DAG; use returned diagnostics on retry instead of duplicating its validator.',
    'New Engineering Work frontmatter (Markdown bodies remain free-form):',
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
    'Completion Attention frontmatter (final Planner success only):',
    '```yaml',
    '---',
    'id: <stable-id>',
    'target: null',
    'createdAt: 1970-01-01T00:00:00.000Z',
    'resolvedAt: null',
    'notifiedAt: null',
    'operatorRequest: null',
    '---',
    '```',
    ...(paths.apiOrigin
      ? [
          'Only when accepted design requires Preview proof and all Engineering Work is terminal, validate the integrated release with POST $HOPI_API_ORIGIN/api/projects/<projectId>/preview/start, GET $HOPI_API_ORIGIN/api/projects/<projectId>/preview, then POST $HOPI_API_ORIGIN/api/projects/<projectId>/preview/stop. Otherwise do not start Preview.',
        ]
      : []),
    'Planner working directory is not a Git checkout. Write canonical relative paths beneath the Proposal root (for example `.hopi/docs/...`), validate the sparse files directly, and do not edit source or ordinary project documents.',
    ...(paths.bootstrapSourceRoot
      ? [
          `Project guidance is absent. Scan the read-only source snapshot at ${paths.bootstrapSourceRoot} and propose AGENTS.md as a concise Project entrypoint.`,
        ]
      : ['Project guidance exists and must not be replaced automatically.']),
    'Every Repo selected by Engineering Work owns scripts/hopi/prepare in its own checkout. Include creation or repair in that same Work when needed; do not create separate Init Work or Repair Work, route preparation through primary, or let Planner write source.',
    'For Assistant management, stage one targeted Attention and leave Planning Work at plan. For completion, stage one target-null Attention; never combine it with nonterminal Engineering Work.',
    '',
  ]
}

function generatorPrompt() {
  return [
    '## Generator',
    '',
    'Implement the owning Engineering Work in the current stable task worktree and run focused checks.',
    'Treat a Reviewer reproducer as evidence that an accepted invariant is false, not as the repair scope. Repair the owning invariant, check adjacent representations and representative variants, and derive persisted projections from their canonical owner instead of adding pairwise exceptions. Use proportionate judgment; no checklist artifact is required.',
    'A repair Run still owns the complete Work. After the final relevant change, reassess every materially affected acceptance criterion; passing only the latest reproducer is not success.',
    'Replay the latest Reviewer reproducer before claiming success. When it is stable and the existing Project test or validator stack can express it, persist it at the nearest owning boundary; otherwise explain why the retained proof is stronger in the result summary.',
    'Implement the accepted contract, not a broader imagined platform. Generalize only where the Work names reusable enforcement or the existing architecture makes that boundary necessary for correctness.',
    'Read Project guidance and every selected Repo preparation entrypoint before rediscovering setup. A Repo Preparation Diagnostic appended below is exact preflight input, not separate Work.',
    'Each selected Repo owns its own scripts/hopi/prepare. Repair only the failing candidate entrypoints in this Work; never route one Repo through another or make a primary adapter orchestrate the manifest.',
    'When a required Repo is absent from the Repo manifest, stage Attention instead of discovering another Work checkout. Project scripts must consume the manifest rather than scan HOPI runtime siblings.',
    'The public Project Preview API targets the current integrated release and is not candidate evidence. When material runtime proof is needed, execute the task worktree preview directly with the Run manifest.',
    'For operator-facing runtime or interaction changes, exercise the candidate primary path after the final relevant change when its existing entrypoint permits it. Apply proportional judgment; this is not a fixed browser checklist.',
    'When this Work creates or changes scripts/hopi/preview, it must print exactly one HOPI_PREVIEW_URL=<reachable-url> line after startup is ready; a bare URL is not a HOPI ready signal.',
    'The staged canonical context overrides any older .hopi copy in the task branch.',
    'Never edit .hopi in the task worktree. Do not change Work, Goal, or design files directly.',
    'The assigned task worktree Git index, HEAD, branch, and shared Git directory are HOPI-managed. Do not mutate them; Coordinator checkpoints source edits after the Run.',
    'When accepted Work requires branch or PR delivery, use a Run-owned clone under $HOPI_RUN_SCRATCH. Git staging, commits, branch changes, rebases, and pushes are allowed there within the repository and delivery named by Work.',
    'Do not merge, deploy, mutate production data, or create another unrequested external effect without explicit Work or operator authority.',
    '',
  ]
}

function reviewerPrompt() {
  return [
    '## Reviewer',
    '',
    'Independently inspect acceptance criteria, the task-branch diff, checks, and material runtime behavior.',
    `Review the owning Work's cumulative delta from git merge-base ${HOPI_RELEASE_REF} HEAD to HEAD. Do not attribute release-only commits or canonical .hopi movement to this Work; C1 owns integration onto the current release tip.`,
    'Do not edit source, ordinary project documents, or .hopi in the task worktree.',
    'Choose the strongest proportionate proof for every acceptance criterion.',
    'Bound rejection by the accepted contract and material risk. Defects in the deliverable, accepted input, explicit reusable enforcement, or material integrity/safety may reject; a malformed hypothetical form outside the stated accepted grammar cannot expand one-time Work into validator completeness.',
    'Do not promote presentation preference into parser requirement. Record useful out-of-grammar limits without rejection; if required reusable validation lacks a coherent grammar, return Attention rather than invent an unlimited standard.',
    'Order cheap, high-risk canonical or recomputation probes before expensive broad or browser proof when both matter. After a decisive defect, perform a bounded low-cost sweep of the same invariant and other already-visible independent risks, then batch all currently knowable findings; stop before unrelated exhaustive exploration. On a later review, replay the reported reproducer first, then prove its invariant rather than only the literal example.',
    'Every reproducible reject summary must name the violated invariant, exact command and input or deterministic inspection steps, and the observed failure. Do not invent a reproducer when the finding is inherently observational; state that boundary precisely.',
    'Decide the proof plan before installing optional tools. Reuse Project guidance, preparation, and the existing test/browser stack; do not add a competing harness after decisive proof exists.',
    'If direct proof requires a Repo absent from the Repo manifest, stage Attention instead of inspecting another Work checkout or historical runtime directory.',
    'The public Project Preview API targets the current integrated release and is not candidate evidence. When runtime proof is material, execute the task worktree preview directly with the Run manifest; final post-C1 Preview proof belongs to Planner only when design requires it.',
    'When scripts/hopi/preview is in scope, verify that readiness emits exactly one HOPI_PREVIEW_URL=<reachable-url> line; accepting a bare URL would leave Project Preview stuck in starting.',
    'A helper-only change normally needs focused tests, not browser exploration. For an operator-reported visual, crash, or interaction path, exercise that exact path through the point after the failure. Unit or shell proof alone is insufficient unless strictly stronger and explained.',
    'Do not rerun an unchanged passing check.',
    'Batch independent inspection and checks where practical. Extra progress narration and repeated discovery are not review evidence.',
    'This is an evidence obligation, not a fixed browser workflow. You may start short-lived local services for this Run; persistent Project Preview and integration are not your responsibility.',
    '',
  ]
}

function resultInstruction(responsibility: Responsibility) {
  const allowed =
    responsibility === 'planner'
      ? 'success, attention, or fail'
      : responsibility === 'generator'
        ? 'success, attention, or fail'
        : 'success, reject, attention, or fail'
  return [
    '## Required Result',
    '',
    'Replace the zero-byte Result file with exactly one JSON object:',
    '',
    '```json',
    '{"result":"success","summary":"Concise evidence-backed result","artifacts":[]}',
    '```',
    '',
    `Allowed result for this ${responsibility} Run: ${allowed}.`,
    ...(responsibility === 'planner'
      ? [
          'success = complete valid sparse proposal, including an empty proposal when the existing nonterminal Engineering DAG is already complete; fail = no valid proposal and no durable blocker needs follow-up.',
        ]
      : responsibility === 'generator'
        ? [
            'success = implementation and proof complete; fail = execution failed without a durable blocker.',
          ]
        : [
            'success = criteria pass; reject = implementation defect; fail = review failed without a durable blocker.',
          ]),
    'attention = exactly one staged blocker for Assistant follow-up.',
    'Summary is explanatory evidence, never a control protocol. Artifacts lists only proof files: use a Project-relative path for checked-in source, or an exact Run-local path for generated logs and screenshots that Coordinator must preserve. Leave it empty when no file adds evidence.',
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
  if (!STABLE_ID_PATTERN.test(value)) {
    throw new RoleContextStagingError(`Invalid ${label}: ${value}`)
  }
}

function decode(content: Uint8Array | null) {
  if (!content) throw new RoleContextStagingError('Missing staged document content')
  return new TextDecoder().decode(content)
}
