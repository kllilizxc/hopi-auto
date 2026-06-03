import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { AgentRuntimeEvent } from '../agent/AgentRunner'
import { agentAdapterConfigSchema } from '../agent/adapterConfig'
import { normalizeProcessOutputLine } from '../agent/vendorTranscript'
import { resolveConfiguredTransportCommand } from '../agent/vendorTransport'
import type { TaskStatus } from '../domain/board'
import {
  listInterpretableFollowThroughAnswerCandidateGroups,
  materializeInterpretedDecisionBundle,
  materializeInterpretedPlanningBatchInput,
  materializeInterpretedPlanningInput,
  materializeInterpretedPlanningWorkflowBatchInput,
} from '../runtime/answerInterpretation'
import {
  type AssistantThreadStore,
  createAssistantThreadStore,
} from '../runtime/assistantThreadStore'
import {
  answerGoalDecision,
  answerGoalDecisions,
  requestGoalDecision,
  type resolveGoalDecision,
} from '../runtime/decisionRequest'
import {
  listGroupedPlanningSinkTaskRefs,
  requestGoalPlanning,
  requestGoalPlanningBatch,
  requestGoalPlanningWorkflows,
} from '../runtime/planningRequest'
import { type BoardStore, createBoardStore } from '../storage/boardStore'
import { type DecisionStore, createDecisionStore } from '../storage/decisionStore'
import { createProjectPaths } from '../storage/paths'
import {
  type PlanningRequestStore,
  createPlanningRequestStore,
} from '../storage/planningRequestStore'
import { type PreferenceStore, createPreferenceStore } from '../storage/preferenceStore'
import { summarizeAssistantAction } from './assistantInspection'
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
  planningRequests: PlanningRequestStore = createPlanningRequestStore(rootDir),
  preferences: PreferenceStore = createPreferenceStore(rootDir),
  threadStore: AssistantThreadStore = createAssistantThreadStore(rootDir),
  contextBuilder: GoalAssistantContextBuilder = createGoalAssistantContextBuilder(
    rootDir,
    boardStore,
    decisions,
    planningRequests,
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
            action,
          })
          const result = await applyAssistantAction(input.goalKey, action, {
            boardStore,
            decisions,
            planningRequests,
            preferences,
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
    planningRequests: PlanningRequestStore
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
    const materialized = materializeInterpretedPlanningInput(
      {
        groupKey: action.groupKey,
        title: action.title,
        description: action.description,
        acceptanceCriteria: action.acceptanceCriteria,
        decisionRefs: action.decisionRefs,
        answers: action.answers,
        requestedUpdates: action.requestedUpdates,
        blockedBy: action.blockedBy,
        inferRemainingAnswers: action.inferRemainingAnswers,
      },
      action.sourceResponse,
      action.answerSources,
      action.sourceResponseFormat,
    )
    const result = await requestGoalPlanning(
      {
        boardStore: stores.boardStore,
        planningRequests: stores.planningRequests,
      },
      {
        goalKey,
        groupKey: materialized.groupKey,
        title: materialized.title,
        description: materialized.description,
        acceptanceCriteria: materialized.acceptanceCriteria,
        decisionRefs: materialized.decisionRefs,
        answers: materialized.answers,
        requestedUpdates: materialized.requestedUpdates,
        blockedBy: materialized.blockedBy,
        writer: 'assistant',
        reason: `assistant request planning ${materialized.title}`,
      },
    )

    return {
      kind: 'request_planning',
      requestKey: result.request.requestKey,
      taskRef: result.request.taskRef,
      created: result.created,
      taskCreated: result.taskCreated,
      resolvedSourceResponseFormat: materialized.resolvedSourceResponseFormat,
      summary: result.created
        ? `Requested planning follow-through in ${result.request.requestKey} for ${result.request.taskRef}.`
        : `Planning request already open in ${result.request.requestKey} for ${result.request.taskRef}.`,
    }
  }

  if (action.kind === 'request_planning_batch') {
    const materialized = materializeInterpretedPlanningBatchInput(
      {
        groupKey: action.groupKey,
        decisionRefs: action.decisionRefs,
        answers: action.answers,
        requests: action.requests,
        inferRemainingAnswers: action.inferRemainingAnswers,
      },
      action.sourceResponse,
      action.answerSources,
      action.sourceResponseFormat,
    )
    const result = await requestGoalPlanningBatch(
      {
        boardStore: stores.boardStore,
        planningRequests: stores.planningRequests,
      },
      {
        goalKey,
        groupKey: materialized.groupKey,
        decisionRefs: materialized.decisionRefs,
        answers: materialized.answers,
        requests: materialized.requests,
        writer: 'assistant',
        reason: `assistant request planning batch ${materialized.groupKey}`,
      },
    )

    return {
      kind: 'request_planning_batch',
      groupKey: result.groupKey,
      requestKeys: result.entries.map((entry) => entry.requestKey),
      taskRefs: result.entries.map((entry) => entry.taskRef),
      blockerTaskRefs: await listGroupedPlanningSinkTaskRefs(
        {
          boardStore: stores.boardStore,
          planningRequests: stores.planningRequests,
        },
        {
          goalKey,
          groupKey: result.groupKey,
        },
      ),
      createdRequestKeys: result.entries
        .filter((entry) => entry.created)
        .map((entry) => entry.requestKey),
      createdTaskRefs: result.entries
        .filter((entry) => entry.taskCreated)
        .map((entry) => entry.taskRef),
      resolvedSourceResponseFormat: materialized.resolvedSourceResponseFormat,
      summary: `Requested grouped planning follow-through ${result.groupKey} across ${result.entries.map((entry) => entry.taskRef).join(', ')}.`,
    }
  }

  if (action.kind === 'request_planning_workflows') {
    const materialized = materializeInterpretedPlanningWorkflowBatchInput(
      {
        workflowKey: action.workflowKey,
        reuseTaskRef: action.reuseTaskRef,
        reuseGroupKey: action.reuseGroupKey,
        decisionRefs: action.decisionRefs,
        answers: action.answers,
        workflows: action.workflows,
        inferRemainingAnswers: action.inferRemainingAnswers,
      },
      action.sourceResponse,
      action.answerSources,
      action.sourceResponseFormat,
    )
    const result = await requestGoalPlanningWorkflows(
      {
        boardStore: stores.boardStore,
        planningRequests: stores.planningRequests,
      },
      {
        goalKey,
        workflowKey: materialized.workflowKey,
        reuseTaskRef: materialized.reuseTaskRef,
        reuseGroupKey: materialized.reuseGroupKey,
        decisionRefs: materialized.decisionRefs,
        answers: materialized.answers,
        workflows: [...materialized.workflows] as Parameters<
          typeof requestGoalPlanningWorkflows
        >[1]['workflows'],
        writer: 'assistant',
        reason: 'assistant request planning workflows',
      },
    )

    return {
      kind: 'request_planning_workflows',
      workflowKey: result.workflowKey,
      groupKeys: result.groupKeys,
      workflows: result.workflows,
      requestKeys: result.requestKeys,
      taskRefs: result.taskRefs,
      blockerTaskRefs: result.blockerTaskRefs,
      createdRequestKeys: result.createdRequestKeys,
      createdTaskRefs: result.createdTaskRefs,
      resolvedSourceResponseFormat: materialized.resolvedSourceResponseFormat,
      summary: result.workflowKey
        ? `Updated planning workflow ${result.workflowKey} across ${result.taskRefs.join(', ')}.`
        : `Requested planning workflows across ${result.taskRefs.join(', ')}.`,
    }
  }

  if (action.kind === 'request_decision') {
    const result = await requestGoalDecision(
      {
        boardStore: stores.boardStore,
        decisions: stores.decisions,
        planningRequests: stores.planningRequests,
      },
      {
        goalKey,
        decisionKey: action.decisionKey,
        summary: action.summary,
        summaryKey: action.summaryKey,
        prompt: action.prompt,
        matchHints: action.matchHints,
        taskRef: action.taskRef,
        writer: 'assistant',
        reason: `assistant request decision ${action.decisionKey}`,
      },
    )

    if (result.decision.status === 'resolved') {
      return {
        kind: 'request_decision',
        decisionKey: result.decision.decisionKey,
        created: result.created,
        blockerAdded: result.blockerAdded,
        decisionStatus: result.decision.status,
        summary: `Decision ${result.decision.decisionKey} is already resolved.`,
      }
    }

    return {
      kind: 'request_decision',
      decisionKey: result.decision.decisionKey,
      created: result.created,
      blockerAdded: result.blockerAdded,
      decisionStatus: result.decision.status,
      summary: result.blockerAdded
        ? `Requested decision ${result.decision.decisionKey} and linked it to ${action.taskRef}.`
        : result.created
          ? `Requested decision ${result.decision.decisionKey}.`
          : `Decision ${result.decision.decisionKey} is already open.`,
    }
  }

  if (action.kind === 'resolve_decision') {
    const materialized = materializeInterpretedDecisionBundle({
      answers: [
        {
          summary: action.summary ?? `Decision: ${action.decisionKey}`,
          summaryKey: action.summaryKey,
          prompt: action.prompt,
          matchHints: action.matchHints,
          decisionKey: action.decisionKey,
          taskRef: action.taskRef,
          answer: action.answer,
          sourceExcerpt: action.sourceExcerpt,
          sourceOccurrence: action.sourceOccurrence,
          answerSourceKey: action.answerSourceKey,
          answerSourceGroupKey: action.answerSourceGroupKey,
        },
      ],
      openDecisions: [],
      inferOpenDecisions: false,
      sourceResponse: action.sourceResponse,
      answerSources: action.answerSources,
      sourceResponseFormat: action.sourceResponseFormat,
      followThrough: action.followThrough,
      reservedAnswerCandidates: listInterpretableFollowThroughAnswerCandidateGroups(
        action.followThrough,
      ),
    })
    const materializedAnswers = materialized.answers
    const firstAnswer = materializedAnswers[0]
    if (!firstAnswer) {
      throw new Error(`Expected one materialized answer for ${action.decisionKey}.`)
    }
    const result = await answerGoalDecision(
      {
        boardStore: stores.boardStore,
        decisions: stores.decisions,
        planningRequests: stores.planningRequests,
      },
      {
        goalKey,
        summary: firstAnswer.summary,
        summaryKey: firstAnswer.summaryKey,
        prompt: firstAnswer.prompt,
        matchHints: firstAnswer.matchHints,
        captureFormat: firstAnswer.captureFormat,
        decisionKey: action.decisionKey,
        taskRef: firstAnswer.taskRef,
        answer: firstAnswer.answer,
        followThrough: materialized.followThrough,
        writer: 'assistant',
        reason: `assistant resolve decision ${action.decisionKey}`,
      },
    )
    return {
      kind: 'resolve_decision',
      decisionKey: action.decisionKey,
      blockerRemoved: result.blockerRemoved,
      resolvedSourceResponseFormat: materialized.sourceResponseFormat,
      followThrough: result.followThrough,
      summary: summarizeResolvedDecisionResult(action.decisionKey, result),
    }
  }

  if (action.kind === 'record_answer') {
    const materialized = materializeInterpretedDecisionBundle({
      answers: [
        {
          summary: action.summary,
          summaryKey: action.summaryKey,
          prompt: action.prompt,
          matchHints: action.matchHints,
          decisionKey: action.decisionKey,
          taskRef: action.taskRef,
          answer: action.answer,
          sourceExcerpt: action.sourceExcerpt,
          sourceOccurrence: action.sourceOccurrence,
          answerSourceKey: action.answerSourceKey,
          answerSourceGroupKey: action.answerSourceGroupKey,
        },
      ],
      openDecisions: [],
      inferOpenDecisions: false,
      sourceResponse: action.sourceResponse,
      answerSources: action.answerSources,
      sourceResponseFormat: action.sourceResponseFormat,
      followThrough: action.followThrough,
      reservedAnswerCandidates: listInterpretableFollowThroughAnswerCandidateGroups(
        action.followThrough,
      ),
    })
    const materializedAnswers = materialized.answers
    const firstAnswer = materializedAnswers[0]
    if (!firstAnswer) {
      throw new Error('Expected one materialized answer.')
    }
    const result = await answerGoalDecision(
      {
        boardStore: stores.boardStore,
        decisions: stores.decisions,
        planningRequests: stores.planningRequests,
      },
      {
        goalKey,
        summary: firstAnswer.summary,
        summaryKey: firstAnswer.summaryKey,
        prompt: firstAnswer.prompt,
        matchHints: firstAnswer.matchHints,
        captureFormat: firstAnswer.captureFormat,
        decisionKey: firstAnswer.decisionKey,
        taskRef: firstAnswer.taskRef,
        answer: firstAnswer.answer,
        followThrough: materialized.followThrough,
        writer: 'assistant',
        reason: `assistant record answer ${action.decisionKey ?? action.summary}`,
      },
    )
    return {
      kind: 'record_answer',
      decisionKey: result.decision.decisionKey,
      created: result.created,
      blockerRemoved: result.blockerRemoved,
      resolvedSourceResponseFormat: materialized.sourceResponseFormat,
      followThrough: result.followThrough,
      summary: summarizeRecordedAnswerResult(result.decision.decisionKey, result),
    }
  }

  if (action.kind === 'record_answers') {
    const current = await stores.decisions.readGoalDecisions(goalKey)
    const materialized = materializeInterpretedDecisionBundle({
      answers: action.answers,
      openDecisions: current.decisions
        .filter((decision) => decision.status === 'open')
        .map((decision) => ({
          decisionKey: decision.decisionKey,
          summary: decision.summary,
          summaryKey: decision.summaryKey,
          prompt: decision.prompt,
          matchHints: decision.matchHints,
          taskRef: decision.taskRef,
        })),
      inferOpenDecisions: action.inferOpenDecisions ?? false,
      sourceResponse: action.sourceResponse,
      answerSources: action.answerSources,
      sourceResponseFormat: action.sourceResponseFormat,
      inferDecisionTopics: action.inferDecisionTopics ?? false,
      knownDecisions: current.decisions.map((decision) => ({
        decisionKey: decision.decisionKey,
        summary: decision.summary,
        summaryKey: decision.summaryKey,
        prompt: decision.prompt,
        matchHints: decision.matchHints,
        taskRef: decision.taskRef,
      })),
      followThrough: action.followThrough,
      reservedAnswerCandidates: listInterpretableFollowThroughAnswerCandidateGroups(
        action.followThrough,
      ),
    })
    const answers = materialized.answers
    const result = await answerGoalDecisions(
      {
        boardStore: stores.boardStore,
        decisions: stores.decisions,
        planningRequests: stores.planningRequests,
      },
      {
        goalKey,
        answers,
        followThrough: materialized.followThrough,
        writer: 'assistant',
        reason: `assistant record answers ${answers
          .map((answer) => answer.decisionKey ?? answer.summary)
          .join(', ')}`,
      },
    )
    return {
      kind: 'record_answers',
      decisionKeys: result.decisions.map((decision) => decision.decisionKey),
      createdDecisionKeys: result.createdDecisionKeys,
      blockerRemoved: result.blockerRemoved,
      resolvedSourceResponseFormat: materialized.sourceResponseFormat,
      followThrough: result.followThrough,
      summary: summarizeRecordedAnswersResult(result),
    }
  }

  if (action.kind === 'record_preference') {
    await stores.preferences.recordPreference({
      preferenceKey: action.preferenceKey,
      summary: action.summary,
      rationale: action.rationale,
      supersedes: action.supersedes,
    })
    return {
      kind: 'record_preference',
      preferenceKey: action.preferenceKey ?? slugifyPreferenceSummary(action.summary),
      retiredPreferenceKeys: action.supersedes ?? [],
      summary: `Recorded durable preference: ${action.summary}`,
    }
  }

  if (action.kind === 'retire_preference') {
    await stores.preferences.retirePreference({
      preferenceKey: action.preferenceKey,
      reason: action.reason,
      supersededBy: action.supersededBy,
    })
    return {
      kind: 'retire_preference',
      preferenceKey: action.preferenceKey,
      summary: `Retired durable preference: ${action.preferenceKey}`,
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

function summarizeResolvedDecisionResult(
  decisionKey: string,
  result: Awaited<ReturnType<typeof resolveGoalDecision>>,
) {
  if (result.followThrough?.kind === 'workflow_batch') {
    return `Resolved decision ${decisionKey} and opened ${result.followThrough.workflows.length} planner workflows.`
  }
  if (result.followThrough?.kind === 'planning_batch') {
    return `Resolved decision ${decisionKey} and routed engineering through grouped planning follow-through ${result.followThrough.groupKey}.`
  }
  if (result.followThrough?.kind === 'planning') {
    return `Resolved decision ${decisionKey} and routed engineering through planning follow-through ${result.followThrough.taskRefs.join(', ')}.`
  }
  if (result.blockerRemoved) {
    return `Resolved decision ${decisionKey} and cleared linked blockers.`
  }
  return `Resolved decision ${decisionKey}.`
}

function slugifyPreferenceSummary(summary: string) {
  const normalized = summary
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'preference'
}

function summarizeRecordedAnswerResult(
  decisionKey: string,
  result: Awaited<ReturnType<typeof answerGoalDecision>>,
) {
  if (result.followThrough?.kind === 'workflow_batch') {
    return `Recorded answer in decision ${decisionKey} and opened ${result.followThrough.workflows.length} planner workflows.`
  }
  if (result.followThrough?.kind === 'planning_batch') {
    return `Recorded answer in decision ${decisionKey} and opened grouped planning follow-through ${result.followThrough.groupKey}.`
  }
  if (result.followThrough?.kind === 'planning') {
    return `Recorded answer in decision ${decisionKey} and opened planning follow-through ${result.followThrough.taskRefs.join(', ')}.`
  }
  if (result.blockerRemoved) {
    return `Recorded answer in decision ${decisionKey} and cleared linked blockers.`
  }
  return `Recorded answer in decision ${decisionKey}.`
}

function summarizeRecordedAnswersResult(result: Awaited<ReturnType<typeof answerGoalDecisions>>) {
  const decisionKeys = result.decisions.map((decision) => decision.decisionKey).join(', ')
  if (result.followThrough?.kind === 'workflow_batch') {
    return `Recorded answers in decisions ${decisionKeys} and opened ${result.followThrough.workflows.length} planner workflows.`
  }
  if (result.followThrough?.kind === 'planning_batch') {
    return `Recorded answers in decisions ${decisionKeys} and opened grouped planning follow-through ${result.followThrough.groupKey}.`
  }
  if (result.followThrough?.kind === 'planning') {
    return `Recorded answers in decisions ${decisionKeys} and opened planning follow-through ${result.followThrough.taskRefs.join(', ')}.`
  }
  if (result.blockerRemoved) {
    return `Recorded answers in decisions ${decisionKeys} and cleared linked blockers.`
  }
  return `Recorded answers in decisions ${decisionKeys}.`
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
