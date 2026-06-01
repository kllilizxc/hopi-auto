import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { stringifyBoardYaml } from '../domain/validation'
import {
  type AssistantThreadStore,
  createAssistantThreadStore,
} from '../runtime/assistantThreadStore'
import { type GoalDocsStore, createGoalDocsStore } from '../runtime/goalDocsStore'
import type { RoleProcessContextBundle } from '../runtime/roleProcessContext'
import { type RunHistoryStore, createRunHistoryStore } from '../runtime/runHistoryStore'
import { type WriteTraceStore, createWriteTraceStore } from '../runtime/writeTraceStore'
import { type BoardStore, createBoardStore } from '../storage/boardStore'
import { type DecisionStore, createDecisionStore } from '../storage/decisionStore'
import { createProjectPaths } from '../storage/paths'
import {
  type PlanningRequestStore,
  createPlanningRequestStore,
} from '../storage/planningRequestStore'
import { type PreferenceStore, createPreferenceStore } from '../storage/preferenceStore'

export interface PrepareGoalAssistantBundleOptions {
  goalKey: string
  assistantRunId: string
}

export interface GoalAssistantContextBuilder {
  prepareBundle(options: PrepareGoalAssistantBundleOptions): Promise<RoleProcessContextBundle>
}

export function createGoalAssistantContextBuilder(
  rootDir = process.cwd(),
  boardStore: BoardStore = createBoardStore(rootDir),
  decisions: DecisionStore = createDecisionStore(rootDir),
  planningRequests: PlanningRequestStore = createPlanningRequestStore(rootDir),
  preferences: PreferenceStore = createPreferenceStore(rootDir),
  threadStore: AssistantThreadStore = createAssistantThreadStore(rootDir),
  goalDocs: GoalDocsStore = createGoalDocsStore(rootDir),
  history: RunHistoryStore = createRunHistoryStore(rootDir),
  writeTraces: WriteTraceStore = createWriteTraceStore(rootDir),
): GoalAssistantContextBuilder {
  const paths = createProjectPaths(rootDir)

  return {
    async prepareBundle(options) {
      const board = await boardStore.readBoard(options.goalKey)
      const docs = await goalDocs.ensureGoalDocs(options.goalKey, board.goal.title)
      await decisions.ensureGoalDecisions(options.goalKey)
      await planningRequests.ensureGoalPlanningRequests(options.goalKey)
      const preferenceDocument = await preferences.readPreferences()
      const thread = await threadStore.readThread(options.goalKey)
      const runs = await history.listRuns(options.goalKey)
      const traces = await writeTraces.listEntries(options.goalKey, { limit: 8 })
      const contextFile = paths.assistantContextPath(options.goalKey, options.assistantRunId)
      const promptFile = paths.assistantPromptPath(options.goalKey, options.assistantRunId)
      const outcomeFile = paths.assistantOutcomePath(options.goalKey, options.assistantRunId)

      await mkdir(dirname(contextFile), { recursive: true })
      const context = renderAssistantContext({
        goalKey: options.goalKey,
        boardYaml: stringifyBoardYaml(board),
        goalFile: docs.goalFile,
        designFile: docs.designFile,
        todoFile: paths.todoPath(options.goalKey),
        decisionsFile: paths.decisionsPath(options.goalKey),
        decisionsContent: await Bun.file(paths.decisionsPath(options.goalKey)).text(),
        planningRequestsFile: paths.planningRequestsPath(options.goalKey),
        planningRequestsContent: await Bun.file(paths.planningRequestsPath(options.goalKey)).text(),
        preferenceFile: preferenceDocument.path,
        preferenceContent: preferenceDocument.content,
        threadEntries: thread.entries.slice(-12),
        runSummaries: runs.slice(0, 6),
        traces,
        outcomeFile,
      })

      await Bun.write(contextFile, context)
      await Bun.write(
        promptFile,
        renderAssistantPrompt({
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

function renderAssistantContext(options: {
  goalKey: string
  boardYaml: string
  goalFile: string
  designFile: string
  todoFile: string
  decisionsFile: string
  decisionsContent: string
  planningRequestsFile: string
  planningRequestsContent: string
  preferenceFile: string
  preferenceContent: string
  threadEntries: Awaited<ReturnType<AssistantThreadStore['readThread']>>['entries']
  runSummaries: Awaited<ReturnType<RunHistoryStore['listRuns']>>
  traces: Awaited<ReturnType<WriteTraceStore['listEntries']>>
  outcomeFile: string
}) {
  return `# HOPI Goal Assistant Context

Goal Key: ${options.goalKey}

## Durable Goal Docs

- goal.md: ${options.goalFile}
- design.md: ${options.designFile}
- todo.yml: ${options.todoFile}
- decisions.yml: ${options.decisionsFile}
- planning-requests.yml: ${options.planningRequestsFile}
- preference.md: ${options.preferenceFile}

## Current todo.yml

\`\`\`yaml
${options.boardYaml.trim()}
\`\`\`

## Current decisions.yml

\`\`\`yaml
${(options.decisionsContent || 'version: 1\n').trim()}
\`\`\`

## Current planning-requests.yml

\`\`\`yaml
${(options.planningRequestsContent || 'version: 1\n').trim()}
\`\`\`

## Current preference.md

\`\`\`md
${options.preferenceContent.trim()}
\`\`\`

${renderRecentThread(options.threadEntries)}

${renderRecentRuns(options.runSummaries)}

${renderRecentWriteTraces(options.traces)}

## Runtime Output

- Write the structured assistant outcome JSON to: ${options.outcomeFile}

## Boundaries

- Do not edit source files.
- Do not edit goal.md or design.md directly.
- Do not create engineering tasks.
- Use actions only for visible planning work, legal task moves, decision answers, and durable preferences.
`
}

function renderAssistantPrompt(options: { context: string; outcomeFile: string }) {
  return `# HOPI Goal Assistant Prompt

You are the HOPI Goal assistant for one explicit Goal-scoped user request.

Before you finish:

- read the bundled Goal context below
- do not write source files
- do not create engineering tasks
- use only the constrained actions described here
- write one structured JSON object to: ${options.outcomeFile}

Required outcome shape:

\`\`\`json
{
  "message": "user-facing reply",
  "actions": [
    {
      "kind": "move_task",
      "taskRef": "P-1",
      "status": "in_review",
      "reason": "why the move is legal"
    },
    {
      "kind": "create_planning_task",
      "title": "visible planning task title",
      "description": "visible planning task description",
      "acceptanceCriteria": ["at least one acceptance criterion"],
      "blockedBy": []
    },
    {
      "kind": "request_planning",
      "groupKey": "optional-stable-group-key",
      "title": "planning request title",
      "description": "why visible planning work is needed",
      "acceptanceCriteria": ["what the planner-visible request must accomplish"],
      "decisionRefs": ["optional linked decision key"],
      "requestedUpdates": ["goal.md", "design.md", "notes/rollout.md", "todo.yml"],
      "blockedBy": []
    },
    {
      "kind": "request_planning_batch",
      "groupKey": "stable-group-key",
      "decisionRefs": ["optional linked decision key"],
      "requests": [
        {
          "taskKey": "goal-docs",
          "title": "first visible planning task title",
          "description": "what this planning stage must accomplish",
          "acceptanceCriteria": ["at least one acceptance criterion"],
          "requestedUpdates": ["goal.md", "design.md", "research.md"],
          "blockedByTaskKeys": []
        },
        {
          "taskKey": "task-graph",
          "title": "second visible planning task title",
          "description": "what this later planning stage must accomplish",
          "acceptanceCriteria": ["at least one acceptance criterion"],
          "requestedUpdates": ["todo.yml"],
          "blockedByTaskKeys": ["goal-docs"]
        }
      ]
    },
    {
      "kind": "request_decision",
      "decisionKey": "stable-decision-key",
      "summary": "highest-leverage missing answer",
      "taskRef": "optional task ref to block visibly"
    },
    {
      "kind": "resolve_decision",
      "decisionKey": "stable-decision-key",
      "summary": "required if the decision topic does not already exist",
      "taskRef": "optional linked task ref",
      "answer": "explicit user answer",
      "followThrough": {
        "kind": "planning_batch",
        "groupKey": "stable-group-key",
        "requests": [
          {
            "taskKey": "goal-docs",
            "title": "first visible planning task title",
            "description": "what this planning stage must accomplish after the answer",
            "acceptanceCriteria": ["at least one acceptance criterion"],
            "requestedUpdates": ["goal.md", "design.md", "research.md"],
            "blockedByTaskKeys": []
          },
          {
            "taskKey": "task-graph",
            "title": "second visible planning task title",
            "description": "what this later planning stage must accomplish",
            "acceptanceCriteria": ["at least one acceptance criterion"],
            "requestedUpdates": ["todo.yml"],
            "blockedByTaskKeys": ["goal-docs"]
          }
        ]
      }
    },
    {
      "kind": "record_preference",
      "summary": "one durable repo-level preference"
    },
    {
      "kind": "update_preference",
      "content": "# Preferences\\n\\n- Durable preference."
    }
  ]
}
\`\`\`

Rules:

- If no durable action is needed, return an empty actions array.
- Only move tasks through legal manual transitions.
- Only create planning tasks, never engineering tasks.
- Prefer "request_planning" when the user asks for new visible planning work; it can reuse an existing open planning request with the same title.
- Prefer "request_planning_batch" when one durable follow-through must span more than one visible planning task.
- Treat "taskKey" inside "request_planning_batch" as a stable grouped task key you can reuse in later grouped batches.
- Treat open planning requests as durable planner follow-through requests, not disposable notes.
- When a planning request exists because one or more answers reshape durable goal context, design rationale, or task decomposition, record that through decisionRefs and requestedUpdates.
- When resolving an engineering-linked decision and the answer implies richer planner follow-through than one generic bridge, prefer "followThrough" on "resolve_decision" over a separate follow-up planning action.
- Never include decisionRefs inside resolve_decision.followThrough; runtime injects the resolved decision lineage automatically.
- Treat requestedUpdates as Goal-local relative paths under .hopi/docs/goals/<goalKey>/, such as goal.md, design.md, todo.yml, research.md, or notes/rollout.md.
- Do not use absolute paths, parent traversal, or reserved Goal state files inside requestedUpdates.
- Use "request_decision" when one explicit missing answer should block visible planning follow-through.
- If you resolve a decision whose durable topic may not exist yet, include a concise summary.
- Prefer "record_preference" for adding one durable preference; use "update_preference" only when intentionally rewriting the full preference document.
- Keep the message grounded in the current Goal state.

## Bundled Context

${options.context}
`
}

function renderRecentThread(
  entries: Awaited<ReturnType<AssistantThreadStore['readThread']>>['entries'],
) {
  if (entries.length === 0) {
    return '## Recent Assistant Thread\n\n- No assistant thread entries recorded yet.\n'
  }

  return `## Recent Assistant Thread

${entries
  .map((entry) => {
    if (entry.kind === 'user_message' || entry.kind === 'assistant_message') {
      return `- ${entry.createdAt} | ${entry.kind} | ${entry.content}`
    }
    if (entry.kind === 'action' || entry.kind === 'action_result') {
      return `- ${entry.createdAt} | ${entry.kind} | ${entry.actionType} | ${entry.summary}`
    }
    return `- ${entry.createdAt} | ${entry.kind}`
  })
  .join('\n')}
`
}

function renderRecentRuns(runs: Awaited<ReturnType<RunHistoryStore['listRuns']>>) {
  if (runs.length === 0) {
    return '## Recent Goal Runs\n\n- No task runs recorded yet.\n'
  }

  return `## Recent Goal Runs

${runs
  .map(
    (run) =>
      `- ${run.runId} | ${run.taskRef} | ${run.taskKind} | ${run.status} | ${run.terminalOutcome ?? 'running'}`,
  )
  .join('\n')}
`
}

function renderRecentWriteTraces(traces: Awaited<ReturnType<WriteTraceStore['listEntries']>>) {
  if (traces.length === 0) {
    return '## Recent Write Traces\n\n- No durable write traces recorded yet.\n'
  }

  return `## Recent Write Traces

${traces
  .map(
    (entry) =>
      `- ${entry.timestamp} | ${entry.taskRef} | ${entry.role} | ${entry.resultSummary} | ${entry.targetPaths.join(', ')}`,
  )
  .join('\n')}
`
}
