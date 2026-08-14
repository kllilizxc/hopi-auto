import { createHash } from 'node:crypto'
import { EXECUTION_ENVELOPE_MARKER } from '../agent/executionEnvelope'
import type { PublicationSnapshot } from '../publication/types'
import type {
  PrepareWorkerContextInput,
  RunAssignment,
  WorkerRepoRoot,
} from './workerContextStager'

const WORKER_RUNTIME_BOUNDARY_REVISION = 1

export function workerRuntimeDigest() {
  return createHash('sha256')
    .update(
      JSON.stringify({
        boundaryRevision: WORKER_RUNTIME_BOUNDARY_REVISION,
        contract: workerContract(),
      }),
    )
    .digest('hex')
}

export function renderContextManifest(
  input: PrepareWorkerContextInput,
  context: {
    authorityRoot: string
    artifactOutputDir: string
    runtimeScratchDir: string
    runtimeCacheDir: string
    releaseHead: string
    releaseRef: string
    repoReleaseHeads: Readonly<Record<string, string>>
    repoProjectionHeads: Readonly<Record<string, string>>
    repoProjection: 'candidate' | 'release'
    snapshot: PublicationSnapshot['files']
    evidencePaths: readonly string[]
    artifactManifestFile?: string
    bootstrapSourceRoot?: string
    imagePaths: readonly string[]
    primaryRepoId: string
    repoRoots: readonly WorkerRepoRoot[]
    repoGuidance: readonly { repoId: string; path: string }[]
    reposFile: string
    projectPath: string
    apiOrigin?: string
    operatorPreference?: { path: string; digest: string }
  },
) {
  return [
    '# HOPI Run Context',
    '',
    `- Project: ${input.projectId}`,
    `- Goal: ${input.goalId}`,
    `- Work: ${input.workId}`,
    `- Run: ${input.runId}`,
    `- Workspace mode: ${input.workspaceMode}`,
    `- Authority release snapshot: ${context.releaseHead}`,
    '- Immutable authority root: $HOPI_AUTHORITY_ROOT',
    '- Run artifact output: $HOPI_ARTIFACT_DIR',
    '- Run-local workspace: $HOPI_SESSION_WORKSPACE',
    '- Shared runtime cache: $HOPI_CACHE_DIR',
    `- Primary Repo: ${context.primaryRepoId}`,
    `- Project source scope: ${context.projectPath}`,
    '- Repo workspace manifest: $HOPI_REPOS_FILE',
    `- Repo workspace projection: ${context.repoProjection}`,
    `- Project release ref: ${context.releaseRef}`,
    ...(context.artifactManifestFile
      ? ['- Evidence artifact manifest: $HOPI_EVIDENCE_ARTIFACTS_FILE']
      : []),
    ...(context.operatorPreference
      ? [
          `- Operator preference snapshot: $HOPI_OPERATOR_PREFERENCE_FILE (${context.operatorPreference.digest})`,
        ]
      : []),
    ...(context.apiOrigin ? [`- HOPI public API origin: ${context.apiOrigin}`] : []),
    ...context.repoRoots.map((repo) =>
      [
        `- Repo ${repo.repoId}${repo.primary ? ' (primary)' : ''}: ${repo.path}`,
        `  Projection head: ${context.repoProjectionHeads[repo.repoId] ?? 'unavailable'}`,
        `  Base release head: ${context.repoReleaseHeads[repo.repoId] ?? 'unavailable'}`,
      ].join('\n'),
    ),
    ...context.repoGuidance.map(
      (guidance) => `- Applicable Repo guidance ${guidance.repoId}: ${guidance.path}`,
    ),
    ...(context.bootstrapSourceRoot
      ? ['- Read-only bootstrap source snapshot: $HOPI_BOOTSTRAP_SOURCE_ROOT']
      : []),
    '',
    '## Explicit references',
    '',
    ...(input.refs.length > 0 ? input.refs.map((reference) => `- ${reference}`) : ['- None']),
    '',
    '## Authority files',
    '',
    ...context.snapshot.map((file) => `- ${file.path}: ${file.hash ?? 'missing'}`),
    ...(context.imagePaths.length > 0
      ? ['', '## Attached reference images', '', ...context.imagePaths.map((path) => `- ${path}`)]
      : []),
    ...(context.evidencePaths.length > 0
      ? ['', '## Selected evidence', '', ...context.evidencePaths.map((path) => `- ${path}`)]
      : []),
    '',
    'Authority files are immutable inputs. A Run may change source only when its selected workspace is writable.',
    '',
  ].join('\n')
}

export function renderWorkerPrompt(
  input: PrepareWorkerContextInput,
  paths: {
    contextFile: string
    artifactManifestFile?: string
    agentsPath: string
    primaryRepoId: string
    repoGuidance: readonly { repoId: string; path: string }[]
    browserTargetsFile?: string
    operatorPreferenceFile?: string
    apiOrigin?: string
  },
  assignment: RunAssignment,
) {
  return [
    '# HOPI Worker Run',
    '',
    '## Explicit instruction',
    '',
    input.instructionMarkdown.trim(),
    '',
    '## Execution boundary',
    '',
    EXECUTION_ENVELOPE_MARKER,
    '',
    `Workspace mode: ${input.workspaceMode}`,
    `Context manifest: ${paths.contextFile}`,
    'Authority root: $HOPI_AUTHORITY_ROOT',
    'Run artifact output: $HOPI_ARTIFACT_DIR',
    'Repo roots and release heads: $HOPI_REPOS_FILE',
    'Run scratch: $HOPI_RUN_SCRATCH',
    'Shared cache: $HOPI_CACHE_DIR',
    ...(paths.artifactManifestFile ? ['Evidence artifacts: $HOPI_EVIDENCE_ARTIFACTS_FILE'] : []),
    `Primary Project guidance: ${paths.agentsPath}`,
    ...paths.repoGuidance.map(
      (guidance) => `Applicable Repo guidance ${guidance.repoId}: ${guidance.path}`,
    ),
    `Primary Repo: ${paths.primaryRepoId}`,
    'Primary Repo root: $HOPI_PRIMARY_REPO_ROOT',
    'Browser harness, when installed: $HOPI_BROWSER_HARNESS_COMMAND',
    ...(paths.browserTargetsFile ? ['Browser targets: $HOPI_BROWSER_TARGETS_FILE'] : []),
    ...(paths.operatorPreferenceFile
      ? ['Operator preferences: $HOPI_OPERATOR_PREFERENCE_FILE']
      : []),
    ...(paths.apiOrigin ? ['HOPI API: $HOPI_API_ORIGIN'] : []),
    '',
    ...workerContract(),
    '',
    ...renderAssignment(assignment),
    '',
    '## Required Report',
    '',
    'Finish with one clear natural-language Report describing what you observed or changed, checks run, limitations, and the next decision if one is needed.',
    'Do not return a terminal JSON result, Operation, ChangeSet, or workflow command.',
    'For a process adapter that cannot emit a final assistant response, write the same Markdown Report to $HOPI_REPORT_FILE.',
    '',
  ].join('\n')
}

function workerContract() {
  return [
    '## Worker contract',
    '',
    'Follow the explicit instruction and the declared workspace boundary. Never modify canonical .hopi documents or HOPI-managed Git refs.',
    'Read only the Repo roots listed in $HOPI_REPOS_FILE; do not scan their parents or siblings.',
    'A settled Run is evidence for the Project Assistant. It never changes Work state by itself.',
    'For Decision Work, answer only the named question and preserve uncertainty; do not execute the destination unless the instruction and Map Notes explicitly permit it.',
    'For Engineering Work, keep changes scoped and leave writable workspaces checkpoint-ready.',
  ]
}

function renderAssignment(assignment: RunAssignment) {
  const ownerMessages = assignment.work.ownerMessages.flatMap((message) => [
    `- ${message.recordedAt} · source ${message.sourceEventId}`,
    `  ${message.content}`,
  ])
  return [
    '## Current Work authority',
    '',
    `Goal: ${assignment.goal.title}`,
    `Goal source: $HOPI_AUTHORITY_ROOT/${assignment.goal.path}`,
    `Contract revision: ${assignment.goal.contractRevision}`,
    '',
    '<goal>',
    assignment.goal.body.trim(),
    '</goal>',
    '',
    `Work: ${assignment.work.title}`,
    `Work source: $HOPI_AUTHORITY_ROOT/${assignment.work.path}`,
    `Kind and status: ${assignment.work.kind} / ${assignment.work.status}`,
    '',
    '<work>',
    assignment.work.body.trim(),
    '</work>',
    ...(ownerMessages.length > 0 ? ['', '### Owner messages', '', ...ownerMessages] : []),
    ...(assignment.work.contextRefs.length > 0
      ? [
          '',
          '### Selected context',
          '',
          ...assignment.work.contextRefs.map(
            (reference) => `- $HOPI_AUTHORITY_ROOT/${reference.path} — ${reference.purpose}`,
          ),
        ]
      : []),
    ...(assignment.previousAttempt
      ? [
          '',
          '### Previous Run',
          '',
          `- Run: ${assignment.previousAttempt.runId}`,
          `- Termination: ${assignment.previousAttempt.termination}`,
          '',
          assignment.previousAttempt.reportMarkdown,
        ]
      : []),
  ]
}
