import type { AgentRole } from '../agent/AgentRunner'
import { BLOCKER_KINDS, TASK_KINDS, TASK_STATUSES, type TaskItem } from '../domain/board'
import type { GoalDecision } from '../storage/decisionStore'
import { RESERVED_GOAL_STATE_FILES } from '../storage/planningRequestStore'
import type {
  GoalPlanningRequestAnswer,
  GoalPlanningRequestUpdateTarget,
} from '../storage/planningRequestStore'
import type { PreferenceEntry } from '../storage/preferenceStore'
import type { MergeScriptAttemptRecord } from './gitMergeExecutor'
import type { GoalWriteTraceEntry } from './writeTrace'

const PLANNING_REQUEST_STATUS_LITERALS = ['open', 'resolved'] as const

export interface PlannerContextInputs {
  goalDocsRoot: string
  todoFile: string
  todoContent: string
  decisionsFile: string
  decisionsContent: string
  decisionEntries: GoalDecision[]
  planningRequestsFile: string
  planningRequestsContent: string
  relevantPlanningRequests: Array<{
    requestKey: string
    workflowKey?: string
    workflowSharedAnswers: GoalPlanningRequestAnswer[]
    workflowTaskKey?: string
    blockedByWorkflowKeys: string[]
    groupKey?: string
    groupTaskKey?: string
    title: string
    taskRef: string
    decisionRefs: string[]
    answers: GoalPlanningRequestAnswer[]
    attachments: Array<{
      assetPath: string
      fileName?: string
      mediaType?: string
    }>
    requestedUpdates: GoalPlanningRequestUpdateTarget[]
  }>
  relatedPlanningGroups: Array<{
    groupKey: string
    requests: Array<{
      requestKey: string
      groupTaskKey?: string
      taskRef: string
      title: string
      decisionRefs: string[]
      workflowSharedAnswers: GoalPlanningRequestAnswer[]
      answers: GoalPlanningRequestAnswer[]
      requestedUpdates: GoalPlanningRequestUpdateTarget[]
    }>
  }>
  planningFollowThroughEvidence: {
    requestedUpdates: GoalPlanningRequestUpdateTarget[]
    observedUpdates: GoalPlanningRequestUpdateTarget[]
    missingUpdates: GoalPlanningRequestUpdateTarget[]
  }
  preferenceFile: string
  preferenceContent: string
  preferenceEntries: PreferenceEntry[]
  relevantGoalImages: RelevantGoalImage[]
}

export interface GoalDocsStatusInputs {
  goalStatus: 'bootstrapped' | 'curated'
  designStatus: 'bootstrapped' | 'curated'
}

export interface RelevantRunEvidence {
  runId: string
  stepId: string
  role: AgentRole
  outcome: string
  artifacts: Array<{ ref: string; label: string }>
  transcriptSummaries: string[]
  worktreePath?: string
}

export interface LatestReviewerFeedback {
  runId: string
  stepId: string
  rejectedAt: string
  reason: string
  artifactRef?: string
  artifactLabel?: string
}

export interface MergeScriptDiagnostics {
  scriptPath: string
  scriptContent: string
  latestAttempt: MergeScriptAttemptRecord
}

export interface RelevantGoalImage {
  assetPath: string
  fileName?: string
  mediaType?: string
  sources: string[]
}

export interface RenderRoleProcessContextMarkdownOptions {
  role: AgentRole
  goalKey: string
  goalTitle: string
  task: TaskItem
  goalFile: string
  designFile: string
  outcomeFile: string
  browserHarnessDir: string
  browserHarnessArtifactDir: string
  plannerInputs?: PlannerContextInputs
  relevantGoalImages: RelevantGoalImage[]
  docsStatus: GoalDocsStatusInputs
  latestReviewerFeedback?: LatestReviewerFeedback
  mergeScriptDiagnostics?: MergeScriptDiagnostics
  relevantRunEvidence: RelevantRunEvidence[]
  relevantTraces: GoalWriteTraceEntry[]
}

export interface RenderRoleProcessPromptMarkdownOptions {
  role: AgentRole
  taskKind: TaskItem['kind']
  docsStatus: GoalDocsStatusInputs
  context: string
  outcomeFile: string
}

export function renderContextMarkdown(options: RenderRoleProcessContextMarkdownOptions) {
  return `# HOPI Role Context

Role: ${options.role}
Goal Key: ${options.goalKey}
Goal Title: ${options.goalTitle}
Task Ref: ${options.task.ref}
Task Kind: ${options.task.kind}
Task Title: ${options.task.title}
Task Status: ${options.task.status}

## Task Description

${options.task.description || 'No description provided.'}

## Acceptance Criteria

${options.task.acceptanceCriteria.map((item) => `- ${item}`).join('\n') || '- None recorded.'}

${renderLatestReviewerFeedback(options.latestReviewerFeedback)}
${renderMergeScriptDiagnostics(options.mergeScriptDiagnostics)}
## Durable Goal Docs

- goal.md: ${options.goalFile}
- design.md: ${options.designFile}

## Goal Docs Status

- goal.md status: ${options.docsStatus.goalStatus}
- design.md status: ${options.docsStatus.designStatus}

${renderRelevantGoalImages(options.relevantGoalImages)}
${renderPlannerInputs(options.plannerInputs)}
${renderBrowserHarnessContext(options.browserHarnessDir, options.browserHarnessArtifactDir)}

## Runtime Output

- Write the structured outcome JSON to: ${options.outcomeFile}
- Write Browser Harness screenshots, logs, and verification artifacts under: ${options.browserHarnessArtifactDir}

${renderRelevantRunEvidence(options.role, options.relevantRunEvidence)}

${renderRelevantTraces(options.role, options.task.kind, options.relevantTraces)}

## Boundaries

${roleBoundaryText(options.role)}
`
}

export function renderPromptMarkdown(options: RenderRoleProcessPromptMarkdownOptions) {
  return `# HOPI ${capitalizeRole(options.role)} Prompt

You are the HOPI ${options.role} agent for one deterministic runtime step.

Before you finish:

- use the repository plus the bundled context below
- keep workflow truth file-native
- write a structured JSON outcome to: ${options.outcomeFile}

Allowed outcome kinds:

- success
- reject
- merge_conflict
- fail
- timeout

Recommended outcome shape:

\`\`\`json
{
  "kind": "success",
  "reason": "optional summary",
  "artifactRef": "optional stable ref",
  "artifactLabel": "optional human label"
}
\`\`\`

${renderRoleEvidencePolicy(options.role, options.taskKind)}
${renderPlannerDesignPolicy(options.role, options.docsStatus)}
${renderBrowserHarnessCapabilityPolicy(options.role, options.taskKind)}

## Bundled Context

${options.context}
`
}

function renderRelevantTraces(
  role: AgentRole,
  taskKind: TaskItem['kind'],
  entries: GoalWriteTraceEntry[],
) {
  if (entries.length === 0) {
    if (taskKind === 'engineering' && (role === 'reviewer' || role === 'merger')) {
      return `## Relevant Write Traces

- No durable write traces were recorded yet for this task.
`
    }

    if (taskKind === 'planning' && (role === 'reviewer' || role === 'merger')) {
      return `## Relevant Write Traces

- No durable planning write traces were recorded yet for this task.
`
    }

    return ''
  }

  return `## Relevant Write Traces

${entries.map((entry) => renderTraceEntry(entry)).join('\n')}
`
}

function renderRelevantRunEvidence(role: AgentRole, entries: RelevantRunEvidence[]) {
  if (entries.length === 0) {
    if (role === 'reviewer' || role === 'merger') {
      return `## Relevant Run Evidence

- No prior run-history evidence was recorded yet for this task.
`
    }

    return ''
  }

  return `## Relevant Run Evidence

${entries.map((entry) => renderRunEvidenceEntry(entry)).join('\n')}
`
}

function renderLatestReviewerFeedback(feedback?: LatestReviewerFeedback) {
  if (!feedback) {
    return ''
  }

  const artifactLine =
    feedback.artifactRef || feedback.artifactLabel
      ? `- Review artifact: ${feedback.artifactRef ?? 'n/a'}${feedback.artifactLabel ? ` (${feedback.artifactLabel})` : ''}`
      : null

  return `## Latest Reviewer Findings To Address

- Latest reviewer rejection: ${feedback.rejectedAt} | ${feedback.runId} | ${feedback.stepId}
- Treat the following reviewer findings as mandatory fix targets before returning success:
- ${feedback.reason}
${artifactLine ? `${artifactLine}\n` : ''}`
}

function renderMergeScriptDiagnostics(diagnostics?: MergeScriptDiagnostics) {
  if (!diagnostics) {
    return ''
  }

  return `## Merge Script Attempt To Resolve

- Merge script: ${diagnostics.scriptPath}
- Latest script attempt: ${diagnostics.latestAttempt.attemptedAt}
- Latest script result: ${
    diagnostics.latestAttempt.result
      ? `${diagnostics.latestAttempt.result.kind} | ${diagnostics.latestAttempt.result.reason}`
      : (diagnostics.latestAttempt.parseError ?? `exit ${diagnostics.latestAttempt.exitCode}`)
  }

### Current merge script

\`\`\`bash
${diagnostics.scriptContent.trim()}
\`\`\`

### Latest merge script stdout

\`\`\`text
${truncatePromptBlock(diagnostics.latestAttempt.stdout)}
\`\`\`

### Latest merge script stderr

\`\`\`text
${truncatePromptBlock(diagnostics.latestAttempt.stderr)}
\`\`\`
`
}

function renderBrowserHarnessContext(browserHarnessDir: string, artifactDir: string) {
  return `## Browser Harness

- Project Browser Harness scripts live under: ${browserHarnessDir}
- Scenario scripts should live under: ${browserHarnessDir}/scenarios/
- Browser Harness artifacts for this step must be written under: ${artifactDir}
- User-level templates may exist under ~/.hopi/browser-harness/templates, but project acceptance must reference project scripts under ${browserHarnessDir}.
`
}

function renderRunEvidenceEntry(entry: RelevantRunEvidence) {
  const artifacts =
    entry.artifacts.length === 0
      ? 'none'
      : entry.artifacts.map((artifact) => `${artifact.ref} (${artifact.label})`).join(', ')
  const transcript =
    entry.transcriptSummaries.length === 0 ? 'none' : entry.transcriptSummaries.join(' | ')
  const worktree = entry.worktreePath ? `\n  Worktree: ${entry.worktreePath}` : ''

  return `- ${entry.runId} | ${entry.stepId} | ${entry.role} | ${entry.outcome}
  Artifacts: ${artifacts}
  Transcript: ${transcript}${worktree}`
}

function renderTraceEntry(entry: GoalWriteTraceEntry) {
  const targetSummary =
    entry.targetPaths.length > 0
      ? entry.targetPaths.join(', ')
      : entry.changes.map((change) => change.path).join(', ') ||
        'no significant source paths recorded'
  const changes =
    entry.changes.length === 0
      ? 'none'
      : entry.changes.map((change) => `${change.kind} ${change.path}`).join(', ')

  return `- ${entry.timestamp} | ${entry.role} | ${entry.resultSummary} | ${targetSummary}
  Changes: ${changes}`
}

function renderPlannerInputs(inputs?: PlannerContextInputs) {
  if (!inputs) {
    return ''
  }

  return `## Planner Durable Inputs

- Goal-local requested update root: ${inputs.goalDocsRoot}
- todo.yml: ${inputs.todoFile}
- decisions.yml: ${inputs.decisionsFile}
- planning-requests.yml: ${inputs.planningRequestsFile}
- preference.md: ${inputs.preferenceFile}

### Current todo.yml

\`\`\`yaml
${inputs.todoContent.trim()}
\`\`\`

### Current decisions.yml

\`\`\`yaml
${inputs.decisionsContent.trim()}
\`\`\`

${renderDecisionEntries(inputs.decisionEntries)}

### Current planning-requests.yml

\`\`\`yaml
${inputs.planningRequestsContent.trim()}
\`\`\`

${renderRelevantPlanningRequests(inputs.relevantPlanningRequests)}
${renderRelatedPlanningGroups(inputs.relatedPlanningGroups)}
${renderPlanningUpdateCoverage(inputs.planningFollowThroughEvidence)}

### Current preference.md

\`\`\`md
${inputs.preferenceContent.trim()}
\`\`\`

${renderPreferenceEntries(inputs.preferenceEntries)}
`
}

function renderPreferenceEntries(entries: PreferenceEntry[]) {
  if (entries.length === 0) {
    return `### Parsed Preferences

- No durable preference entries recorded yet.
`
  }

  return `### Parsed Preferences

${entries
  .map((entry) => {
    const rationale = entry.rationale ? ` | rationale: ${entry.rationale}` : ''
    const retiredReason = entry.retiredReason ? ` | retired: ${entry.retiredReason}` : ''
    const supersededBy = entry.supersededBy ? ` | supersededBy: ${entry.supersededBy}` : ''
    return `- ${entry.status} | ${entry.preferenceKey} | ${entry.summary}${rationale}${retiredReason}${supersededBy}`
  })
  .join('\n')}
`
}

function renderDecisionEntries(entries: GoalDecision[]) {
  if (entries.length === 0) {
    return `### Parsed Decisions

- No durable decision topics recorded yet.
`
  }

  return `### Parsed Decisions

${entries
  .map((entry) =>
    [
      `- ${entry.status} | ${entry.decisionKey} | ${entry.summary}`,
      entry.summaryKey ? `  Summary key: ${entry.summaryKey}` : null,
      entry.prompt ? `  Prompt: ${entry.prompt}` : null,
      entry.matchHints?.length ? `  Match hints: ${entry.matchHints.join(', ')}` : null,
      entry.taskRef ? `  Task: ${entry.taskRef}` : null,
      entry.attachments.length > 0
        ? `  Attachment assets: ${entry.attachments.map((attachment) => attachment.assetPath).join(', ')}`
        : null,
      entry.captureFormat ? `  Answer capture format: ${entry.captureFormat}` : null,
      entry.answer ? `  Answer: ${entry.answer}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  )
  .join('\n')}
`
}

function renderBrowserHarnessCapabilityPolicy(role: AgentRole, taskKind: TaskItem['kind']) {
  const reviewerLine =
    role === 'reviewer' && taskKind === 'engineering'
      ? '- If acceptance criteria include a Browser harness requirement, run or inspect the referenced scenario before accepting; reject/fail if verification cannot run or does not prove the visible behavior.\n'
      : ''
  const planningReviewerLine =
    role === 'reviewer' && taskKind === 'planning'
      ? '- When reviewing planning work, accept Browser Harness follow-through when the downstream engineering task clearly names visible verification and either references an existing repo scenario or explicitly requires the generator to create/update one; do not reject planning solely because the scenario asset does not exist yet.\n'
      : ''
  const generatorLine =
    role === 'generator'
      ? '- If acceptance criteria require a Browser Harness scenario, create or update the project script under scripts/hopi/browser-harness/** and run it when the app/server is available.\n'
      : ''

  return `## Browser Harness Capability

- You may call Browser Harness with \`browser-harness <<'PY' ... PY\`.
- Prefer project scenarios under \`scripts/hopi/browser-harness/scenarios/*.py\` over one-off snippets.
- Use \`new_tab(url)\` for first navigation, prefer screenshots for visible UI verification, and re-screenshot after meaningful interactions.
- Write screenshots, logs, and extracted verification outputs to \`$HOPI_BROWSER_HARNESS_ARTIFACT_DIR\`.
- If the browser is unavailable, the dev server is not running, or a login wall blocks verification, do not claim success; return fail/reject with the concrete blocker.
- \`~/.hopi/browser-harness/templates/**\` may be used as a template source only; project acceptance should reference repo scripts under \`scripts/hopi/browser-harness/**\`.
${generatorLine}${reviewerLine}${planningReviewerLine}`
}

function roleBoundaryText(role: AgentRole) {
  if (role === 'planner') {
    return `Planner may edit goal.md, design.md, todo.yml, and other requested Goal-local durable docs under .hopi/docs/goals/<goalKey>/ when needed to record durable Goal context. Use the exact Goal-doc paths listed in the bundled context when reading or writing durable docs; do not invent alternate relative .hopi/... paths. Do not edit ${RESERVED_GOAL_STATE_FILES.join(', ')}; those files are runtime-owned workflow state.`
  }

  return 'Do not edit .hopi/docs/**. Generator, reviewer, and merger work must leave durable Goal docs unchanged. Workflow roles operate in worktrees and must not write root workspace source files directly. When reading Goal-local docs, use the exact paths listed in the bundled context instead of inventing alternate relative .hopi/... paths.'
}

function renderRoleEvidencePolicy(role: AgentRole, taskKind: TaskItem['kind']) {
  if (taskKind === 'engineering' && role === 'generator') {
    return `## Role Completion Policy

- Treat every acceptance criterion and any "Latest Reviewer Findings To Address" prose as a hard completion gate.
- Before returning success, re-read the touched source and verify that each cited reviewer problem is actually gone, not merely reduced.
- If the reviewer called out a specific remaining structure, pane, slab, function, or region, do not return success while it still exists in the code.
- If you cannot satisfy the acceptance criteria and latest reviewer findings in this attempt, return fail with a concise natural-language explanation of what still remains.
`
  }

  if (taskKind === 'engineering' && role === 'reviewer') {
    return `## Role Evidence Policy

- Reviewer must use relevant write traces as execution evidence.
- Correlate artifact refs and prior run history with the claimed work before accepting.
- If there are no relevant traces or the traces do not support the claimed work, prefer reject or fail over blind acceptance.
- When rejecting generator work, write the reject reason in natural language that the next generator can act on directly.
- Name the concrete remaining problem in the code whenever you can, including the relevant file, function, UI region, or still-present structure.
- State what still exists and what must change next; do not stop at generic wording like "still not aligned" or "needs polish".
`
  }

  if (taskKind === 'engineering' && role === 'merger') {
    return `## Role Evidence Policy

- Merger must let the project merge script attempt the merge first and treat its result as the primary deterministic signal.
- Merger runs in the task worktree and must not edit root workspace source files directly.
- If the script reports needs_merger, first improve the worktree branch or the worktree copy of scripts/hopi/merge-task.sh as needed, then rerun the script.
- If the script reports merge_conflict, treat that as a deterministic blocker rather than forcing a manual root edit.
- Merger may reconcile worktree product files when necessary, but success is only valid if the merge script succeeds afterward.
- Merger must inspect relevant run history and artifact evidence before returning success.
- Merger must inspect relevant write traces before returning success.
- Merger must not return success blindly when engineering write-trace evidence is missing.
`
  }

  if (taskKind === 'planning' && role === 'reviewer') {
    return `## Role Evidence Policy

- Planning reviewer must verify durable planning follow-through against open planning requests before accepting.
- Planning reviewer should correlate goal-doc and todo changes with prior run history and write traces.
- If there is no durable planning evidence or the docs and task graph do not reflect the requested follow-through, prefer reject or fail over blind acceptance.
`
  }

  if (taskKind === 'planning' && role === 'merger') {
    return `## Role Evidence Policy

- Planning merger must inspect durable planning evidence before returning success.
- Planning merger should correlate prior run history, goal-doc changes, and planning-request follow-through.
- Planning merger must not return success blindly when durable planning follow-through evidence is missing.
`
  }

  return ''
}

function renderPlannerDesignPolicy(role: AgentRole, docsStatus: GoalDocsStatusInputs) {
  if (role !== 'planner') {
    return ''
  }

  const bootstrapRule =
    docsStatus.designStatus === 'bootstrapped'
      ? '- If design.md is still bootstrapped, replace placeholder sections with durable design detail before returning success.\n'
      : ''

  return `## Planner Design Policy

${bootstrapRule}- Update durable design rationale before reshaping substantial task graph work.
- Requested update paths are relative to the Goal docs directory from the bundled context.
- Use the exact file paths listed in the bundled context when reading or writing Goal docs; do not invent alternate relative .hopi/... paths.
- Do not edit ${RESERVED_GOAL_STATE_FILES.join(', ')}; those files are runtime-owned workflow state.
- If a relevant planning request targets goal.md, update durable Goal context before returning success.
- When decisions materially change decomposition, summarize the implication in design.md before concluding planning work.
- Address open planning requests linked to this task before returning success.
- If a relevant planning request targets design.md, update durable design rationale before returning success.
- If a relevant planning request targets another Goal-local path, create or update that durable document before returning success.
- If a relevant planning request targets todo.yml, reshape the visible task graph before returning success.
- When a task materially depends on a referenced Goal image, keep the exact Goal-local asset path(s) under attachmentAssetPaths on that task row.

## Planner Task Decomposition Rules

- Default to one engineering task unless there is a clear parallelism or sequencing benefit.
- Every engineering task must name its primary implementation surface in backticks inside the task description, for example \`DeckManagementPanel\` or \`src/game/ui/deckbuilder/DeckManagementPanel.ts\`.
- If two engineering tasks would touch the same primary surface, merge them into one task or add a \`blockedBy\` task dependency so they do not run in parallel.
- Use \`blockedBy: [{ kind: "task", ref: "..." }]\` for structural prerequisites or overlapping implementation surfaces that must remain ordered.
- Preserve/no-regression concerns should usually stay in acceptance criteria or a serial hardening pass, not as a parallel task on the same surface.
- For UI, layout, visual, interaction, routing, browser state, keyboard/IME, responsive, screenshot, modal, panel, button, tab/filter, form, or input work, every engineering task must include at least one acceptance criterion beginning with \`Browser harness:\`.
- A \`Browser harness:\` criterion must name the page/user path, visible state or interaction result, and either an existing scenario under \`scripts/hopi/browser-harness/scenarios/\` or the scenario the generator must create/update.
- If the repo does not already contain a suitable project scenario, do not require one to pre-exist; make the engineering task say the generator must create or update the scenario under \`scripts/hopi/browser-harness/scenarios/\`.
- Planner must not create or edit \`scripts/hopi/browser-harness/**\`; those project scripts are engineering assets produced by generator/reviewer/merger worktrees.
- If Browser Harness truly does not apply to a UI-looking task, write \`Browser harness: not applicable because ...\` with a concrete reason.

## todo.yml Canonical Literals

- Allowed task kind literals: ${TASK_KINDS.join(' | ')}
- Allowed task status literals: ${TASK_STATUSES.join(' | ')}
- Allowed blockedBy.kind literals: ${BLOCKER_KINDS.join(' | ')}
- If a YAML list item in description or acceptanceCriteria starts with backticks or another YAML-reserved leading character, quote it or write it with \`>-\`; never start a bare list item with \`\`.
- attachmentAssetPaths is optional, but when present every value must be an exact Goal-local asset path under assets/.
- Do not invent synonyms such as pending, queued, active, blocked, or review_pending.
- Do not invent attachment paths or collapse image lineage into prose-only references.
- planning-requests.yml is runtime-owned and must not be edited. For reference only, its status literals are ${PLANNING_REQUEST_STATUS_LITERALS.join(' | ')}.
`
}

function renderRelevantPlanningRequests(
  requests: PlannerContextInputs['relevantPlanningRequests'],
) {
  if (requests.length === 0) {
    return ''
  }

  return `### Relevant Open Planning Requests For This Task

${requests
  .map((request) =>
    [
      `- ${request.requestKey} | ${request.title} | ${request.taskRef}`,
      request.workflowKey ? `  Workflow key: ${request.workflowKey}` : null,
      renderPlanningRequestAnswers(request.workflowSharedAnswers, '  ', 'Workflow-shared answers'),
      request.workflowTaskKey ? `  Workflow task key: ${request.workflowTaskKey}` : null,
      request.blockedByWorkflowKeys.length > 0
        ? `  Workflow dependencies: ${request.blockedByWorkflowKeys.join(', ')}`
        : null,
      request.groupKey ? `  Planning group: ${request.groupKey}` : null,
      request.groupTaskKey ? `  Grouped task key: ${request.groupTaskKey}` : null,
      request.decisionRefs.length > 0
        ? `  Linked decisions: ${request.decisionRefs.join(', ')}`
        : null,
      request.attachments.length > 0
        ? `  Attachment assets: ${request.attachments.map((attachment) => attachment.assetPath).join(', ')}`
        : null,
      renderPlanningRequestAnswers(request.answers, '  ', 'Captured answers'),
      request.requestedUpdates.length > 0
        ? `  Requested durable updates: ${request.requestedUpdates.join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n'),
  )
  .join('\n')}
`
}

function renderRelatedPlanningGroups(groups: PlannerContextInputs['relatedPlanningGroups']) {
  if (groups.length === 0) {
    return ''
  }

  return `### Related Open Planning Group

${groups
  .map((group) =>
    [
      `- Group key: ${group.groupKey}`,
      ...group.requests.map((request) =>
        [
          `  - ${request.requestKey} | ${request.taskRef} | ${request.title}`,
          request.groupTaskKey ? `    Grouped task key: ${request.groupTaskKey}` : null,
          request.decisionRefs.length > 0
            ? `    Linked decisions: ${request.decisionRefs.join(', ')}`
            : null,
          renderPlanningRequestAnswers(
            request.workflowSharedAnswers,
            '    ',
            'Workflow-shared answers',
          ),
          renderPlanningRequestAnswers(request.answers, '    ', 'Captured answers'),
          request.requestedUpdates.length > 0
            ? `    Requested durable updates: ${request.requestedUpdates.join(', ')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
      ),
    ].join('\n'),
  )
  .join('\n')}
`
}

function renderRelevantGoalImages(images: RelevantGoalImage[]) {
  if (images.length === 0) {
    return ''
  }

  return `## Relevant Goal Images

${images
  .map((image) => {
    const details = [image.fileName, image.mediaType].filter(Boolean).join(' | ')
    const sourceLabel = image.sources.join(', ')
    return `- ${image.assetPath}${details ? ` | ${details}` : ''}\n  Sources: ${sourceLabel}`
  })
  .join('\n')}
`
}

function renderPlanningUpdateCoverage(
  evidence: PlannerContextInputs['planningFollowThroughEvidence'],
) {
  if (evidence.requestedUpdates.length === 0) {
    return ''
  }

  return `### Requested Planning Update Coverage

- Requested durable updates: ${evidence.requestedUpdates.join(', ')}
- Observed requested durable updates: ${evidence.observedUpdates.length > 0 ? evidence.observedUpdates.join(', ') : 'none yet'}
- Missing requested durable updates: ${evidence.missingUpdates.length > 0 ? evidence.missingUpdates.join(', ') : 'none'}
`
}

function renderPlanningRequestAnswers(
  answers: GoalPlanningRequestAnswer[],
  indent: string,
  heading: string,
) {
  if (answers.length === 0) {
    return null
  }

  const bulletIndent = indent.length > 2 ? `${indent}  - ` : `${indent}- `
  return [
    `${indent}${heading}:`,
    ...answers.map((entry) => `${bulletIndent}${formatPlanningRequestAnswer(entry)}`),
  ].join('\n')
}

function formatPlanningRequestAnswer(entry: GoalPlanningRequestAnswer) {
  const prefix = entry.prompt ? `${entry.summary} [${entry.prompt}]` : entry.summary
  const metadata = [
    entry.summaryKey ? `summaryKey=${entry.summaryKey}` : null,
    entry.answerKey ? `answerKey=${entry.answerKey}` : null,
    entry.matchHints?.length ? `matchHints=${entry.matchHints.join('|')}` : null,
    entry.captureFormat ? `captureFormat=${entry.captureFormat}` : null,
  ]
    .filter(Boolean)
    .map((value) => ` [${value}]`)
    .join('')
  return `${prefix}${metadata}: ${entry.answer}`
}

function truncatePromptBlock(content: string, maxLength = 1600) {
  const normalized = content.trim()
  if (normalized.length === 0) {
    return '(empty)'
  }

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}\n...[truncated]`
}

function capitalizeRole(role: AgentRole) {
  return role.slice(0, 1).toUpperCase() + role.slice(1)
}
