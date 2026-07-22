import { chmod, copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import { EXECUTION_ENVELOPE_MARKER } from '../agent/executionEnvelope'
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
  previousGenerator?: PreviousGeneratorObservation | null
}

export interface PreviousGeneratorObservation {
  runId: string
  summary: string | null
  commands: readonly PreviousGeneratorCommand[]
}

export interface PreviousGeneratorCommand {
  command: string
  outcome: 'completed' | 'failed' | 'unfinished'
}

export interface RoleRepoRoot {
  repoId: string
  path: string
  primary: boolean
}

export interface RoleContextBundle extends TransportContextBundle {
  runRoot: string
  contextRoot: string
  authorityRoot: string
  proposalRoot: string
  attentionProposalDir: string
  primaryRepoRoot: string
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
      const resolvedEvidenceArtifacts = await resolveEvidenceArtifacts(
        absoluteHomeRoot,
        authorityFiles,
        paths,
        input.goalId,
      )
      const evidenceArtifacts = await projectEvidenceArtifacts(
        resolvedEvidenceArtifacts,
        contextRoot,
      )
      const artifactManifestFile =
        evidenceArtifacts.length > 0 ? join(contextRoot, 'evidence-artifacts.json') : undefined
      const repairView =
        input.responsibility === 'generator'
          ? {
              candidate: await inspectCurrentCandidate(repoRoots),
              previousGenerator: input.previousGenerator ?? null,
            }
          : null
      const assignment = createRunAssignment(
        input,
        paths,
        parsedGoal,
        parsedWork,
        authorityFiles,
        evidenceArtifacts,
        repairView,
      )
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
        authorityRoot,
        proposalRoot,
        attentionProposalDir: join(proposalRoot, ...paths.attentionRoot(input.goalId).split('/')),
        primaryRepoRoot: requiredPrimaryRepoRoot(repoRoots, primaryRepoId),
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

function requiredPrimaryRepoRoot(repoRoots: readonly RoleRepoRoot[], primaryRepoId: string) {
  const primary =
    repoRoots.find((repo) => repo.primary) ??
    repoRoots.find((repo) => repo.repoId === primaryRepoId) ??
    repoRoots[0]
  if (!primary) throw new RoleContextStagingError('Responsibility Repo workspace must not be empty')
  return primary.path
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

interface ProjectedEvidenceArtifact {
  reference: string
  path: string
  evidence: string[]
}

async function projectEvidenceArtifacts(
  artifacts: Awaited<ReturnType<typeof resolveEvidenceArtifacts>>,
  contextRoot: string,
): Promise<ProjectedEvidenceArtifact[]> {
  if (artifacts.length === 0) return []
  const projectionRoot = join(contextRoot, 'evidence-artifacts')
  await mkdir(projectionRoot, { recursive: true })
  return Promise.all(
    artifacts.map(async (artifact, index) => {
      const parsed = parsePortableArtifactReference(artifact.reference)
      if (!parsed) {
        throw new RoleContextStagingError(
          `Invalid portable Evidence artifact reference: ${artifact.reference}`,
        )
      }
      const basename = posix.basename(parsed.artifactPath).replaceAll(/[^A-Za-z0-9._-]/g, '_')
      const path = join(
        projectionRoot,
        `${String(index + 1).padStart(3, '0')}-${basename || 'artifact'}`,
      )
      await copyFile(artifact.path, path)
      await chmod(path, 0o444)
      return { reference: artifact.reference, path, evidence: artifact.evidence }
    }),
  )
}

interface CandidateInspection {
  files: string[]
  omitted: number
  unavailable: string[]
}

async function inspectCurrentCandidate(
  repoRoots: readonly RoleRepoRoot[],
): Promise<CandidateInspection> {
  const files = new Set<string>()
  const unavailable: string[] = []
  for (const repo of repoRoots) {
    try {
      const [committed, working] = await Promise.all([
        gitOutput(repo.path, [
          'diff',
          '--name-only',
          HOPI_RELEASE_REF,
          'HEAD',
          '--',
          '.',
          ':(exclude).hopi/**',
        ]),
        gitOutput(repo.path, [
          'status',
          '--porcelain=v1',
          '--untracked-files=all',
          '--',
          '.',
          ':(exclude).hopi/**',
        ]),
      ])
      for (const path of committed.split('\n').filter(Boolean)) files.add(`${repo.repoId}:${path}`)
      for (const line of working.split('\n').filter(Boolean)) {
        const path = line.slice(3).trim().split(' -> ').at(-1)
        if (path) files.add(`${repo.repoId}:${path}`)
      }
    } catch (error) {
      unavailable.push(`${repo.repoId}: ${errorMessage(error).slice(0, 500)}`)
    }
  }
  const sorted = [...files].sort()
  const visible = sorted.slice(0, 80)
  return { files: visible, omitted: sorted.length - visible.length, unavailable }
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
  latestEvidence: {
    path: string
    body: string
    artifacts: Array<{ reference: string; path: string }>
  } | null
  repairView: {
    candidate: CandidateInspection
    previousGenerator: PreviousGeneratorObservation | null
  } | null
}

function createRunAssignment(
  input: PrepareRoleContextInput,
  paths: ReturnType<typeof createGoalPackagePaths>,
  goal: ReturnType<typeof parseGoalDocument>,
  work: ReturnType<typeof parseWorkDocument>,
  authorityFiles: readonly PublicationSnapshotFile[],
  evidenceArtifacts: readonly ProjectedEvidenceArtifact[],
  repairView: RunAssignment['repairView'],
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
          artifacts: evidenceArtifacts
            .filter((artifact) => artifact.evidence.includes(latestEvidencePath))
            .map(({ reference, path }) => ({ reference, path })),
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
    repairView,
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
    '[Current execution environment observation]',
    EXECUTION_ENVELOPE_MARKER,
    '',
    `Working directory: ${input.responsibility === 'generator' ? '$HOPI_PRIMARY_REPO_ROOT' : '$HOPI_SESSION_WORKSPACE'}`,
    'Authority root: $HOPI_AUTHORITY_ROOT',
    'Proposal root: $HOPI_PROPOSAL_ROOT',
    'Result file: $HOPI_OUTCOME_FILE',
    'Audit manifest: $HOPI_CONTEXT_FILE',
    ...(paths.artifactManifestFile
      ? ['Evidence artifact manifest: $HOPI_EVIDENCE_ARTIFACTS_FILE']
      : []),
    'Repo manifest: $HOPI_REPOS_FILE',
    'Attention proposal directory: $HOPI_ATTENTION_PROPOSAL_DIR',
    `Project guidance: ${paths.agentsPath}`,
    'Repo preparation entrypoints: resolve each listed Repo root from $HOPI_REPOS_FILE, then use <root>/scripts/hopi/prepare',
    `Primary Repo: ${paths.primaryRepoId}`,
    'Primary Repo root: $HOPI_PRIMARY_REPO_ROOT',
    'Source roots: the complete mapping in $HOPI_REPOS_FILE',
    ...(paths.operatorPreferenceFile
      ? ['Operator preference snapshot: $HOPI_OPERATOR_PREFERENCE_FILE']
      : []),
    ...(paths.apiOrigin ? ['Public Preview API origin: $HOPI_API_ORIGIN'] : []),
    '',
    'Authority is immutable. Proposal is an initially empty sparse overlay: create only added or replaced control documents and their parent directories. Absence means unchanged; deletion is unsupported.',
    'Coordinator alone validates proposals, changes control state, writes Evidence, updates evidenceRefs, and owns HOPI-managed task Git metadata, checkpoints, and integration refs.',
    'The Repo manifest is the complete source-root map. Never infer Repo identity from directory names or inspect sibling, historical, or other Work runtime directories.',
    'Use $HOPI_RUN_SCRATCH for retained files and $HOPI_CACHE_DIR for caches; evidence requires a retained file or log.',
    ...(paths.hasImages
      ? [
          'Attached images correspond only to Goal assets cited by the owning Work. Apply their documented purpose and limits.',
        ]
      : []),
    'Never create or edit evidence/** or append evidenceRefs. The final response is the only Run outcome; the adapter persists it as result.json and Coordinator derives immutable Evidence from it.',
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
  const current = renderCurrentAssignment(input.responsibility, assignment)
  return [
    '# HOPI Responsibility Run',
    '',
    ...assignmentSection('primary-task', current.primary),
    ...assignmentSection('execution-boundary', boundary),
    ...assignmentSection('responsibility', responsibility),
    ...assignmentSection('supporting-authority', current.supporting),
    ...assignmentSection('required-result', resultInstruction(input.responsibility)),
  ].join('\n')
}

function assignmentSection(id: string, content: readonly string[]) {
  return [
    `<!-- HOPI_ASSIGNMENT_SECTION_BEGIN:${id} -->`,
    ...content,
    `<!-- HOPI_ASSIGNMENT_SECTION_END:${id} -->`,
  ]
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
          ...(assignment.latestEvidence.artifacts.length > 0
            ? [
                '',
                '#### Current Reproducer Artifacts',
                '',
                'Use these current-Run copies instead of remembered or Evidence-embedded historical Run paths:',
                ...assignment.latestEvidence.artifacts.map(
                  (artifact) => `- ${artifact.reference} -> ${artifact.path}`,
                ),
              ]
            : []),
        ]
      : []),
    ...renderRepairView(assignment.repairView),
    '',
  ]
  return { primary, supporting }
}

function renderRepairView(repairView: RunAssignment['repairView']) {
  if (!repairView) return []
  const previous = repairView.previousGenerator
  if (
    !previous &&
    repairView.candidate.files.length === 0 &&
    repairView.candidate.unavailable.length === 0
  ) {
    return []
  }
  return [
    '',
    '### Current Repair View (Diagnostics, Not Authority)',
    '',
    'Changed files relative to the current release base:',
    ...(repairView.candidate.files.length > 0
      ? repairView.candidate.files.map((path) => `- ${path}`)
      : ['- No candidate changes observed.']),
    ...(repairView.candidate.omitted > 0
      ? [`- … ${repairView.candidate.omitted} additional changed files omitted.`]
      : []),
    ...(repairView.candidate.unavailable.length > 0
      ? [
          'Candidate inspection diagnostics:',
          ...repairView.candidate.unavailable.map((diagnostic) => `- ${diagnostic}`),
        ]
      : []),
    '',
    ...(previous
      ? [
          `Previous Generator Attempt: ${previous.runId}`,
          `Previous claimed summary (not proof): ${previous.summary ?? 'No terminal summary was recorded.'}`,
          'Observed execution commands:',
          ...(previous.commands.length > 0
            ? previous.commands.map((command) => `- [${command.outcome}] ${command.command}`)
            : ['- No command execution was observed.']),
        ]
      : ['Previous Generator Attempt: none.', 'Observed execution commands: none.']),
  ]
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
    'Objective: turn the current Goal contract, accepted Input, design, and source facts into the smallest complete Engineering DAG and durable design needed to deliver the Goal.',
    'Goal authority is immutable in this responsibility. Proposal is the only publication channel and may contain design/**, Engineering Work, Attention, .hopi/docs/repos.md, and an allowed AGENTS.md bootstrap. Coordinator validates and publishes it.',
    ...(paths.operatorPreferenceFile
      ? [
          'Operator preferences are defaults below current accepted Input and Project/Goal authority.',
        ]
      : []),
    'Durable decisions belong in design/**. Each Engineering Work owns one cohesive proof boundary, is standalone in outcome and acceptance, names only required Repos, and depends only on required output, overlapping writers, or exclusive resources.',
    'Existing nonterminal Work retains identity, dependency and Evidence history. Terminal Work and Planning Work are immutable. A Work ID owns one cumulative source lineage.',
    'When the accepted plan makes existing nonterminal Engineering Work obsolete, preserve its document and change only stage to cancelled. Coordinator expands cancellation through all nonterminal dependents. New or retained Work must not depend on cancelled Work.',
    'Public Preview observes only the integrated release and is not Engineering Work acceptance evidence. Planner may use it for final integrated proof when the accepted design requires that proof.',
    'Attention represents a durable blocker that this responsibility and retry cannot clear. Target-null Attention represents Goal completion; targeted Attention and nonterminal Engineering Work are mutually exclusive with completion.',
    'Goal assets remain durable only through their exact Goal asset paths and documented purpose. Repo responsibilities and shared contracts have one canonical owner.',
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
    ...(paths.apiOrigin ? ['The Public Preview API is available at $HOPI_API_ORIGIN.'] : []),
    'Planner working directory is not a Git checkout. Source and Authority are read-only; sparse proposal paths are canonical-relative beneath Proposal root.',
    ...(paths.bootstrapSourceRoot
      ? [
          'Project guidance is absent; derive a concise AGENTS.md entrypoint from the read-only source snapshot at $HOPI_BOOTSTRAP_SOURCE_ROOT.',
        ]
      : ['Project guidance already exists and is read-only in this responsibility.']),
    'Every selected Repo owns its own scripts/hopi/prepare contract; preparation delivery belongs to the Engineering Work that needs that Repo.',
    '',
  ]
}

function generatorPrompt() {
  return [
    '## Generator',
    '',
    'Objective: implement the complete owning Engineering Work in its stable task worktree and provide proportionate evidence for every materially affected acceptance criterion.',
    'The accepted Work and durable design define scope. Reviewer findings are evidence about violated invariants; the owning invariant, its canonical representation, and materially adjacent variants define the repair boundary.',
    'Project guidance, Repo manifest, preparation entrypoints, accepted Inputs, and latest Evidence are environment knowledge for this Run. Each selected Repo owns its own scripts/hopi/prepare contract.',
    'Candidate runtime proof belongs to the task worktree and Run manifest. Public Project Preview observes the integrated release, not this candidate.',
    'scripts/hopi/preview readiness is exactly one HOPI_PREVIEW_URL=<reachable-url> line after the service is ready.',
    'The staged canonical context overrides any older .hopi copy in the task branch.',
    '.hopi, canonical documents, the task worktree Git index/HEAD/branch, and shared Git metadata are Coordinator-owned and immutable here. Coordinator checkpoints source edits after the Run.',
    'External effects such as merge, deploy, production-data mutation, or delivery outside the Work require explicit Work or operator authority. Run-owned clones under $HOPI_RUN_SCRATCH are available for authorized branch or PR delivery.',
    '',
  ]
}

function reviewerPrompt() {
  return [
    '## Reviewer',
    '',
    'Objective: independently determine whether the owning Work satisfies its accepted contract and material integrity or safety obligations, using the strongest proportionate evidence.',
    `The candidate is the Work's cumulative delta from git merge-base ${HOPI_RELEASE_REF} HEAD to HEAD. Release-only commits, canonical .hopi movement, persistent Preview, and integration belong to Coordinator or Planner rather than this review.`,
    'Source, ordinary project documents, .hopi, and Git metadata are read-only in this responsibility.',
    'Rejection is bounded by the accepted contract and material risk. Presentation preferences and hypothetical inputs outside an accepted grammar do not expand the contract into unlimited validation.',
    'A reproducible rejection identifies the violated invariant, exact command and input or deterministic inspection, and observed failure. Observational findings state their evidence boundary without inventing a reproducer.',
    'Project guidance, preparation, Repo manifest, existing checks, candidate runtime, and browser stack are available evidence sources. Public Project Preview is not candidate evidence.',
    'scripts/hopi/preview readiness is exactly one HOPI_PREVIEW_URL=<reachable-url> line after startup is ready.',
    'Attention represents missing authority or resources that this responsibility cannot clear; it is not a substitute for an implementation defect or an evidence-backed verdict.',
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
    'Progress messages and the terminal outcome are different protocol surfaces. Progress, when emitted, is non-authoritative ordinary prose; it never uses the result schema or claims a Run result.',
    'After all execution settles, finish by emitting exactly one JSON object matching this schema as the final response:',
    '',
    '```json',
    '{"result":"<choose one allowed result>","summary":"Concise evidence-backed result","artifacts":[]}',
    '```',
    '',
    `Allowed result for this ${responsibility} Run: ${allowed}.`,
    ...(responsibility === 'planner'
      ? [
          'success = complete valid sparse proposal, including an empty proposal when the existing nonterminal Engineering DAG is already complete; fail = no valid proposal and no durable blocker needs follow-up.',
        ]
      : responsibility === 'generator'
        ? [
            'success = implementation and observed proof complete; unexecuted edits or claims are not success. fail = execution failed without a durable blocker.',
          ]
        : [
            'success = criteria pass; reject = implementation defect; fail = review failed without a durable blocker.',
          ]),
    'attention = exactly one staged blocker for Assistant follow-up.',
    'The interactive adapter validates and persists this terminal object as the Run-local result.json; do not end with prose, a plan-approval request, or a promised later file write.',
    'This responsibility is already authorized to execute its assignment. Do not enter a vendor plan-approval mode or ask an interactive user question; use targeted Attention only for authority that cannot be inferred or executed.',
    'Summary is explanatory evidence, never a control protocol. Artifacts lists only proof files: use a Project-relative path for checked-in source, or an exact Run-local path for generated logs and screenshots that Coordinator must preserve. Leave it empty when no file adds evidence.',
    '',
  ]
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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
