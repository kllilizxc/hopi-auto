import { chmod, copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import { EXECUTION_ENVELOPE_MARKER } from '../agent/executionEnvelope'
import type { TransportContextBundle } from '../agent/vendorTransport'
import { ASSISTANT_PREFERENCE_PATH, readAssistantPreference } from '../domain/assistantPreference'
import { goalAttentionTarget, workAttentionTarget } from '../domain/attentionTarget'
import {
  isEngineeringWork,
  isWorkTerminal,
  parseAttentionDocument,
  parseEvidenceDocument,
  parseGoalDocument,
  parseInputDocument,
  parseWorkDocument,
} from '../domain/canonicalDocuments'
import { DEFAULT_PRIMARY_REPO_ID, projectReleaseRef } from '../domain/project'
import { STABLE_ID_PATTERN } from '../domain/stableId'
import type { PublicationCoordinator } from '../publication/publisher'
import type { PublicationSnapshot, PublicationSnapshotFile } from '../publication/types'
import { createGoalPackagePaths } from '../storage/goalPackagePaths'
import {
  browserEnvironmentRoot,
  browserHarnessAdapterCommand,
  browserTargetManifest,
  resolveBrowserHarnessBackendCommand,
  resolveManagedBrowserCommand,
} from './browserEnvironment'
import type { FormalReleasePreviewContext } from './previewManager'
import { parsePortableArtifactReference } from './runArtifacts'
import { runStoragePath, runtimeCacheRoot } from './runPaths'
import { type SourceMergePreflightResult, inspectSourceMerge } from './sourceMergePreflight'

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
  formalReleasePreview?: FormalReleasePreviewContext
  previousAttempt?: {
    runId: string
    responsibility: Responsibility
    result: string | null
    application: string | null
    summary: string | null
  }
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
  artifactOutputDir: string
  proposalCapabilitiesFile: string
  resultSchemaFile: string
  primaryRepoRoot: string
  resultFile: string
  releaseHead: string
  repoReleaseHeads: Readonly<Record<string, string>>
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
  formalReleasePreview?: FormalReleasePreviewContext
  formalReleasePreviewFile?: string
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
      const artifactOutputDir = join(runRoot, 'output-artifacts')
      const resultFile = join(runRoot, 'result.json')
      const contextFile = join(runRoot, 'context.md')
      const promptFile = join(runRoot, 'prompt.md')
      const reposFile = join(runRoot, 'repos.json')
      const formalReleasePreviewFile = input.formalReleasePreview
        ? join(contextRoot, 'formal-release-preview.json')
        : undefined
      const proposalCapabilitiesFile = join(contextRoot, 'proposal-capabilities.json')
      const resultSchemaFile = join(contextRoot, 'result-schema.json')
      const browserHarnessArtifactDir = join(runRoot, 'browser-harness')
      const browserHarnessBackendCommand = resolveBrowserHarnessBackendCommand()
      const browserHarnessCommand =
        browserHarnessBackendCommand && resolveManagedBrowserCommand()
          ? browserHarnessAdapterCommand()
          : undefined
      const browserTargetsFile = browserHarnessCommand
        ? join(contextRoot, 'browser-targets.json')
        : undefined
      const runtimeScratchDir = resolve(input.runtimeScratchDir ?? join(runRoot, 'scratch'))
      const runtimeCacheDir = runtimeCacheRoot(absoluteHomeRoot)

      await rm(runRoot, { recursive: true, force: true })
      await mkdir(authorityRoot, { recursive: true })
      await mkdir(proposalRoot, { recursive: true })
      await mkdir(artifactOutputDir, { recursive: true })
      await mkdir(runtimeScratchDir, { recursive: true })
      await mkdir(runtimeCacheDir, { recursive: true })
      if (browserTargetsFile) {
        await Bun.write(browserTargetsFile, `${JSON.stringify(browserTargetManifest(), null, 2)}\n`)
      }

      const releaseRef = projectReleaseRef(input.projectId)
      const snapshot = await stableAuthoritySnapshot(publisher, paths.publicationRoot, releaseRef, {
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
      const repoReleaseHeads = Object.fromEntries(
        await Promise.all(
          repoRoots.map(async (repo) => [
            repo.repoId,
            await gitOutput(repo.path, ['rev-parse', releaseRef]),
          ]),
        ),
      )
      validateFormalReleasePreview(input.formalReleasePreview, repoReleaseHeads)
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
              candidate: await inspectCurrentCandidate(repoRoots, releaseRef, runtimeScratchDir),
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
      if (formalReleasePreviewFile && input.formalReleasePreview) {
        await Bun.write(
          formalReleasePreviewFile,
          `${JSON.stringify(input.formalReleasePreview, null, 2)}\n`,
        )
        await chmod(formalReleasePreviewFile, 0o444)
      }
      await Bun.write(
        proposalCapabilitiesFile,
        `${JSON.stringify(proposalCapabilities(input, paths), null, 2)}\n`,
      )
      await Bun.write(
        resultSchemaFile,
        `${JSON.stringify(resultSchema(input.responsibility), null, 2)}\n`,
      )
      await Promise.all([chmod(proposalCapabilitiesFile, 0o444), chmod(resultSchemaFile, 0o444)])
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
            releaseRef,
            repos: Object.fromEntries(repoRoots.map((repo) => [repo.repoId, repo.path])),
            releaseHeads: repoReleaseHeads,
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
          artifactOutputDir,
          proposalCapabilitiesFile,
          resultSchemaFile,
          runtimeScratchDir,
          runtimeCacheDir,
          releaseHead,
          releaseRef,
          repoReleaseHeads,
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
          formalReleasePreview: input.formalReleasePreview,
          formalReleasePreviewFile,
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
            artifactOutputDir,
            proposalCapabilitiesFile,
            resultSchemaFile,
            resultFile,
            bootstrapSourceRoot,
            agentsPath: paths.agentsPath,
            attentionRoot: paths.attentionRoot(input.goalId),
            primaryRepoId,
            repoRoots,
            reposFile,
            apiOrigin,
            formalReleasePreviewFile,
            operatorPreferenceFile,
            browserTargetsFile,
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
        artifactOutputDir,
        proposalCapabilitiesFile,
        resultSchemaFile,
        primaryRepoRoot: requiredPrimaryRepoRoot(repoRoots, primaryRepoId),
        resultFile,
        releaseHead,
        repoReleaseHeads,
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
        formalReleasePreview: input.formalReleasePreview,
        formalReleasePreviewFile,
        apiOrigin,
        goalFile: join(authorityRoot, ...goalPath.split('/')),
        designFile: join(authorityRoot, ...paths.designIndex(input.goalId).split('/')),
        extraReadableRoots: [...new Set(repoRoots.map((repo) => repo.path))],
        extraWritableRoots: [
          ...new Set([
            runRoot,
            artifactOutputDir,
            runtimeScratchDir,
            runtimeCacheDir,
            ...(browserHarnessCommand ? [browserEnvironmentRoot(absoluteHomeRoot)] : []),
            ...(input.responsibility === 'generator' ? repoRoots.map((repo) => repo.path) : []),
          ]),
        ],
        contextFile,
        artifactManifestFile,
        promptFile,
        outcomeFile: resultFile,
        canonicalOutcomeFile: resultFile,
        browserHarnessDir: 'scripts/hopi/browser-harness',
        browserHarnessCommand,
        browserHarnessBackendCommand: browserHarnessCommand
          ? browserHarnessBackendCommand
          : undefined,
        browserHome: browserHarnessCommand ? absoluteHomeRoot : undefined,
        browserTargetsFile,
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

function validateFormalReleasePreview(
  preview: FormalReleasePreviewContext | undefined,
  repoReleaseHeads: Readonly<Record<string, string>>,
) {
  if (!preview || preview.kind === 'not_configured') return
  const previewHeads = preview.session.releaseHeads
  const expectedEntries = Object.entries(repoReleaseHeads)
  if (
    Object.keys(previewHeads).length !== expectedEntries.length ||
    expectedEntries.some(([repoId, commit]) => previewHeads[repoId] !== commit)
  ) {
    throw new RoleContextStagingError(
      'Formal release Preview does not match the current Project release heads',
    )
  }
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
  integrations: Array<{
    repoId: string
    releaseHead: string
    taskHead: string
    mergeBase: string
    result: SourceMergePreflightResult
  }>
}

async function inspectCurrentCandidate(
  repoRoots: readonly RoleRepoRoot[],
  releaseRef: string,
  scratchRoot: string,
): Promise<CandidateInspection> {
  const files = new Set<string>()
  const unavailable: string[] = []
  const integrations: CandidateInspection['integrations'] = []
  for (const [index, repo] of repoRoots.entries()) {
    try {
      const [working, integration] = await Promise.all([
        gitOutput(repo.path, [
          'status',
          '--porcelain=v1',
          '--untracked-files=all',
          '--',
          '.',
          ':(exclude).hopi/**',
        ]),
        inspectSourceMerge({
          repoRoot: repo.path,
          taskRoot: repo.path,
          releaseRef,
          indexPath: join(scratchRoot, `integration-preflight-${index}.index`),
        }),
      ])
      const committed = await gitOutput(repo.path, [
        'diff',
        '--name-only',
        integration.releaseHead,
        integration.taskHead,
        '--',
        '.',
        ':(exclude).hopi/**',
      ])
      const indexPath = join(scratchRoot, `integration-preflight-${index}.index`)
      await rm(indexPath, { force: true })
      integrations.push({ repoId: repo.repoId, ...integration })
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
  return { files: visible, omitted: sorted.length - visible.length, unavailable, integrations }
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
  } | null
  previousAttempt: PrepareRoleContextInput['previousAttempt'] | null
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
    previousAttempt: input.previousAttempt ?? null,
  }
}

function proposalCapabilities(
  input: PrepareRoleContextInput,
  paths: ReturnType<typeof createGoalPackagePaths>,
) {
  const attention = {
    directory: paths.attentionRoot(input.goalId),
    target: workAttentionTarget(input.projectId, input.goalId, input.workId),
    fields: {
      id: 'stable-id',
      target: 'exact target above',
      createdAt: '1970-01-01T00:00:00.000Z',
      resolvedAt: null,
      notifiedAt: null,
      operatorRequest: null,
    },
  }
  if (input.responsibility !== 'planner') {
    return {
      version: 1,
      proposalRoot: '$HOPI_PROPOSAL_ROOT',
      writable: [{ type: 'targeted-attention', ...attention }],
    }
  }
  return {
    version: 1,
    proposalRoot: '$HOPI_PROPOSAL_ROOT',
    writable: [
      { type: 'design', path: `${paths.designRoot(input.goalId)}/**` },
      {
        type: 'engineering-work',
        directory: paths.workRoot(input.goalId),
        fields: {
          id: 'stable-id',
          title: 'string',
          notBefore: 'ISO timestamp or null',
          dependsOn: ['stable-id'],
          contractRevision: 'current Goal contractRevision',
          evidenceRefs: [],
          attempts: 0,
          kind: 'engineering',
          stage: 'generate',
        },
      },
      { type: 'targeted-attention', ...attention },
      { type: 'project-repo-context', path: '.hopi/docs/repos.md' },
      { type: 'missing-project-guidance-bootstrap', path: 'AGENTS.md' },
    ],
  }
}

function resultSchema(responsibility: Responsibility) {
  const results =
    responsibility === 'reviewer'
      ? ['success', 'reject', 'attention', 'fail']
      : ['success', 'attention', 'fail']
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['result', 'summary'],
    properties: {
      result: { enum: results },
      summary: { type: 'string', minLength: 1 },
      artifacts: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        default: [],
      },
    },
  }
}

function previousAttemptFacts(previous: RunAssignment['previousAttempt']) {
  if (!previous) return []
  return [
    '### Previous Application',
    '',
    `- Run: ${previous.runId}`,
    `- Responsibility: ${previous.responsibility}`,
    `- Role outcome: ${previous.result ?? 'none'}`,
    `- Application: ${previous.application ?? 'none'}`,
    `- Observed result: ${previous.summary ?? 'No summary recorded.'}`,
    '',
  ]
}

async function stableAuthoritySnapshot(
  publisher: PublicationCoordinator,
  root: { id: string; path: string },
  releaseRef: string,
  selection: { paths: string[]; prefixes: string[] },
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await gitOutput(root.path, ['rev-parse', releaseRef])
    const snapshot = await publisher.snapshotSelection(root, selection)
    const after = await gitOutput(root.path, ['rev-parse', releaseRef])
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
    artifactOutputDir: string
    proposalCapabilitiesFile: string
    resultSchemaFile: string
    runtimeScratchDir: string
    runtimeCacheDir: string
    releaseHead: string
    releaseRef: string
    repoReleaseHeads: Readonly<Record<string, string>>
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
    formalReleasePreview?: FormalReleasePreviewContext
    formalReleasePreviewFile?: string
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
    `- Primary authority release snapshot: ${context.releaseHead}`,
    `- Immutable authority root: ${context.authorityRoot}`,
    `- Writable proposal root: ${context.proposalRoot}`,
    `- Writable Run artifact output: ${context.artifactOutputDir}`,
    `- Proposal capabilities: ${context.proposalCapabilitiesFile}`,
    `- Terminal result schema: ${context.resultSchemaFile}`,
    `- Responsibility session workspace: ${context.runtimeScratchDir}`,
    `- Reusable runtime cache: ${context.runtimeCacheDir}`,
    `- Project primary Repo: ${context.primaryRepoId}`,
    `- Project source scope: ${context.projectPath}`,
    `- Repo workspace manifest: ${context.reposFile}`,
    `- Project release ref in each Repo: ${context.releaseRef}`,
    ...(context.artifactManifestFile
      ? [`- Evidence artifact manifest: ${context.artifactManifestFile}`]
      : []),
    ...(context.operatorPreference
      ? [
          `- Operator preference snapshot: ${context.operatorPreference.path} (${context.operatorPreference.digest})`,
        ]
      : []),
    ...(context.apiOrigin ? [`- HOPI public API origin: ${context.apiOrigin}`] : []),
    ...(context.formalReleasePreviewFile
      ? [`- Formal release Preview snapshot: ${context.formalReleasePreviewFile}`]
      : []),
    ...context.repoRoots.map((repo) =>
      [
        `- Repo ${repo.repoId}${repo.primary ? ' (primary)' : ''}: ${repo.path}`,
        `  Release head: ${context.repoReleaseHeads[repo.repoId] ?? 'unavailable'}`,
      ].join('\n'),
    ),
    ...(context.bootstrapSourceRoot
      ? [`- Read-only bootstrap source snapshot: ${context.bootstrapSourceRoot}`]
      : []),
    ...formalReleasePreviewContextLines(context.formalReleasePreview),
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

function formalReleasePreviewContextLines(preview: FormalReleasePreviewContext | undefined) {
  if (!preview) return []
  if (preview.kind === 'not_configured') {
    return ['', '## Formal Release Preview', '', '- Project Preview capability: not configured']
  }
  return [
    '',
    '## Formal Release Preview',
    '',
    `- Session: ${preview.session.sessionId}`,
    `- Status: ${preview.session.status}`,
    `- Log: ${preview.session.logPath}`,
    ...Object.entries(preview.session.releaseHeads).map(
      ([repoId, commit]) => `- Release ${repoId}: ${commit}`,
    ),
    ...(preview.session.surfaces.length > 0
      ? preview.session.surfaces.map(
          (surface) => `- Surface ${surface.id} (${surface.label}): ${surface.url}`,
        )
      : ['- Surfaces: none']),
    ...(preview.session.error ? [`- Error: ${preview.session.error}`] : []),
  ]
}

function renderResponsibilityPrompt(
  input: PrepareRoleContextInput,
  paths: {
    runRoot: string
    contextFile: string
    artifactManifestFile?: string
    authorityRoot: string
    proposalRoot: string
    artifactOutputDir: string
    proposalCapabilitiesFile: string
    resultSchemaFile: string
    resultFile: string
    bootstrapSourceRoot?: string
    agentsPath: string
    attentionRoot: string
    primaryRepoId: string
    repoRoots: readonly RoleRepoRoot[]
    reposFile: string
    apiOrigin?: string
    formalReleasePreviewFile?: string
    operatorPreferenceFile?: string
    browserTargetsFile?: string
    hasImages: boolean
  },
  assignment: RunAssignment,
) {
  const boundary = [
    '## Execution Boundary',
    '',
    'Current execution environment:',
    EXECUTION_ENVELOPE_MARKER,
    '',
    `Working directory: ${input.responsibility === 'generator' ? '$HOPI_PRIMARY_REPO_ROOT' : '$HOPI_SESSION_WORKSPACE'}`,
    'Authority root: $HOPI_AUTHORITY_ROOT',
    'Proposal root: $HOPI_PROPOSAL_ROOT',
    'Proposal capabilities: $HOPI_PROPOSAL_CAPABILITIES_FILE',
    'Context manifest: $HOPI_CONTEXT_FILE',
    'Terminal result: $HOPI_OUTCOME_FILE',
    'Terminal result schema: $HOPI_RESULT_SCHEMA_FILE',
    'Run artifact output: $HOPI_ARTIFACT_DIR',
    'Repo roots and release heads: $HOPI_REPOS_FILE',
    'Run scratch: $HOPI_RUN_SCRATCH',
    'Shared cache: $HOPI_CACHE_DIR',
    ...(paths.artifactManifestFile ? ['Evidence artifacts: $HOPI_EVIDENCE_ARTIFACTS_FILE'] : []),
    ...(paths.formalReleasePreviewFile
      ? ['Formal release Preview: $HOPI_FORMAL_RELEASE_PREVIEW_FILE']
      : []),
    `Project guidance: ${paths.agentsPath}`,
    `Primary Repo: ${paths.primaryRepoId}`,
    'Primary Repo root: $HOPI_PRIMARY_REPO_ROOT',
    'Browser harness, when installed: $HOPI_BROWSER_HARNESS_COMMAND',
    ...(paths.browserTargetsFile ? ['Browser targets: $HOPI_BROWSER_TARGETS_FILE'] : []),
    'Browser artifacts: $HOPI_BROWSER_HARNESS_ARTIFACT_DIR',
    ...(paths.operatorPreferenceFile
      ? ['Operator preferences: $HOPI_OPERATOR_PREFERENCE_FILE']
      : []),
    ...(paths.apiOrigin ? ['HOPI API: $HOPI_API_ORIGIN'] : []),
    '',
    'Authority and evidence are immutable. Proposal is a sparse overlay: an absent path is unchanged; deletion is unsupported.',
    'Coordinator alone changes canonical control state, Evidence, HOPI-managed Git metadata, checkpoints, and integration refs.',
    '$HOPI_REPOS_FILE is the complete Project source-root map. Source outside those roots and another Work runtime is outside this assignment.',
    'A started command remains active until it exits or is cancelled; delayed output is not failure and must not trigger an equivalent concurrent command.',
    ...(paths.hasImages
      ? ['Attached images are Goal assets with their authority-defined purpose.']
      : []),
    'External effects require explicit Work or operator authority.',
    '',
  ]
  const responsibility =
    input.responsibility === 'planner'
      ? plannerPrompt(paths)
      : input.responsibility === 'generator'
        ? generatorPrompt()
        : reviewerPrompt(input.projectId)
  const current = renderCurrentAssignment(input.responsibility, assignment)
  return [
    '# HOPI Responsibility Run',
    '',
    ...assignmentSection('primary-task', current.primary),
    ...assignmentSection('execution-boundary', boundary),
    ...assignmentSection('responsibility', responsibility),
    ...assignmentSection('supporting-authority', [
      ...current.supporting,
      ...previousAttemptFacts(assignment.previousAttempt),
    ]),
    ...assignmentSection('required-result', [
      '## Result',
      '',
      'Write one object matching $HOPI_RESULT_SCHEMA_FILE to $HOPI_OUTCOME_FILE.',
      '',
    ]),
  ].join('\n')
}

function assignmentSection(id: string, content: readonly string[]) {
  return [
    `<!-- HOPI_ASSIGNMENT_SECTION_BEGIN:${id} -->`,
    ...content,
    `<!-- HOPI_ASSIGNMENT_SECTION_END:${id} -->`,
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
          '### Latest Owning Work Evidence (Historical Run Result)',
          `Source: ${assignment.latestEvidence.path}`,
          'This records the producing Run; current candidate and release state are reported separately below.',
          '',
          '<latest-evidence>',
          assignment.latestEvidence.body.trim(),
          '</latest-evidence>',
          ...(assignment.latestEvidence.artifacts.length > 0
            ? [
                '',
                '#### Current Reproducer Artifacts',
                '',
                'Current-Run copies of referenced artifacts:',
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
  if (
    repairView.candidate.files.length === 0 &&
    repairView.candidate.unavailable.length === 0 &&
    repairView.candidate.integrations.length === 0
  ) {
    return []
  }
  return [
    '',
    '### Current Repair View (Diagnostics, Not Authority)',
    '',
    'Current candidate integration preflight:',
    ...repairView.candidate.integrations.flatMap((integration) => [
      `- Repo ${integration.repoId}`,
      `  - Release head: ${integration.releaseHead}`,
      `  - Task head: ${integration.taskHead}`,
      `  - Merge base: ${integration.mergeBase}`,
      ...(integration.result.kind === 'ready'
        ? ['  - Result: ready']
        : integration.result.kind === 'conflict'
          ? [
              '  - Result: conflict',
              ...integration.result.paths.map((path) => `  - Conflict path: ${path}`),
            ]
          : ['  - Result: failed', `  - Diagnostic: ${integration.result.detail}`]),
    ]),
    ...(repairView.candidate.integrations.length === 0
      ? ['- No Repo integration preflight available.']
      : []),
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
  ]
}

function plannerPrompt(paths: {
  runRoot: string
  proposalRoot: string
  bootstrapSourceRoot?: string
  agentsPath: string
  attentionRoot: string
  apiOrigin?: string
  formalReleasePreviewFile?: string
  operatorPreferenceFile?: string
}) {
  return [
    '## Planner',
    '',
    'Owned outcome: the smallest complete Engineering DAG and durable design that deliver the current Goal.',
    'Goal authority and source are read-only.',
    ...(paths.operatorPreferenceFile
      ? ['Operator preferences are defaults below current Input and Project/Goal authority.']
      : []),
    ...(paths.formalReleasePreviewFile
      ? [
          'Goal completion evidence comes from the supplied formal release Preview at its listed release heads.',
        ]
      : []),
    'Run-produced proof may bind current content digests but cannot predict the checkpoint commit Coordinator creates after the Run; Coordinator Evidence owns that commit identity.',
    ...(paths.bootstrapSourceRoot
      ? ['Read-only bootstrap source: $HOPI_BOOTSTRAP_SOURCE_ROOT']
      : []),
    '',
  ]
}

function generatorPrompt() {
  return [
    '## Generator',
    '',
    'Owned outcome: implement the complete Engineering Work and return observed evidence.',
    'Generator success advances the Work to Reviewer; it does not require prior Reviewer acceptance.',
    'The Project source roots are writable. Canonical .hopi state and HOPI-managed Git metadata are Coordinator-owned and immutable.',
    'The staged authority is current for this Run; Public Preview, when present, observes the integrated release rather than this candidate.',
    '',
  ]
}

function reviewerPrompt(projectId: string) {
  const releaseRef = projectReleaseRef(projectId)
  return [
    '## Reviewer',
    '',
    'Owned outcome: independently determine whether the Engineering Work satisfies its accepted contract and material integrity and safety obligations.',
    `Candidate source is the cumulative delta from git merge-base ${releaseRef} HEAD to HEAD.`,
    'Source, Project documents, canonical .hopi state, and Git metadata are read-only.',
    'Public Preview, when present, observes the integrated release rather than this candidate.',
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
