import { EXECUTION_ENVELOPE_MARKER } from '../agent/executionEnvelope'
import { projectReleaseRef } from '../domain/project'
import type { PublicationSnapshot } from '../publication/types'
import type {
  PrepareRoleContextInput,
  Responsibility,
  RoleRepoRoot,
  RunAssignment,
} from './roleContextStager'

export function renderContextManifest(
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
    '# HOPI Responsibility Context',
    '',
    `- Project: ${input.projectId}`,
    `- Goal: ${input.goalId}`,
    `- Work: ${input.workId}`,
    `- Run: ${input.runId}`,
    `- Responsibility: ${input.responsibility}`,
    `- Primary authority release snapshot: ${context.releaseHead}`,
    '- Immutable authority root: $HOPI_AUTHORITY_ROOT',
    '- Writable proposal root: $HOPI_PROPOSAL_ROOT',
    '- Writable Run artifact output: $HOPI_ARTIFACT_DIR',
    '- Proposal capabilities: $HOPI_PROPOSAL_CAPABILITIES_FILE',
    '- Terminal result schema: $HOPI_RESULT_SCHEMA_FILE',
    '- Responsibility session workspace: $HOPI_SESSION_WORKSPACE',
    '- Reusable runtime cache: $HOPI_CACHE_DIR',
    `- Project primary Repo: ${context.primaryRepoId}`,
    `- Project source scope: ${context.projectPath}`,
    '- Repo workspace manifest: $HOPI_REPOS_FILE',
    `- Repo workspace projection: ${context.repoProjection}`,
    `- Project release ref in each Repo: ${context.releaseRef}`,
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

export function renderResponsibilityPrompt(
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
    repoGuidance: readonly { repoId: string; path: string }[]
    reposFile: string
    apiOrigin?: string
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
    'Task worktrees are disposable source projections; ignored or uncommitted runtime data may disappear when they are rematerialized.',
    '$HOPI_CACHE_DIR persists across responsibility Attempts and task-worktree replacement.',
    'A detached shell descendant is not an independent Work Attempt and has no durable HOPI result owner.',
    ...(paths.artifactManifestFile ? ['Evidence artifacts: $HOPI_EVIDENCE_ARTIFACTS_FILE'] : []),
    `Primary Project guidance: ${paths.agentsPath}`,
    ...paths.repoGuidance.map(
      (guidance) => `Applicable Repo guidance ${guidance.repoId}: ${guidance.path}`,
    ),
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
    'Only paths and exact control-field values declared by $HOPI_PROPOSAL_CAPABILITIES_FILE can be published; any other proposal is rejected.',
    'Coordinator alone changes canonical control state, Evidence, HOPI-managed Git metadata, checkpoints, and integration refs.',
    '$HOPI_REPOS_FILE is the complete Project source-root map; roots may contain source, knowledge, or both, and list existing Repo guidance. Other source and Work runtimes are outside this assignment.',
    'Preview uses the smallest real runtime composition for intended experience and exposes only operator surfaces. Internal dependencies need not be surfaces; transport readiness is not semantic completion.',
    'docs/hopi/preview/runbook.md is surface and host-child authority until accepted input explicitly changes it. Never demote it; routes and services only prove availability.',
    'Do not inspect, classify, isolate, snapshot, or seek approval for Preview database connections or writes. After completion, at most warn the operator that connected data may have changed.',
    'A shell invocation remains one invocation; it ends on completion, failure, termination, or its selected timeout, and any returned live Session represents that same invocation.',
    ...(paths.hasImages
      ? ['Attached images are Goal assets with their authority-defined purpose.']
      : []),
    'Non-Preview external effects require explicit Work or operator authority.',
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
  const ownerMessages =
    assignment.work.ownerMessages.length > 0
      ? [
          '### Project Owner Messages',
          '',
          ...assignment.work.ownerMessages.flatMap((message) => [
            `${message.recordedAt} · source ${message.sourceEventId}`,
            '',
            message.content,
            '',
          ]),
        ]
      : []
  const primary =
    responsibility === 'planner'
      ? [
          '## Primary Task',
          '',
          `### Goal Contract: ${assignment.goal.title}`,
          `Source: $HOPI_AUTHORITY_ROOT/${assignment.goal.path}`,
          `Contract revision: ${assignment.goal.contractRevision}`,
          '',
          '<goal-contract>',
          assignment.goal.body.trim(),
          '</goal-contract>',
          '',
          `### Planning Work: ${assignment.work.title}`,
          `Source: $HOPI_AUTHORITY_ROOT/${assignment.work.path}`,
          `Kind and stage: ${assignment.work.kind} / ${assignment.work.stage}`,
          '',
          '<planning-work>',
          assignment.work.body.trim(),
          '</planning-work>',
          '',
          ...ownerMessages,
          ...(assignment.acceptedInputs.length > 0
            ? [
                '### Accepted Inputs (Planning Work order)',
                '',
                ...assignment.acceptedInputs.flatMap((acceptedInput, index) => [
                  `#### Input ${index + 1}`,
                  `Source: $HOPI_AUTHORITY_ROOT/${acceptedInput.path}`,
                  '<accepted-input>',
                  acceptedInput.body.trim(),
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
          `Source: $HOPI_AUTHORITY_ROOT/${assignment.work.path}`,
          `Kind and stage: ${assignment.work.kind} / ${assignment.work.stage}`,
          '',
          '<engineering-work>',
          assignment.work.body.trim(),
          '</engineering-work>',
          '',
          ...ownerMessages,
        ]
  const supporting = [
    ...(responsibility === 'planner'
      ? []
      : [
          '## Supporting Authority',
          '',
          `Goal: ${assignment.goal.title}`,
          `Goal source: $HOPI_AUTHORITY_ROOT/${assignment.goal.path}`,
          `Goal contract revision: ${assignment.goal.contractRevision}`,
        ]),
    ...(assignment.work.contextRefs.length > 0
      ? [
          ...(responsibility === 'planner' ? ['## Supporting Authority', ''] : []),
          '',
          '### Selected Work Context',
          ...assignment.work.contextRefs.map(
            (reference) => `- $HOPI_AUTHORITY_ROOT/${reference.path} — ${reference.purpose}`,
          ),
        ]
      : []),
    ...(assignment.latestEvidence
      ? [
          ...(responsibility === 'planner' ? ['## Supporting Authority', ''] : []),
          '',
          '### Latest Owning Work Evidence (Historical Run Result)',
          `Source: $HOPI_AUTHORITY_ROOT/${assignment.latestEvidence.path}`,
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
    ...(assignment.unavailableArtifacts.length > 0
      ? [
          '',
          '### Unavailable Referenced Material',
          '',
          'These are supporting-material diagnostics, not a Coordinator verdict. Decide whether they matter for the current responsibility.',
          ...assignment.unavailableArtifacts.map(
            (artifact) =>
              `- ${artifact.reference} (from ${artifact.evidence.join(', ')}): ${artifact.reason}`,
          ),
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
  operatorPreferenceFile?: string
}) {
  return [
    '## Planner',
    '',
    'Owned outcome: durable design and only the Engineering Work required to reach the current Goal boundary.',
    'Goal authority and source are read-only.',
    ...(paths.operatorPreferenceFile
      ? ['Operator preferences are defaults below current Input and Project/Goal authority.']
      : []),
    'Run-produced proof may bind current content digests but cannot predict the checkpoint commit Coordinator creates after the Run; Coordinator Evidence owns that commit identity.',
    'The proposal owns the current nonterminal dependsOn graph and may atomically add, remove, or redirect edges. Leave one valid acyclic graph; terminal Work is immutable.',
    'Owned Project Repo context: .hopi/docs/repos.md records Repo responsibilities, important commands, shared contracts, and combined runtime topology.',
    'For Preview planning, preserve that baseline. If source conflicts or missing input can change it, keep the runbook boundary in proposed design and Repo context, reuse or update the smallest Attention, and propose no dependent Engineering Work.',
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
    'The Project source roots are writable. Canonical .hopi state and HOPI-managed Git metadata are Coordinator-owned and immutable.',
    'The staged authority is current for this Run; Public Preview, when present, observes the integrated release rather than this candidate.',
    'For Preview, explore guidance, knowledge, behavior, source, and runbook first. Preserve accepted baseline; on conflict, update Attention and fail unchanged.',
    'Update runbook first (free Markdown); implement the smallest faithful runtime without mocks. Bound probes; concurrency is not a bound. Contradictory negatives invalidate the oracle: replay a known-positive control; separate observation errors from product results before changing probes/waits.',
    'Control Preview: observe surfaces, browser-verify, stop, verify process/ports; never wait for natural exit.',
    '',
  ]
}

function reviewerPrompt(projectId: string) {
  const releaseRef = projectReleaseRef(projectId)
  return [
    '## Reviewer',
    '',
    'Owned outcome: independently determine whether the received candidate satisfies the current Goal, intended-experience authority, and Engineering Work contract.',
    `Candidate source is the cumulative delta from git merge-base ${releaseRef} HEAD to HEAD.`,
    'Source, Project documents, canonical .hopi state, and Git metadata are read-only.',
    'Public Preview, when present, observes the integrated release rather than this candidate.',
    'For Preview, compare runbook/surfaces with authority; use browser, find the smallest cause without mocks, and reject unbounded discovery including parallel brute force.',
    'Reject unexplained known-positive contradictions and error-as-result oracles; more waits/probes do not validate them.',
    'Control Preview: observe surfaces, browser-verify, stop, verify process/ports; never wait for natural exit.',
    'Transport evidence alone cannot pass the Work; reject if browser-based experience verification is unavailable.',
    '',
  ]
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
