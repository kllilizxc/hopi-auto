import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { AgentRuntimeEvent } from '../agent/AgentRunner'
import {
  readAndMigrateAgentAdapterConfig,
  resolveAssistantTransportConfig,
} from '../agent/adapterConfig'
import { normalizeProcessOutputLine } from '../agent/vendorTranscript'
import { resolveConfiguredTransportCommand } from '../agent/vendorTransport'
import {
  type AssistantThreadStore,
  createAssistantThreadStore,
} from '../runtime/assistantThreadStore'
import { type AttemptStore, createAttemptStore } from '../runtime/attemptStore'
import { type BoardStore, createBoardStore } from '../storage/boardStore'
import { type DecisionStore, createDecisionStore } from '../storage/decisionStore'
import {
  type GoalAttachmentRef,
  type GoalAttachmentStore,
  createGoalAttachmentStore,
  mergeGoalAttachmentRefs,
} from '../storage/goalAttachmentStore'
import { createProjectPaths } from '../storage/paths'
import {
  type PlanningRequestStore,
  createPlanningRequestStore,
} from '../storage/planningRequestStore'
import { type PreferenceStore, createPreferenceStore } from '../storage/preferenceStore'
import { applyAssistantAction } from './assistantActionExecutor'
import { summarizeAssistantAction } from './assistantInspection'
import {
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
  run(input: {
    goalKey: string
    content: string
    images?: File[]
    attachments?: GoalAttachmentRef[]
    appendUserMessage?: boolean
    onRunStarted?(assistantRunId: string): Promise<void> | void
    onEvent?(event: AgentRuntimeEvent, assistantRunId: string): Promise<void> | void
  }): Promise<GoalAssistantRunRecord>
}

export class GoalAssistantNotConfiguredError extends Error {}
export class GoalAssistantAttachmentTransportError extends Error {}

export function createGoalAssistantRuntime(
  rootDir = process.cwd(),
  boardStore: BoardStore = createBoardStore(rootDir),
  decisions: DecisionStore = createDecisionStore(rootDir),
  planningRequests: PlanningRequestStore = createPlanningRequestStore(rootDir),
  preferences: PreferenceStore = createPreferenceStore(rootDir),
  threadStore: AssistantThreadStore = createAssistantThreadStore(rootDir),
  attachments: GoalAttachmentStore = createGoalAttachmentStore(rootDir),
  contextBuilder: GoalAssistantContextBuilder = createGoalAssistantContextBuilder(
    rootDir,
    boardStore,
    decisions,
    planningRequests,
    preferences,
    threadStore,
  ),
  attempts: AttemptStore = createAttemptStore(rootDir),
): GoalAssistantRuntime {
  const paths = createProjectPaths(rootDir)

  return {
    async isConfigured() {
      const config = await readAdapterConfig(paths.adapterConfigPath())
      return Boolean(config)
    },
    async run(input) {
      const config = await readAdapterConfig(paths.adapterConfigPath())
      if (!config) {
        throw new GoalAssistantNotConfiguredError('Goal assistant is not configured.')
      }
      const assistantConfig = resolveAssistantTransportConfig(config)
      if (assistantConfig.cwdMode !== 'root') {
        throw new Error('Goal assistant transports must use root cwdMode.')
      }
      if (
        ((input.images?.length ?? 0) > 0 || (input.attachments?.length ?? 0) > 0) &&
        assistantConfig.transport !== 'codex'
      ) {
        throw new GoalAssistantAttachmentTransportError(
          'Goal assistant image attachments require a Codex assistant transport.',
        )
      }

      const assistantRunId = crypto.randomUUID()
      const startedAt = new Date().toISOString()
      await input.onRunStarted?.(assistantRunId)
      const events: AgentRuntimeEvent[] = []
      const actionResults: GoalAssistantActionResult[] = []
      const persistedAttachments = mergeGoalAttachmentRefs(
        input.attachments?.length
          ? await attachments.resolveGoalAttachments(input.goalKey, input.attachments)
          : [],
        input.images && input.images.length > 0
          ? await attachments.persistAssistantImages(input.goalKey, input.images)
          : [],
      )
      if (input.appendUserMessage !== false) {
        await threadStore.appendUserMessage(input.goalKey, input.content, persistedAttachments)
      }

      try {
        const bundle = await contextBuilder.prepareBundle({
          goalKey: input.goalKey,
          assistantRunId,
          attachments: persistedAttachments,
        })
        const command = await resolveConfiguredTransportCommand({
          config: assistantConfig,
          bundle,
          input: {
            goalKey: input.goalKey,
            runId: assistantRunId,
            stepId: 'assistant',
            role: 'assistant',
          },
        })
        const outcome = await runAssistantCommand(rootDir, command, events, async (event) => {
          await input.onEvent?.(event, assistantRunId)
        })
        await threadStore.appendEntry(input.goalKey, {
          kind: 'assistant_message',
          content: outcome.message,
          mergeKey: assistantRunMergeKey(assistantRunId),
        })

        for (const action of outcome.actions) {
          await threadStore.appendEntry(input.goalKey, {
            kind: 'action',
            actionType: action.kind,
            summary: summarizeAssistantAction(action),
            action,
          })
          const result = await applyAssistantAction(input.goalKey, action, {
            boardStore,
            decisions,
            planningRequests,
            preferences,
            availableAttachments: persistedAttachments,
            attempts,
          })
          actionResults.push(result)
          await threadStore.appendEntry(input.goalKey, {
            kind: 'action_result',
            actionType: action.kind,
            summary: result.summary,
            result,
          })
        }

        const endedAt = new Date().toISOString()
        const record: GoalAssistantRunRecord = {
          goalKey: input.goalKey,
          assistantRunId,
          startedAt,
          endedAt,
          requestContent: input.content,
          attachments: persistedAttachments,
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
          attachments: persistedAttachments,
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

async function runAssistantCommand(
  rootDir: string,
  command: Awaited<ReturnType<typeof resolveConfiguredTransportCommand>>,
  events: AgentRuntimeEvent[],
  onEvent?: (event: AgentRuntimeEvent) => Promise<void> | void,
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
      const normalized = normalizeProcessOutputLine({
        format: command.transcriptFormat ?? 'plain',
        stream: 'stdout',
        role: 'assistant',
        line,
      })
      events.push(...normalized)
      for (const event of normalized) {
        await onEvent?.(event)
      }
    }),
    consumeTextLines(child.stderr, async (line) => {
      stderrLines.push(line)
      const normalized = normalizeProcessOutputLine({
        format: command.transcriptFormat ?? 'plain',
        stream: 'stderr',
        role: 'assistant',
        line,
      })
      events.push(...normalized)
      for (const event of normalized) {
        await onEvent?.(event)
      }
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

  return readAndMigrateAgentAdapterConfig(path)
}

export function assistantRunMergeKey(assistantRunId: string) {
  return `assistant-run:${assistantRunId}:assistant`
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
