import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AgentRole } from '../agent/AgentRunner'
import type { TaskItem } from '../domain/board'
import { stringifyBoardYaml } from '../domain/validation'
import { type BoardStore, createBoardStore } from '../storage/boardStore'
import { type DecisionStore, createDecisionStore } from '../storage/decisionStore'
import { createProjectPaths } from '../storage/paths'
import {
  type GoalPlanningRequest,
  type GoalPlanningRequestAnswer,
  type GoalPlanningRequestUpdateTarget,
  type PlanningRequestStore,
  createPlanningRequestStore,
} from '../storage/planningRequestStore'
import { type PreferenceStore, createPreferenceStore } from '../storage/preferenceStore'
import { type GoalDocsStore, createGoalDocsStore } from './goalDocsStore'
import { summarizePlanningFollowThroughEvidence } from './planningFollowThroughEvidence'
import { type RunHistoryStore, createRunHistoryStore } from './runHistoryStore'
import type { GoalWriteTraceEntry } from './writeTrace'
import { type WriteTraceStore, createWriteTraceStore } from './writeTraceStore'

export interface RoleProcessContextBundle {
  goalFile: string
  designFile: string
  contextFile: string
  promptFile: string
  outcomeFile: string
}

export interface PrepareRoleProcessBundleOptions {
  goalKey: string
  goalTitle: string
  runId: string
  stepId: string
  role: AgentRole
  task: TaskItem
}

export interface RoleProcessContextBuilder {
  prepareBundle(options: PrepareRoleProcessBundleOptions): Promise<RoleProcessContextBundle>
}

interface PlannerContextInputs {
  goalDocsRoot: string
  todoFile: string
  todoContent: string
  decisionsFile: string
  decisionsContent: string
  planningRequestsFile: string
  planningRequestsContent: string
  relevantPlanningRequests: Array<{
    requestKey: string
    workflowKey?: string
    workflowTaskKey?: string
    blockedByWorkflowKeys: string[]
    groupKey?: string
    groupTaskKey?: string
    title: string
    taskRef: string
    decisionRefs: string[]
    answers: GoalPlanningRequestAnswer[]
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
}

interface GoalDocsStatusInputs {
  goalStatus: 'bootstrapped' | 'curated'
  designStatus: 'bootstrapped' | 'curated'
}

interface RelevantRunEvidence {
  runId: string
  stepId: string
  role: AgentRole
  outcome: string
  artifacts: Array<{ ref: string; label: string }>
  transcriptSummaries: string[]
  worktreePath?: string
}

export function createRoleProcessContextBuilder(
  rootDir = process.cwd(),
  goalDocs: GoalDocsStore = createGoalDocsStore(rootDir),
  boardStore: BoardStore = createBoardStore(rootDir),
  decisions: DecisionStore = createDecisionStore(rootDir),
  planningRequests: PlanningRequestStore = createPlanningRequestStore(rootDir),
  preferences: PreferenceStore = createPreferenceStore(rootDir),
  history: RunHistoryStore = createRunHistoryStore(rootDir),
  writeTraces: WriteTraceStore = createWriteTraceStore(rootDir),
): RoleProcessContextBuilder {
  const paths = createProjectPaths(rootDir)

  return {
    async prepareBundle(options) {
      const docs = await goalDocs.ensureGoalDocs(options.goalKey, options.goalTitle)
      const docsSnapshot = await goalDocs.readGoalDocs(options.goalKey, options.goalTitle)
      const contextFile = paths.runtimeContextPath(options.goalKey, options.runId, options.stepId)
      const promptFile = paths.runtimePromptPath(options.goalKey, options.runId, options.stepId)
      const outcomeFile = paths.runtimeOutcomePath(options.goalKey, options.runId, options.stepId)

      const relevantTraces = (
        await writeTraces.listEntries(options.goalKey, {
          taskRef: options.task.ref,
          limit: 12,
        })
      ).filter((entry) => entry.stepId !== options.stepId)
      const relevantRunEvidence = await loadRelevantRunEvidence({
        goalKey: options.goalKey,
        runId: options.runId,
        stepId: options.stepId,
        role: options.role,
        task: options.task,
        history,
      })
      const plannerInputs =
        options.task.kind === 'planning'
          ? await loadPlannerContextInputs(
              options.goalKey,
              boardStore,
              decisions,
              planningRequests,
              preferences,
              paths,
              options.task.ref,
              filterRelevantTraces(relevantTraces, options.runId),
            )
          : undefined
      await mkdir(dirname(contextFile), { recursive: true })
      const context = renderContextMarkdown({
        ...options,
        contextFile,
        ...docs,
        outcomeFile,
        plannerInputs,
        docsStatus: {
          goalStatus: docsSnapshot.goal.status,
          designStatus: docsSnapshot.design.status,
        },
        relevantRunEvidence,
        relevantTraces: filterRelevantTraces(relevantTraces, options.runId),
      })
      await Bun.write(contextFile, context)
      await Bun.write(
        promptFile,
        renderPromptMarkdown({
          role: options.role,
          taskKind: options.task.kind,
          docsStatus: {
            goalStatus: docsSnapshot.goal.status,
            designStatus: docsSnapshot.design.status,
          },
          context,
          outcomeFile,
        }),
      )
      await Bun.write(outcomeFile, '')

      return {
        goalFile: docs.goalFile,
        designFile: docs.designFile,
        contextFile,
        promptFile,
        outcomeFile,
      }
    },
  }
}

function renderContextMarkdown(
  options: PrepareRoleProcessBundleOptions &
    Pick<RoleProcessContextBundle, 'contextFile' | 'goalFile' | 'designFile' | 'outcomeFile'> & {
      goalFile: string
      designFile: string
      plannerInputs?: PlannerContextInputs
      docsStatus: GoalDocsStatusInputs
      relevantRunEvidence: RelevantRunEvidence[]
      relevantTraces: GoalWriteTraceEntry[]
    },
) {
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

## Durable Goal Docs

- goal.md: ${options.goalFile}
- design.md: ${options.designFile}

## Goal Docs Status

- goal.md status: ${options.docsStatus.goalStatus}
- design.md status: ${options.docsStatus.designStatus}

${renderPlannerInputs(options.plannerInputs)}

## Runtime Output

- Write the structured outcome JSON to: ${options.outcomeFile}

${renderRelevantRunEvidence(options.role, options.relevantRunEvidence)}

${renderRelevantTraces(options.role, options.task.kind, options.relevantTraces)}

## Boundaries

${roleBoundaryText(options.role)}
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
  const changes =
    entry.changes.length === 0
      ? 'none'
      : entry.changes.map((change) => `${change.kind} ${change.path}`).join(', ')

  return `- ${entry.timestamp} | ${entry.role} | ${entry.resultSummary} | ${entry.targetPaths.join(', ')}
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
`
}

function renderPromptMarkdown(options: {
  role: AgentRole
  taskKind: TaskItem['kind']
  docsStatus: GoalDocsStatusInputs
  context: string
  outcomeFile: string
}) {
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

## Bundled Context

${options.context}
`
}

function filterRelevantTraces(entries: GoalWriteTraceEntry[], runId: string) {
  const sameRun = entries.filter((entry) => entry.runId === runId)
  const previousTaskEntries = entries.filter((entry) => entry.runId !== runId)
  return [...sameRun, ...previousTaskEntries].slice(0, 6)
}

async function loadPlannerContextInputs(
  goalKey: string,
  boardStore: BoardStore,
  decisions: DecisionStore,
  planningRequests: PlanningRequestStore,
  preferences: PreferenceStore,
  paths: ReturnType<typeof createProjectPaths>,
  taskRef: string,
  relevantTraces: GoalWriteTraceEntry[],
): Promise<PlannerContextInputs> {
  const board = await boardStore.readBoard(goalKey)
  await decisions.ensureGoalDecisions(goalKey)
  const planningRequestSet = await planningRequests.ensureGoalPlanningRequests(goalKey)
  const preferenceDocument = await preferences.readPreferences()
  const relevantPlanningRequests = planningRequestSet.requests
    .filter((request) => request.status === 'open' && request.taskRef === taskRef)
    .map((request) => ({
      requestKey: request.requestKey,
      workflowKey: request.workflowKey,
      workflowTaskKey: request.workflowTaskKey,
      blockedByWorkflowKeys: request.blockedByWorkflowKeys,
      groupKey: request.groupKey,
      groupTaskKey: request.groupTaskKey,
      title: request.title,
      taskRef: request.taskRef,
      decisionRefs: request.decisionRefs,
      answers: request.answers,
      requestedUpdates: request.requestedUpdates,
    }))
  const relatedPlanningGroups = summarizeRelatedPlanningGroups(planningRequestSet.requests, taskRef)
  const planningFollowThroughEvidence = summarizePlanningFollowThroughEvidence(
    planningRequestSet.requests.filter(
      (request) => request.status === 'open' && request.taskRef === taskRef,
    ),
    relevantTraces,
  )

  return {
    goalDocsRoot: dirname(paths.todoPath(goalKey)),
    todoFile: paths.todoPath(goalKey),
    todoContent: stringifyBoardYaml(board),
    decisionsFile: paths.decisionsPath(goalKey),
    decisionsContent: await Bun.file(paths.decisionsPath(goalKey)).text(),
    planningRequestsFile: paths.planningRequestsPath(goalKey),
    planningRequestsContent: await Bun.file(paths.planningRequestsPath(goalKey)).text(),
    relevantPlanningRequests,
    relatedPlanningGroups,
    planningFollowThroughEvidence: {
      requestedUpdates: planningFollowThroughEvidence.requestedUpdates,
      observedUpdates: planningFollowThroughEvidence.observedUpdates,
      missingUpdates: planningFollowThroughEvidence.missingUpdates,
    },
    preferenceFile: preferenceDocument.path,
    preferenceContent: preferenceDocument.content,
  }
}

function roleBoundaryText(role: AgentRole) {
  if (role === 'planner') {
    return 'Planner may edit goal.md and design.md plus other Goal-local durable docs under .hopi/docs/goals/<goalKey>/ when needed to record durable Goal context.'
  }

  return 'Do not edit .hopi/docs/**. Generator, reviewer, and merger work must leave durable Goal docs unchanged.'
}

function renderRoleEvidencePolicy(role: AgentRole, taskKind: TaskItem['kind']) {
  if (taskKind === 'engineering' && role === 'reviewer') {
    return `## Role Evidence Policy

- Reviewer must use relevant write traces as execution evidence.
- Correlate artifact refs and prior run history with the claimed work before accepting.
- If there are no relevant traces or the traces do not support the claimed work, prefer reject or fail over blind acceptance.
`
  }

  if (taskKind === 'engineering' && role === 'merger') {
    return `## Role Evidence Policy

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
- If a relevant planning request targets goal.md, update durable Goal context before returning success.
- When decisions materially change decomposition, summarize the implication in design.md before concluding planning work.
- Address open planning requests linked to this task before returning success.
- If a relevant planning request targets design.md, update durable design rationale before returning success.
- If a relevant planning request targets another Goal-local path, create or update that durable document before returning success.
- If a relevant planning request targets todo.yml, reshape the visible task graph before returning success.
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
      request.workflowTaskKey ? `  Workflow task key: ${request.workflowTaskKey}` : null,
      request.blockedByWorkflowKeys.length > 0
        ? `  Workflow dependencies: ${request.blockedByWorkflowKeys.join(', ')}`
        : null,
      request.groupKey ? `  Planning group: ${request.groupKey}` : null,
      request.groupTaskKey ? `  Grouped task key: ${request.groupTaskKey}` : null,
      request.decisionRefs.length > 0
        ? `  Linked decisions: ${request.decisionRefs.join(', ')}`
        : null,
      renderPlanningRequestAnswers(request.answers, '  '),
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
          renderPlanningRequestAnswers(request.answers, '    '),
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

function renderPlanningRequestAnswers(answers: GoalPlanningRequestAnswer[], indent: string) {
  if (answers.length === 0) {
    return null
  }

  const bulletIndent = indent.length > 2 ? `${indent}  - ` : `${indent}- `
  return [
    `${indent}Captured answers:`,
    ...answers.map((entry) => `${bulletIndent}${entry.summary}: ${entry.answer}`),
  ].join('\n')
}

function summarizeRelatedPlanningGroups(requests: GoalPlanningRequest[], taskRef: string) {
  const currentGroupKeys = mergeUniqueStrings(
    requests
      .filter((request) => request.status === 'open' && request.taskRef === taskRef)
      .map((request) => request.groupKey)
      .filter((groupKey): groupKey is string => Boolean(groupKey)),
  )

  return currentGroupKeys
    .map((groupKey) => ({
      groupKey,
      requests: requests
        .filter(
          (request) =>
            request.status === 'open' &&
            request.groupKey === groupKey &&
            request.taskRef !== taskRef,
        )
        .map((request) => ({
          requestKey: request.requestKey,
          groupTaskKey: request.groupTaskKey,
          taskRef: request.taskRef,
          title: request.title,
          decisionRefs: request.decisionRefs,
          answers: request.answers,
          requestedUpdates: request.requestedUpdates,
        })),
    }))
    .filter((group) => group.requests.length > 0)
}

function mergeUniqueStrings(values: string[]) {
  const merged: string[] = []
  for (const value of values) {
    if (!merged.includes(value)) {
      merged.push(value)
    }
  }
  return merged
}

async function loadRelevantRunEvidence(options: {
  goalKey: string
  runId: string
  stepId: string
  role: AgentRole
  task: TaskItem
  history: RunHistoryStore
}) {
  if (
    options.task.kind !== 'engineering' ||
    (options.role !== 'reviewer' && options.role !== 'merger')
  ) {
    return []
  }

  const goalHistory = await options.history.readGoalHistory(options.goalKey)
  const currentRun = goalHistory.runs.find((run) => run.runId === options.runId)
  const otherRuns = goalHistory.runs
    .filter((run) => run.taskRef === options.task.ref && run.runId !== options.runId)
    .toReversed()
  const orderedRuns = [...(currentRun ? [currentRun] : []), ...otherRuns]

  return orderedRuns
    .flatMap((run) =>
      run.steps
        .filter((step) => step.stepId !== options.stepId)
        .filter(
          (step) =>
            Boolean(step.execution?.worktree) ||
            (step.execution?.artifacts.length ?? 0) > 0 ||
            step.transcript.length > 0,
        )
        .map((step) => ({
          runId: run.runId,
          stepId: step.stepId,
          role: step.role,
          outcome: step.outcome,
          artifacts: step.execution?.artifacts ?? [],
          transcriptSummaries: summarizeTranscriptEvidence(step.transcript).slice(0, 4),
          worktreePath: step.execution?.worktree?.path,
        })),
    )
    .slice(0, 6)
}

function summarizeTranscriptEvidence(
  entries: Array<{
    kind: 'status' | 'assistant' | 'tool_call' | 'tool_result' | 'error'
    summary: string
    toolName?: string
    toolInvocationKey?: string
  }>,
) {
  const summaries: string[] = []
  const interactions = new Map<
    string,
    {
      toolName?: string
      callSummary?: string
      resultSummaries: string[]
    }
  >()
  const orderedKeys: string[] = []

  for (const entry of entries) {
    if (entry.toolInvocationKey && (entry.kind === 'tool_call' || entry.kind === 'tool_result')) {
      const current = interactions.get(entry.toolInvocationKey)
      if (!current) {
        interactions.set(entry.toolInvocationKey, {
          toolName: entry.toolName,
          callSummary: entry.kind === 'tool_call' ? entry.summary : undefined,
          resultSummaries: entry.kind === 'tool_result' ? [entry.summary] : [],
        })
        orderedKeys.push(entry.toolInvocationKey)
      } else {
        current.toolName ??= entry.toolName
        if (entry.kind === 'tool_call') {
          current.callSummary ??= entry.summary
        } else {
          current.resultSummaries.push(entry.summary)
        }
      }
      continue
    }

    summaries.push(entry.summary)
  }

  for (const key of orderedKeys) {
    const interaction = interactions.get(key)
    if (!interaction) {
      continue
    }

    const toolLabel = interaction.toolName ?? interaction.callSummary ?? 'Tool interaction'
    if (interaction.resultSummaries.length > 0) {
      summaries.push(`${toolLabel} [${key}] -> ${interaction.resultSummaries.join(' / ')}`)
      continue
    }

    if (interaction.callSummary) {
      summaries.push(`${interaction.callSummary} [${key}]`)
    }
  }

  return summaries
}

function capitalizeRole(role: AgentRole) {
  return role.slice(0, 1).toUpperCase() + role.slice(1)
}
