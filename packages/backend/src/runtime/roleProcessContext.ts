import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AgentRole } from '../agent/AgentRunner'
import type { TaskItem } from '../domain/board'
import { stringifyBoardYaml } from '../domain/validation'
import { type BoardStore, createBoardStore } from '../storage/boardStore'
import { type DecisionStore, createDecisionStore } from '../storage/decisionStore'
import { createProjectPaths } from '../storage/paths'
import {
  type PlanningRequestStore,
  createPlanningRequestStore,
} from '../storage/planningRequestStore'
import { type PreferenceStore, createPreferenceStore } from '../storage/preferenceStore'
import { type GoalDocsStore, createGoalDocsStore } from './goalDocsStore'
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
  todoFile: string
  todoContent: string
  decisionsFile: string
  decisionsContent: string
  planningRequestsFile: string
  planningRequestsContent: string
  relevantPlanningRequests: Array<{
    requestKey: string
    title: string
    taskRef: string
  }>
  preferenceFile: string
  preferenceContent: string
}

interface GoalDocsStatusInputs {
  goalStatus: 'bootstrapped' | 'curated'
  designStatus: 'bootstrapped' | 'curated'
}

export function createRoleProcessContextBuilder(
  rootDir = process.cwd(),
  goalDocs: GoalDocsStore = createGoalDocsStore(rootDir),
  boardStore: BoardStore = createBoardStore(rootDir),
  decisions: DecisionStore = createDecisionStore(rootDir),
  planningRequests: PlanningRequestStore = createPlanningRequestStore(rootDir),
  preferences: PreferenceStore = createPreferenceStore(rootDir),
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
      const plannerInputs =
        options.role === 'planner'
          ? await loadPlannerContextInputs(
              options.goalKey,
              boardStore,
              decisions,
              planningRequests,
              preferences,
              paths,
              options.task.ref,
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

    return ''
  }

  return `## Relevant Write Traces

${entries.map((entry) => renderTraceEntry(entry)).join('\n')}
`
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
): Promise<PlannerContextInputs> {
  const board = await boardStore.readBoard(goalKey)
  await decisions.ensureGoalDecisions(goalKey)
  const planningRequestSet = await planningRequests.ensureGoalPlanningRequests(goalKey)
  const preferenceDocument = await preferences.readPreferences()

  return {
    todoFile: paths.todoPath(goalKey),
    todoContent: stringifyBoardYaml(board),
    decisionsFile: paths.decisionsPath(goalKey),
    decisionsContent: await Bun.file(paths.decisionsPath(goalKey)).text(),
    planningRequestsFile: paths.planningRequestsPath(goalKey),
    planningRequestsContent: await Bun.file(paths.planningRequestsPath(goalKey)).text(),
    relevantPlanningRequests: planningRequestSet.requests
      .filter((request) => request.status === 'open' && request.taskRef === taskRef)
      .map((request) => ({
        requestKey: request.requestKey,
        title: request.title,
        taskRef: request.taskRef,
      })),
    preferenceFile: preferenceDocument.path,
    preferenceContent: preferenceDocument.content,
  }
}

function roleBoundaryText(role: AgentRole) {
  if (role === 'planner') {
    return 'Planner may edit goal.md and design.md when needed to record durable Goal context.'
  }

  return 'Do not edit .hopi/docs/**. Generator, reviewer, and merger work must leave durable Goal docs unchanged.'
}

function renderRoleEvidencePolicy(role: AgentRole, taskKind: TaskItem['kind']) {
  if (taskKind !== 'engineering') {
    return ''
  }

  if (role === 'reviewer') {
    return `## Role Evidence Policy

- Reviewer must use relevant write traces as execution evidence.
- If there are no relevant traces or the traces do not support the claimed work, prefer reject or fail over blind acceptance.
`
  }

  if (role === 'merger') {
    return `## Role Evidence Policy

- Merger must inspect relevant write traces before returning success.
- Merger must not return success blindly when engineering write-trace evidence is missing.
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
- When decisions materially change decomposition, summarize the implication in design.md before concluding planning work.
- Address open planning requests linked to this task before returning success.
`
}

function renderRelevantPlanningRequests(
  requests: PlannerContextInputs['relevantPlanningRequests'],
) {
  if (requests.length === 0) {
    return ''
  }

  return `### Relevant Open Planning Requests For This Task

${requests.map((request) => `- ${request.requestKey} | ${request.title} | ${request.taskRef}`).join('\n')}
`
}

function capitalizeRole(role: AgentRole) {
  return role.slice(0, 1).toUpperCase() + role.slice(1)
}
