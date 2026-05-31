import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AgentRole } from '../agent/AgentRunner'
import type { TaskItem } from '../domain/board'
import { stringifyBoardYaml } from '../domain/validation'
import { type BoardStore, createBoardStore } from '../storage/boardStore'
import { type DecisionStore, createDecisionStore } from '../storage/decisionStore'
import { createProjectPaths } from '../storage/paths'
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
  preferenceFile: string
  preferenceContent: string
}

export function createRoleProcessContextBuilder(
  rootDir = process.cwd(),
  goalDocs: GoalDocsStore = createGoalDocsStore(rootDir),
  boardStore: BoardStore = createBoardStore(rootDir),
  decisions: DecisionStore = createDecisionStore(rootDir),
  preferences: PreferenceStore = createPreferenceStore(rootDir),
  writeTraces: WriteTraceStore = createWriteTraceStore(rootDir),
): RoleProcessContextBuilder {
  const paths = createProjectPaths(rootDir)

  return {
    async prepareBundle(options) {
      const docs = await goalDocs.ensureGoalDocs(options.goalKey, options.goalTitle)
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
              preferences,
              paths,
            )
          : undefined
      await mkdir(dirname(contextFile), { recursive: true })
      const context = renderContextMarkdown({
        ...options,
        contextFile,
        ...docs,
        outcomeFile,
        plannerInputs,
        relevantTraces: filterRelevantTraces(relevantTraces, options.runId),
      })
      await Bun.write(contextFile, context)
      await Bun.write(
        promptFile,
        renderPromptMarkdown({
          role: options.role,
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

${renderPlannerInputs(options.plannerInputs)}

## Runtime Output

- Write the structured outcome JSON to: ${options.outcomeFile}

${renderRelevantTraces(options.relevantTraces)}

## Boundaries

${roleBoundaryText(options.role)}
`
}

function renderRelevantTraces(entries: GoalWriteTraceEntry[]) {
  if (entries.length === 0) {
    return ''
  }

  return `## Relevant Write Traces

${entries
  .map(
    (entry) =>
      `- ${entry.timestamp} | ${entry.role} | ${entry.resultSummary} | ${entry.targetPaths.join(', ')}`,
  )
  .join('\n')}
`
}

function renderPlannerInputs(inputs?: PlannerContextInputs) {
  if (!inputs) {
    return ''
  }

  return `## Planner Durable Inputs

- todo.yml: ${inputs.todoFile}
- decisions.yml: ${inputs.decisionsFile}
- preference.md: ${inputs.preferenceFile}

### Current todo.yml

\`\`\`yaml
${inputs.todoContent.trim()}
\`\`\`

### Current decisions.yml

\`\`\`yaml
${inputs.decisionsContent.trim()}
\`\`\`

### Current preference.md

\`\`\`md
${inputs.preferenceContent.trim()}
\`\`\`
`
}

function renderPromptMarkdown(options: {
  role: AgentRole
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
  preferences: PreferenceStore,
  paths: ReturnType<typeof createProjectPaths>,
): Promise<PlannerContextInputs> {
  const board = await boardStore.readBoard(goalKey)
  await decisions.ensureGoalDecisions(goalKey)
  const preferenceDocument = await preferences.readPreferences()

  return {
    todoFile: paths.todoPath(goalKey),
    todoContent: stringifyBoardYaml(board),
    decisionsFile: paths.decisionsPath(goalKey),
    decisionsContent: await Bun.file(paths.decisionsPath(goalKey)).text(),
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

function capitalizeRole(role: AgentRole) {
  return role.slice(0, 1).toUpperCase() + role.slice(1)
}
