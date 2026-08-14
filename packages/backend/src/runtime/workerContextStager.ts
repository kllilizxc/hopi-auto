import { chmod, cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import type { TransportContextBundle } from '../agent/vendorTransport'
import { ASSISTANT_PREFERENCE_PATH, readAssistantPreference } from '../domain/assistantPreference'
import { goalAttentionTarget, workAttentionTarget } from '../domain/attentionTarget'
import {
  type WorkOwnerMessage,
  isWorkTerminal,
  parseAttentionDocument,
  parseEvidenceDocument,
  parseGoalDocument,
  parseInputDocument,
  parseWorkDocument,
} from '../domain/canonicalDocuments'
import { projectReleaseRef } from '../domain/project'
import { STABLE_ID_PATTERN } from '../domain/stableId'
import type { PublicationCoordinator } from '../publication/publisher'
import type { PublicationSnapshotFile } from '../publication/types'
import { createGoalPackagePaths } from '../storage/goalPackagePaths'
import {
  browserEnvironmentRoot,
  browserHarnessAdapterCommand,
  browserTargetManifest,
  hasManagedBrowserConfiguration,
  resolveBrowserHarnessBackendCommand,
} from './browserEnvironment'
import { parsePortableArtifactReference } from './runArtifacts'
import { runStoragePath, runtimeCacheRoot } from './runPaths'
import type { RunWorkspaceMode } from './runRequest'
import { type SourceMergePreflightResult, inspectSourceMerge } from './sourceMergePreflight'
import { renderContextManifest, renderWorkerPrompt } from './workerContextRendering'

export interface PrepareWorkerContextInput {
  projectRoot: string
  projectPath?: string
  projectId: string
  goalId: string
  workId: string
  runId: string
  workspaceMode: RunWorkspaceMode
  instructionMarkdown: string
  refs: readonly string[]
  primaryRepoId: string
  repoRoots: readonly WorkerRepoRoot[]
  apiOrigin?: string
  runtimeScratchDir?: string
  previousAttempt?: {
    runId: string
    termination: string
    reportMarkdown: string
  }
}

export interface WorkerRepoRoot {
  repoId: string
  path: string
  primary: boolean
}

export interface WorkerContextBundle extends TransportContextBundle {
  runRoot: string
  contextRoot: string
  authorityRoot: string
  artifactOutputDir: string
  primaryRepoRoot: string
  reportFile: string
  releaseHead: string
  repoReleaseHeads: Readonly<Record<string, string>>
  repoProjectionHeads: Readonly<Record<string, string>>
  repoProjection: 'candidate' | 'release'
  goalHash: string
  workHash: string
  authorityFiles: readonly Pick<PublicationSnapshotFile, 'path' | 'hash'>[]
  guardFiles: Readonly<Record<string, string | null>>
  guardPrefixes: readonly string[]
  bootstrapSourceRoot?: string
  agentsPath?: string
  operatorPreferenceFile?: string
  repoRoots: readonly WorkerRepoRoot[]
  reposFile: string
}

export interface WorkerContextStager {
  prepare(input: PrepareWorkerContextInput): Promise<WorkerContextBundle>
}

export class WorkerContextStagingError extends Error {}

export function createWorkerContextStager(
  homeRoot: string,
  publisher: PublicationCoordinator,
): WorkerContextStager {
  const absoluteHomeRoot = resolve(homeRoot)

  return {
    async prepare(input) {
      assertStableId(input.projectId, 'projectId')
      assertStableId(input.goalId, 'goalId')
      assertStableId(input.workId, 'workId')
      assertStableId(input.runId, 'runId')

      const projectRoot = resolve(input.projectRoot)
      const apiOrigin = input.apiOrigin ? normalizeApiOrigin(input.apiOrigin) : undefined
      const primaryRepoId = input.primaryRepoId
      assertStableId(primaryRepoId, 'primaryRepoId')
      const repoRoots = normalizeRepoRoots(input.repoRoots, primaryRepoId)
      const repoGuidance = await discoverRepoGuidance(repoRoots)
      const paths = createGoalPackagePaths(projectRoot, input.projectId, input.projectPath)
      const runRoot = runStoragePath(absoluteHomeRoot, input.runId)
      const contextRoot = join(runRoot, 'context')
      const authorityRoot = join(contextRoot, 'authority')
      const artifactOutputDir = join(runRoot, 'output-artifacts')
      const reportFile = join(runRoot, 'report.md')
      const contextFile = join(runRoot, 'context.md')
      const promptFile = join(runRoot, 'prompt.md')
      const reposFile = join(runRoot, 'repos.json')
      const browserHarnessArtifactDir = join(runRoot, 'browser-harness')
      const browserHarnessBackendCommand = resolveBrowserHarnessBackendCommand()
      const browserHarnessCommand =
        browserHarnessBackendCommand && hasManagedBrowserConfiguration()
          ? browserHarnessAdapterCommand()
          : undefined
      const browserTargetsFile = browserHarnessCommand
        ? join(contextRoot, 'browser-targets.json')
        : undefined
      const runtimeScratchDir = resolve(input.runtimeScratchDir ?? join(runRoot, 'scratch'))
      const runtimeCacheDir = runtimeCacheRoot(absoluteHomeRoot)

      await mkdir(runRoot, { recursive: true })
      await Promise.all(
        [
          contextRoot,
          artifactOutputDir,
          reportFile,
          contextFile,
          promptFile,
          reposFile,
          browserHarnessArtifactDir,
        ].map((path) => rm(path, { recursive: true, force: true })),
      )
      await mkdir(authorityRoot, { recursive: true })
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
      const repoProjection = input.workspaceMode === 'none' ? 'release' : 'candidate'
      const repoProjectionHeads = Object.fromEntries(
        await Promise.all(
          repoRoots.map(async (repo) => [
            repo.repoId,
            await gitOutput(repo.path, ['rev-parse', 'HEAD']),
          ]),
        ),
      )
      const goalPath = paths.goalDocument(input.goalId)
      const workPath = paths.workDocument(input.goalId, input.workId)
      const goalFile = requiredSnapshotFile(snapshot.files, goalPath)
      const workFile = requiredSnapshotFile(snapshot.files, workPath)
      const parsedGoal = parseGoalDocument(decode(goalFile.content))
      const parsedWork = parseWorkDocument(decode(workFile.content))
      if (parsedWork.attributes.id !== input.workId) {
        throw new WorkerContextStagingError(
          `Work path ${workPath} owns ${parsedWork.attributes.id}, expected ${input.workId}`,
        )
      }
      const referencedImages = collectReferencedImages(parsedWork, paths, input.goalId)
      const availableReferencedImages = new Set(
        [...referencedImages].filter((imagePath) => {
          const file = snapshot.files.find((candidate) => candidate.path === imagePath)
          return Boolean(file?.content && file.hash)
        }),
      )
      const unavailableReferencedImages = [...referencedImages]
        .filter((imagePath) => !availableReferencedImages.has(imagePath))
        .map((imagePath) => ({
          reference: imagePath,
          evidence: [workPath],
          reason: 'The referenced Goal asset is unavailable in current authority.',
        }))
      const guardFiles = Object.freeze({
        ...selectGuardFiles(input, snapshot.files, paths, parsedWork),
        ...Object.fromEntries(
          [...referencedImages].map((imagePath) => [
            imagePath,
            snapshot.files.find((file) => file.path === imagePath)?.hash ?? null,
          ]),
        ),
      })
      const guardPrefixes = [paths.designRoot(input.goalId)]
      const authorityFiles = snapshot.files.filter((file) => Object.hasOwn(guardFiles, file.path))
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
        resolvedEvidenceArtifacts.available,
        contextRoot,
      )
      const unavailableMaterial = [
        ...resolvedEvidenceArtifacts.unavailable,
        ...unavailableReferencedImages,
      ]
      const artifactManifestFile =
        evidenceArtifacts.length > 0 || unavailableMaterial.length > 0
          ? join(contextRoot, 'evidence-artifacts.json')
          : undefined
      const repairView =
        input.workspaceMode === 'isolated_write'
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
        unavailableMaterial,
        repairView,
      )
      const operatorPreference = await snapshotOperatorPreference(publisher, absoluteHomeRoot)
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
        const unavailable =
          unavailableMaterial.length > 0 ? { unavailable: unavailableMaterial } : {}
        await Bun.write(
          artifactManifestFile,
          `${JSON.stringify({ artifacts: evidenceArtifacts, ...unavailable }, null, 2)}\n`,
        )
        await chmod(artifactManifestFile, 0o444)
      }
      const imageFiles = [...availableReferencedImages].map((imagePath) =>
        join(authorityRoot, ...imagePath.split('/')),
      )

      const agentsFile = snapshot.files.find((file) => file.path === paths.agentsPath)
      let bootstrapSourceRoot: string | undefined
      if (agentsFile?.content === null) {
        bootstrapSourceRoot = join(contextRoot, 'source')
        await stageTrackedSource(projectRoot, releaseHead, bootstrapSourceRoot, paths.projectPath)
      }

      await Bun.write(
        reposFile,
        `${JSON.stringify(
          {
            projection: repoProjection,
            primaryRepoId,
            releaseRef,
            repos: Object.fromEntries(repoRoots.map((repo) => [repo.repoId, repo.path])),
            releaseHeads: repoProjectionHeads,
            guidance: Object.fromEntries(
              repoGuidance.map((guidance) => [guidance.repoId, guidance.path]),
            ),
          },
          null,
          2,
        )}\n`,
      )

      await Bun.write(
        contextFile,
        renderContextManifest(input, {
          authorityRoot,
          artifactOutputDir,
          runtimeScratchDir,
          runtimeCacheDir,
          releaseHead,
          releaseRef,
          repoReleaseHeads,
          repoProjectionHeads,
          repoProjection,
          snapshot: authorityFiles,
          evidencePaths,
          artifactManifestFile,
          bootstrapSourceRoot,
          imagePaths: [...availableReferencedImages],
          primaryRepoId,
          repoRoots,
          repoGuidance,
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
        renderWorkerPrompt(
          input,
          {
            contextFile,
            artifactManifestFile,
            agentsPath: paths.agentsPath,
            primaryRepoId,
            repoGuidance,
            apiOrigin,
            operatorPreferenceFile,
            browserTargetsFile,
          },
          assignment,
        ),
      )
      await Bun.write(reportFile, '')

      return {
        runtimeScratchDir,
        runtimeCacheDir,
        runRoot,
        contextRoot,
        authorityRoot,
        artifactOutputDir,
        primaryRepoRoot: requiredPrimaryRepoRoot(repoRoots, primaryRepoId),
        reportFile,
        releaseHead,
        repoReleaseHeads,
        repoProjectionHeads,
        repoProjection,
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
            artifactOutputDir,
            runtimeScratchDir,
            runtimeCacheDir,
            ...(browserHarnessCommand ? [browserEnvironmentRoot(absoluteHomeRoot)] : []),
            ...(input.workspaceMode === 'isolated_write' ? repoRoots.map((repo) => repo.path) : []),
          ]),
        ],
        contextFile,
        artifactManifestFile,
        promptFile,
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

function normalizeRepoRoots(repoRoots: readonly WorkerRepoRoot[], primaryRepoId: string) {
  const normalized = repoRoots.map((repo) => {
    assertStableId(repo.repoId, 'repoId')
    return { ...repo, path: resolve(repo.path) }
  })
  if (normalized.length === 0) {
    throw new WorkerContextStagingError('Worker Repo workspace must not be empty')
  }
  if (new Set(normalized.map((repo) => repo.repoId)).size !== normalized.length) {
    throw new WorkerContextStagingError('Worker Repo workspace contains duplicate Repo IDs')
  }
  const primary = normalized.filter((repo) => repo.primary)
  if (primary.length > 1 || (primary[0] && primary[0].repoId !== primaryRepoId)) {
    throw new WorkerContextStagingError(`Worker workspace primary must be ${primaryRepoId}`)
  }
  return normalized
}

function requiredPrimaryRepoRoot(repoRoots: readonly WorkerRepoRoot[], primaryRepoId: string) {
  const primary =
    repoRoots.find((repo) => repo.primary) ??
    repoRoots.find((repo) => repo.repoId === primaryRepoId) ??
    repoRoots[0]
  if (!primary) throw new WorkerContextStagingError('Worker Repo workspace must not be empty')
  return primary.path
}

async function discoverRepoGuidance(repoRoots: readonly WorkerRepoRoot[]) {
  const candidates = repoRoots.map((repo) => ({
    repoId: repo.repoId,
    path: join(repo.path, 'AGENTS.md'),
  }))
  const present = await Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      present: await Bun.file(candidate.path).exists(),
    })),
  )
  return present
    .filter((candidate) => candidate.present)
    .map(({ repoId, path }) => ({ repoId, path }))
}

function normalizeApiOrigin(value: string) {
  const url = new URL(value)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin === 'null') {
    throw new WorkerContextStagingError(`Invalid HOPI API origin: ${value}`)
  }
  return url.origin
}

function collectReferencedImages(
  work: ReturnType<typeof parseWorkDocument>,
  paths: ReturnType<typeof createGoalPackagePaths>,
  goalId: string,
) {
  const prefix = `${paths.assetsRoot(goalId)}/`
  return new Set(
    work.attributes.contextRefs
      .map((reference) => reference.path)
      .filter((path) => path.startsWith(prefix) && /\.(?:png|jpe?g|webp|gif)$/i.test(path)),
  )
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
      throw new WorkerContextStagingError(`Dependency Work is missing from authority: ${workId}`)
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
  const artifacts = new Map<
    string,
    {
      reference: string
      path: string
      kind: 'file' | 'directory'
      evidence: Set<string>
    }
  >()
  const unavailable = new Map<
    string,
    { reference: string; evidence: Set<string>; reason: string }
  >()
  for (const file of files) {
    if (!file.content || !file.path.startsWith(evidenceRoot)) continue
    const evidence = parseEvidenceDocument(decode(file.content))
    for (const reference of evidence.attributes.artifacts) {
      const parsed = parsePortableArtifactReference(reference)
      if (!parsed?.runId) {
        const current = unavailable.get(reference)
        if (current) current.evidence.add(file.path)
        else {
          unavailable.set(reference, {
            reference,
            evidence: new Set([file.path]),
            reason: 'The reference is not a retained Run artifact.',
          })
        }
        continue
      }
      const path = join(
        runStoragePath(homeRoot, parsed.runId),
        'artifacts',
        ...parsed.artifactPath.split('/'),
      )
      const metadata = await stat(path).catch(() => null)
      const kind = metadata?.isFile()
        ? ('file' as const)
        : metadata?.isDirectory()
          ? ('directory' as const)
          : null
      if (!kind) {
        const current = unavailable.get(reference)
        if (current) current.evidence.add(file.path)
        else {
          unavailable.set(reference, {
            reference,
            evidence: new Set([file.path]),
            reason: 'The retained Run artifact is unavailable on this machine.',
          })
        }
        continue
      }
      const existing = artifacts.get(reference)
      if (existing) {
        existing.evidence.add(file.path)
      } else {
        artifacts.set(reference, { reference, path, kind, evidence: new Set([file.path]) })
      }
    }
  }
  return {
    available: [...artifacts.values()]
      .map((artifact) => ({ ...artifact, evidence: [...artifact.evidence].sort() }))
      .sort((left, right) => left.reference.localeCompare(right.reference)),
    unavailable: [...unavailable.values()]
      .map((artifact) => ({ ...artifact, evidence: [...artifact.evidence].sort() }))
      .sort((left, right) => left.reference.localeCompare(right.reference)),
  }
}

interface ProjectedEvidenceArtifact {
  reference: string
  path: string
  kind: 'file' | 'directory'
  evidence: string[]
}

async function projectEvidenceArtifacts(
  artifacts: Awaited<ReturnType<typeof resolveEvidenceArtifacts>>['available'],
  contextRoot: string,
): Promise<ProjectedEvidenceArtifact[]> {
  if (artifacts.length === 0) return []
  const projectionRoot = join(contextRoot, 'evidence-artifacts')
  await mkdir(projectionRoot, { recursive: true })
  return Promise.all(
    artifacts.map(async (artifact, index) => {
      const parsed = parsePortableArtifactReference(artifact.reference)
      if (!parsed) {
        throw new WorkerContextStagingError(
          `Invalid portable Evidence artifact reference: ${artifact.reference}`,
        )
      }
      const basename = posix.basename(parsed.artifactPath).replaceAll(/[^A-Za-z0-9._-]/g, '_')
      const path = join(
        projectionRoot,
        `${String(index + 1).padStart(3, '0')}-${basename || 'artifact'}`,
      )
      await cp(artifact.path, path, { recursive: true, dereference: true })
      await makeReadOnly(path)
      return {
        reference: artifact.reference,
        path,
        kind: artifact.kind,
        evidence: artifact.evidence,
      }
    }),
  )
}

async function makeReadOnly(path: string): Promise<void> {
  const metadata = await stat(path)
  if (!metadata.isDirectory()) {
    await chmod(path, 0o444)
    return
  }
  const entries = await readdir(path)
  await Promise.all(entries.map((entry) => makeReadOnly(join(path, entry))))
  await chmod(path, 0o755)
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
  repoRoots: readonly WorkerRepoRoot[],
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
  input: PrepareWorkerContextInput,
  files: readonly PublicationSnapshotFile[],
  paths: ReturnType<typeof createGoalPackagePaths>,
  work: ReturnType<typeof parseWorkDocument>,
) {
  const goalRoot = paths.goalRoot(input.goalId)
  const goalTarget = goalAttentionTarget(input.projectId, input.goalId)
  const workTarget = workAttentionTarget(input.projectId, input.goalId, input.workId)
  const dependencyContext = collectDependencyContext(files, paths, input.goalId, work)
  const referencedEvidence = new Set([
    ...selectedEvidencePaths(work, paths, input.goalId),
    ...dependencyContext.evidencePaths,
  ])
  const dependencyWork = dependencyContext.workPaths
  const contextPaths = new Set(work.attributes.contextRefs.map((reference) => reference.path))
  const referencedImages = collectReferencedImages(work, paths, input.goalId)
  const acceptedInputs = selectedAcceptedInputPaths(`${paths.inputsRoot(input.goalId)}/`, work)
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
    if (contextPaths.has(file.path)) return true
    if (acceptedInputs.has(file.path)) return true
    if (file.path === latestResolvedAttention?.path || file.path === latestResolutionInput)
      return true
    if (file.path === paths.workDocument(input.goalId, input.workId)) return true
    if (dependencyWork.has(file.path) || referencedEvidence.has(file.path)) return true
    if (file.path.startsWith(`${paths.workRoot(input.goalId)}/`) && file.content) {
      const candidate = parseWorkDocument(decode(file.content)).attributes
      return candidate.kind === 'decision' && !isWorkTerminal(candidate)
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
  return work.attributes.evidenceRefs.map((evidenceId) =>
    paths.evidenceDocument(goalId, evidenceId),
  )
}

function selectedAcceptedInputPaths(inputRoot: string, work: ReturnType<typeof parseWorkDocument>) {
  return new Set(
    work.attributes.contextRefs
      .map((reference) => reference.path)
      .filter((path) => path.startsWith(inputRoot)),
  )
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

export interface RunAssignment {
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
    status: string
    body: string
    contextRefs: Array<{ path: string; purpose: string }>
    ownerMessages: WorkOwnerMessage[]
  }
  acceptedInputs: Array<{ path: string; sourceEventId: string; body: string }>
  latestEvidence: {
    path: string
    body: string
    artifacts: Array<{ reference: string; path: string }>
  } | null
  unavailableArtifacts: Array<{ reference: string; evidence: string[]; reason: string }>
  repairView: {
    candidate: CandidateInspection
  } | null
  previousAttempt: PrepareWorkerContextInput['previousAttempt'] | null
}

function createRunAssignment(
  input: PrepareWorkerContextInput,
  paths: ReturnType<typeof createGoalPackagePaths>,
  goal: ReturnType<typeof parseGoalDocument>,
  work: ReturnType<typeof parseWorkDocument>,
  authorityFiles: readonly PublicationSnapshotFile[],
  evidenceArtifacts: readonly ProjectedEvidenceArtifact[],
  unavailableArtifacts: RunAssignment['unavailableArtifacts'],
  repairView: RunAssignment['repairView'],
): RunAssignment {
  const byPath = new Map(authorityFiles.map((file) => [file.path, file]))
  const goalPath = paths.goalDocument(input.goalId)
  const workPath = paths.workDocument(input.goalId, input.workId)
  const acceptedInputs = work.attributes.contextRefs.flatMap((reference) => {
    if (!reference.path.startsWith(`${paths.inputsRoot(input.goalId)}/`)) return []
    const file = byPath.get(reference.path)
    if (!file?.content) return []
    const document = parseInputDocument(decode(file.content))
    return [
      {
        path: file.path,
        sourceEventId: document.attributes.sourceEventId,
        body: document.body,
      },
    ]
  })
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
      status: work.attributes.status,
      body: work.body,
      contextRefs: [...work.attributes.contextRefs],
      ownerMessages: [...work.attributes.ownerMessages],
    },
    acceptedInputs,
    latestEvidence,
    unavailableArtifacts,
    repairView,
    previousAttempt: input.previousAttempt ?? null,
  }
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
  throw new WorkerContextStagingError('Integration target changed repeatedly while staging context')
}

function requiredSnapshotFile(files: readonly PublicationSnapshotFile[], path: string) {
  const file = files.find((candidate) => candidate.path === path)
  if (!file?.content || !file.hash) {
    throw new WorkerContextStagingError(`Required canonical context is missing: ${path}`)
  }
  return file as PublicationSnapshotFile & {
    content: Uint8Array
    hash: string
  }
}

function requiredHash(file: PublicationSnapshotFile, path: string) {
  if (!file.hash) {
    throw new WorkerContextStagingError(`Required canonical context has no hash: ${path}`)
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
    throw new WorkerContextStagingError(`git ${args.join(' ')} failed in ${cwd}: ${stderr.trim()}`)
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
    throw new WorkerContextStagingError(`Unsafe staged path: ${relativePath}`)
  }
  return join(root, ...relativePath.split('/'))
}

function normalizeGitPath(path: string) {
  if (path.startsWith('/') || path.includes('\\')) {
    throw new WorkerContextStagingError(`Unsafe Git path: ${path}`)
  }
  const normalized = posix.normalize(path)
  if (normalized !== path || normalized.startsWith('../')) {
    throw new WorkerContextStagingError(`Unsafe Git path: ${path}`)
  }
  return normalized
}

function assertStableId(value: string, label: string) {
  if (!STABLE_ID_PATTERN.test(value)) {
    throw new WorkerContextStagingError(`Invalid ${label}: ${value}`)
  }
}

function decode(content: Uint8Array | null) {
  if (!content) throw new WorkerContextStagingError('Missing staged document content')
  return new TextDecoder().decode(content)
}
