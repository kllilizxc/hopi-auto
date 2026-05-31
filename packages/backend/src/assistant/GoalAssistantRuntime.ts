import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { AgentRuntimeEvent } from '../agent/AgentRunner'
import { agentAdapterConfigSchema } from '../agent/adapterConfig'
import { normalizeProcessOutputLine } from '../agent/vendorTranscript'
import { resolveConfiguredTransportCommand } from '../agent/vendorTransport'
import type { TaskStatus } from '../domain/board'
import {
  type AssistantThreadStore,
  createAssistantThreadStore,
} from '../runtime/assistantThreadStore'
import { requestGoalDecision, resolveGoalDecision } from '../runtime/decisionRequest'
import { type BoardStore, createBoardStore } from '../storage/boardStore'
import { type DecisionStore, createDecisionStore } from '../storage/decisionStore'
import { createProjectPaths } from '../storage/paths'
import { type PreferenceStore, createPreferenceStore } from '../storage/preferenceStore'
import {
  type GoalAssistantAction,
  type GoalAssistantActionResult,
  type GoalAssistantRunRecord,
  assistantActionSchema,
} from './assistantRun'
import {
  type GoalAssistantContextBuilder,
  createGoalAssistantContextBuilder,
} from './goalAssistantContext'

const assistantOutcomeSchema = z.object({
  message: z.string().min(1),
  actions: z.array(assistantActionSchema).default([]),
})

export interface GoalAssistantRuntime {
  isConfigured(): Promise<boolean>
  run(input: { goalKey: string; content: string }): Promise<GoalAssistantRunRecord>
}

export class GoalAssistantNotConfiguredError extends Error {}

export function createGoalAssistantRuntime(
  rootDir = process.cwd(),
  boardStore: BoardStore = createBoardStore(rootDir),
  decisions: DecisionStore = createDecisionStore(rootDir),
  preferences: PreferenceStore = createPreferenceStore(rootDir),
  threadStore: AssistantThreadStore = createAssistantThreadStore(rootDir),
  contextBuilder: GoalAssistantContextBuilder = createGoalAssistantContextBuilder(
    rootDir,
    boardStore,
    decisions,
    preferences,
    threadStore,
  ),
): GoalAssistantRuntime {
  const paths = createProjectPaths(rootDir)

  return {
    async isConfigured() {
      const config = await readAdapterConfig(paths.adapterConfigPath())
      return Boolean(config?.assistant)
    },
    async run(input) {
      const config = await readAdapterConfig(paths.adapterConfigPath())
      if (!config?.assistant) {
        throw new GoalAssistantNotConfiguredError('Goal assistant is not configured.')
      }
      if (config.assistant.cwdMode !== 'root') {
        throw new Error('Goal assistant transports must use root cwdMode.')
      }

      const assistantRunId = crypto.randomUUID()
      const startedAt = new Date().toISOString()
      const events: AgentRuntimeEvent[] = []
      const actionResults: GoalAssistantActionResult[] = []
      await threadStore.appendUserMessage(input.goalKey, input.content)

      try {
        const bundle = await contextBuilder.prepareBundle({
          goalKey: input.goalKey,
          assistantRunId,
        })
        const command = await resolveConfiguredTransportCommand({
          config: config.assistant,
          bundle,
          input: {
            goalKey: input.goalKey,
            runId: assistantRunId,
            stepId: 'assistant',
            role: 'assistant',
          },
        })
        const outcome = await runAssistantCommand(rootDir, command, events)
        await threadStore.appendEntry(input.goalKey, {
          kind: 'assistant_message',
          content: outcome.message,
        })

        for (const action of outcome.actions) {
          await threadStore.appendEntry(input.goalKey, {
            kind: 'action',
            actionType: action.kind,
            summary: summarizeAssistantAction(action),
          })
          const result = await applyAssistantAction(input.goalKey, action, {
            boardStore,
            decisions,
            preferences,
          })
          actionResults.push(result)
          await threadStore.appendEntry(input.goalKey, {
            kind: 'action_result',
            actionType: action.kind,
            summary: result.summary,
          })
        }

        const endedAt = new Date().toISOString()
        const record: GoalAssistantRunRecord = {
          goalKey: input.goalKey,
          assistantRunId,
          startedAt,
          endedAt,
          requestContent: input.content,
          status: 'completed',
          message: outcome.message,
          actions: outcome.actions,
          events,
          actionResults,
        }
        await writeJsonAtomically(paths.assistantResultPath(input.goalKey, assistantRunId), record)
        return record
      } catch (error) {
        const endedAt = new Date().toISOString()
        await writeJsonAtomically(paths.assistantResultPath(input.goalKey, assistantRunId), {
          goalKey: input.goalKey,
          assistantRunId,
          startedAt,
          endedAt,
          requestContent: input.content,
          status: 'failed',
          message: '',
          actions: [],
          events,
          actionResults,
          error: errorMessage(error),
        })
        throw error
      }
    },
  }
}

async function applyAssistantAction(
  goalKey: string,
  action: GoalAssistantAction,
  stores: {
    boardStore: BoardStore
    decisions: DecisionStore
    preferences: PreferenceStore
  },
): Promise<GoalAssistantActionResult> {
  if (action.kind === 'move_task') {
    await stores.boardStore.mutateBoard(
      goalKey,
      'assistant',
      `assistant move ${action.taskRef} ${action.status}`,
      (board) => {
        const task = board.items.find((item) => item.ref === action.taskRef)
        if (!task) {
          throw new Error(`Task not found: ${action.taskRef}`)
        }
        if (!isLegalManualTransition(task.status, action.status)) {
          throw new Error(`Illegal manual transition: ${task.status} -> ${action.status}`)
        }
        task.status = action.status
      },
    )

    return {
      kind: 'move_task',
      taskRef: action.taskRef,
      status: action.status,
      summary: `Moved ${action.taskRef} to ${action.status}.`,
    }
  }

  if (action.kind === 'create_planning_task') {
    let createdRef = ''
    await stores.boardStore.mutateBoard(
      goalKey,
      'assistant',
      'assistant create planning task',
      (board) => {
        createdRef = nextPlanningTaskRef(board.items.map((item) => item.ref))
        board.items.push({
          ref: createdRef,
          kind: 'planning',
          status: 'planned',
          title: action.title,
          description: action.description,
          acceptanceCriteria: action.acceptanceCriteria,
          blockedBy: action.blockedBy,
        })
      },
    )

    return {
      kind: 'create_planning_task',
      taskRef: createdRef,
      summary: `Created planning task ${createdRef}.`,
    }
  }

  if (action.kind === 'request_planning') {
    let taskRef = ''
    let reusedExisting = false
    await stores.boardStore.mutateBoard(
      goalKey,
      'assistant',
      'assistant request planning',
      (board) => {
        const existing = board.items.find(
          (item) =>
            item.kind === 'planning' && item.title === action.title && item.status !== 'done',
        )
        if (existing) {
          taskRef = existing.ref
          reusedExisting = true
          return
        }

        taskRef = nextPlanningTaskRef(board.items.map((item) => item.ref))
        board.items.push({
          ref: taskRef,
          kind: 'planning',
          status: 'planned',
          title: action.title,
          description: action.description,
          acceptanceCriteria: action.acceptanceCriteria,
          blockedBy: action.blockedBy,
        })
      },
    )

    return {
      kind: 'request_planning',
      taskRef,
      summary: reusedExisting
        ? `Planning request already visible in ${taskRef}.`
        : `Requested planning work in ${taskRef}.`,
    }
  }

  if (action.kind === 'request_decision') {
    const result = await requestGoalDecision(
      {
        boardStore: stores.boardStore,
        decisions: stores.decisions,
      },
      {
        goalKey,
        decisionKey: action.decisionKey,
        summary: action.summary,
        taskRef: action.taskRef,
        writer: 'assistant',
        reason: `assistant request decision ${action.decisionKey}`,
      },
    )

    if (result.decision.status === 'resolved') {
      return {
        kind: 'request_decision',
        decisionKey: result.decision.decisionKey,
        summary: `Decision ${result.decision.decisionKey} is already resolved.`,
      }
    }

    return {
      kind: 'request_decision',
      decisionKey: result.decision.decisionKey,
      summary: result.blockerAdded
        ? `Requested decision ${result.decision.decisionKey} and linked it to ${action.taskRef}.`
        : result.created
          ? `Requested decision ${result.decision.decisionKey}.`
          : `Decision ${result.decision.decisionKey} is already open.`,
    }
  }

  if (action.kind === 'resolve_decision') {
    const current = await stores.decisions.readGoalDecisions(goalKey)
    if (!current.decisions.some((item) => item.decisionKey === action.decisionKey)) {
      await stores.decisions.createDecision(goalKey, {
        decisionKey: action.decisionKey,
        summary: action.summary ?? `Decision: ${action.decisionKey}`,
        taskRef: action.taskRef,
      })
    }
    const result = await resolveGoalDecision(
      {
        boardStore: stores.boardStore,
        decisions: stores.decisions,
      },
      {
        goalKey,
        decisionKey: action.decisionKey,
        answer: action.answer,
        writer: 'assistant',
        reason: `assistant resolve decision ${action.decisionKey}`,
      },
    )
    return {
      kind: 'resolve_decision',
      decisionKey: action.decisionKey,
      summary: result.blockerRemoved
        ? `Resolved decision ${action.decisionKey} and cleared linked blockers.`
        : `Resolved decision ${action.decisionKey}.`,
    }
  }

  if (action.kind === 'record_preference') {
    await stores.preferences.recordPreference(action.summary)
    return {
      kind: 'record_preference',
      summary: `Recorded durable preference: ${action.summary}`,
    }
  }

  await stores.preferences.writePreferences(action.content)
  return {
    kind: 'update_preference',
    summary: 'Updated durable preferences.',
  }
}

async function runAssistantCommand(
  rootDir: string,
  command: Awaited<ReturnType<typeof resolveConfiguredTransportCommand>>,
  events: AgentRuntimeEvent[],
) {
  const child = Bun.spawn(command.cmd, {
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: command.stdin === undefined ? 'ignore' : 'pipe',
    env: {
      ...process.env,
      ...command.env,
    },
  })
  if (command.stdin !== undefined && child.stdin) {
    child.stdin.write(command.stdin)
    child.stdin.end()
  }

  const stdoutLines: string[] = []
  const stderrLines: string[] = []
  await Promise.all([
    consumeTextLines(child.stdout, async (line) => {
      stdoutLines.push(line)
      events.push(
        ...normalizeProcessOutputLine({
          format: command.transcriptFormat ?? 'plain',
          stream: 'stdout',
          role: 'assistant',
          line,
        }),
      )
    }),
    consumeTextLines(child.stderr, async (line) => {
      stderrLines.push(line)
      events.push(
        ...normalizeProcessOutputLine({
          format: command.transcriptFormat ?? 'plain',
          stream: 'stderr',
          role: 'assistant',
          line,
        }),
      )
    }),
  ])

  const exitCode = await child.exited
  if (exitCode !== 0) {
    const detail = stderrLines.at(-1) ?? stdoutLines.at(-1)
    throw new Error(
      detail
        ? `assistant process exited with code ${exitCode}: ${detail}`
        : `assistant process exited with code ${exitCode}`,
    )
  }

  const raw = await Bun.file(command.outcomeFile ?? '').text()
  const parsed = assistantOutcomeSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid assistant outcome: ${issues}`)
  }
  return parsed.data
}

async function readAdapterConfig(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return null
  }

  const raw = await file.text()
  const parsed = agentAdapterConfigSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid adapter config: ${issues}`)
  }

  return parsed.data
}

function summarizeAssistantAction(action: GoalAssistantAction) {
  if (action.kind === 'move_task') {
    return `Move ${action.taskRef} to ${action.status}.`
  }
  if (action.kind === 'create_planning_task') {
    return `Create planning task: ${action.title}`
  }
  if (action.kind === 'request_planning') {
    return `Request planning: ${action.title}`
  }
  if (action.kind === 'request_decision') {
    return `Request decision ${action.decisionKey}.`
  }
  if (action.kind === 'resolve_decision') {
    return `Resolve decision ${action.decisionKey}.`
  }
  if (action.kind === 'record_preference') {
    return `Record durable preference: ${action.summary}`
  }
  return 'Update durable preferences.'
}

function isLegalManualTransition(from: TaskStatus, to: TaskStatus) {
  if (from === 'planned') {
    return to === 'in_review'
  }
  if (from === 'in_review') {
    return to === 'planned' || to === 'merging'
  }
  if (from === 'merging') {
    return to === 'planned' || to === 'done'
  }
  if (from === 'done') {
    return to === 'planned'
  }
  return false
}

function nextPlanningTaskRef(existingRefs: string[]) {
  const nextNumber =
    existingRefs.reduce((max, ref) => {
      const match = /^P-(\d+)$/.exec(ref)
      if (!match) {
        return max
      }
      return Math.max(max, Number.parseInt(match[1] ?? '0', 10))
    }, 0) + 1

  return `P-${nextNumber}`
}

async function writeJsonAtomically(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp.${crypto.randomUUID()}`
  await Bun.write(tmpPath, `${JSON.stringify(value, null, 2)}\n`)
  await rename(tmpPath, path)
}

async function consumeTextLines(
  stream: ReadableStream<Uint8Array> | null,
  onLine: (line: string) => Promise<void>,
) {
  if (!stream) {
    return
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }

      buffered += decoder.decode(value, { stream: true })
      const lines = buffered.split(/\r?\n/)
      buffered = lines.pop() ?? ''

      for (const line of lines) {
        if (line.length > 0) {
          await onLine(line)
        }
      }
    }

    buffered += decoder.decode()
    if (buffered.length > 0) {
      await onLine(buffered)
    }
  } finally {
    reader.releaseLock()
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
