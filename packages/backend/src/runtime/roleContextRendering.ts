import { createHash } from 'node:crypto'
import { EXECUTION_ENVELOPE_MARKER } from '../agent/executionEnvelope'
import type { PublicationSnapshot } from '../publication/types'
import type {
  PrepareRoleContextInput,
  Responsibility,
  RoleRepoRoot,
  RunAssignment,
} from './roleContextStager'

const RESPONSIBILITY_RUNTIME_BOUNDARY_REVISION = 2

export function responsibilityRuntimeDigest(responsibility: Responsibility) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        boundaryRevision: RESPONSIBILITY_RUNTIME_BOUNDARY_REVISION,
        responsibility,
        contract: profileContract(responsibility),
      }),
    )
    .digest('hex')
}

export function renderContextManifest(
  input: PrepareRoleContextInput,
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
    repoRoots: readonly RoleRepoRoot[]
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
    `- Profile: ${input.responsibility}`,
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

export function renderResponsibilityPrompt(
  input: PrepareRoleContextInput,
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
  const assignmentFacts = renderAssignment(assignment)
  return [
    '# HOPI Run',
    '',
    '## Explicit instruction',
    '',
    input.instructionMarkdown.trim(),
    '',
    '## Execution boundary',
    '',
    EXECUTION_ENVELOPE_MARKER,
    '',
    `Profile: ${input.responsibility}`,
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
    'Never modify canonical .hopi documents or HOPI-managed Git refs.',
    'Read only the Repo roots listed in $HOPI_REPOS_FILE; do not scan their parents or siblings.',
    'A settled Run is never resumed. Do not assume that your Report changes Work state.',
    '',
    ...profileContract(input.responsibility),
    '',
    ...assignmentFacts,
    '',
    '## Required Report',
    '',
    'Finish with one clear natural-language Report describing what you observed or changed, checks run, limitations, and the next decision if one is needed.',
    'Do not return a terminal JSON result, Operation, ChangeSet, or workflow command.',
    'For a process adapter that cannot emit a final assistant response, write the same Markdown Report to $HOPI_REPORT_FILE.',
    '',
  ].join('\n')
}

function profileContract(responsibility: Responsibility) {
  if (responsibility === 'planner') {
    return [
      '## Planner profile',
      '',
      'Work only the requested decision ticket—the current frontier. Wayfinding finds the route rather than charging at the destination: resolve one decision with evidence, record remaining fog and newly visible tickets, then stop at the Engineering handoff. Produce decisions, not deliverables. Research is AFK; prototype and grilling are HITL; a task only unblocks a decision. HITL stays open until the operator speaks, and product source remains unchanged.',
    ]
  }
  if (responsibility === 'generator') {
    return [
      '## Generator profile',
      '',
      'Implement the explicit instruction in the provided writable source workspace. Keep changes scoped and leave the workspace checkpoint-ready.',
    ]
  }
  return [
    '## Reviewer profile',
    '',
    'Inspect the explicit instruction, authority, candidate source, and relevant checks independently. Do not modify product source; report findings and uncertainty.',
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
    `Kind and stage: ${assignment.work.kind} / ${assignment.work.stage}`,
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
          `- Profile: ${assignment.previousAttempt.responsibility}`,
          `- Termination: ${assignment.previousAttempt.termination}`,
          '',
          assignment.previousAttempt.reportMarkdown,
        ]
      : []),
  ]
}
