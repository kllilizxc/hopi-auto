import type { BlockerRef, TaskItem, TaskStatus } from '../domain/board'
import {
  listInterpretableFollowThroughAnswerCandidateGroups,
  materializeInterpretedDecisionBundle,
  materializeInterpretedPlanningBatchInput,
  materializeInterpretedPlanningInput,
  materializeInterpretedPlanningWorkflowBatchInput,
} from '../runtime/answerInterpretation'
import type { AttemptStore } from '../runtime/attemptStore'
import {
  answerGoalDecision,
  answerGoalDecisions,
  requestGoalDecision,
} from '../runtime/decisionRequest'
import {
  listGroupedPlanningSinkTaskRefs,
  requestGoalPlanning,
  requestGoalPlanningBatch,
  requestGoalPlanningWorkflows,
} from '../runtime/planningRequest'
import { nextPlanningTaskRef } from '../runtime/planningRequestSupport'
import type { BoardStore } from '../storage/boardStore'
import type { DecisionStore } from '../storage/decisionStore'
import type { GoalAttachmentRef } from '../storage/goalAttachmentStore'
import type { PlanningRequestStore } from '../storage/planningRequestStore'
import type { PreferenceStore } from '../storage/preferenceStore'
import {
  clonePreferenceEntry,
  cloneTaskItem,
  isLegalManualTransition,
  resolveActionAttachments,
  slugifyPreferenceSummary,
  summarizeRecordedAnswerResult,
  summarizeRecordedAnswersResult,
  summarizeResolvedDecisionResult,
  summarizeResolvedDecisionsResult,
} from './assistantActionSupport'
import type { GoalAssistantAction, GoalAssistantActionResult } from './assistantRun'

const RETRYABLE_ASSISTANT_BLOCKER_KINDS = new Set<BlockerRef['kind']>([
  'intervention',
  'merge_conflict',
])

export interface GoalAssistantActionStores {
  boardStore: BoardStore
  decisions: DecisionStore
  planningRequests: PlanningRequestStore
  preferences: PreferenceStore
  availableAttachments: GoalAttachmentRef[]
  attempts: AttemptStore
}

export async function applyAssistantAction(
  goalKey: string,
  action: GoalAssistantAction,
  stores: GoalAssistantActionStores,
): Promise<GoalAssistantActionResult> {
  if (action.kind === 'retry_task') {
    let retriedTask: TaskItem | undefined
    let clearedBlockers: Array<{ kind: 'intervention' | 'merge_conflict'; ref: string }> = []
    await stores.boardStore.mutateBoard(
      goalKey,
      'assistant',
      `assistant retry ${action.taskRef}`,
      (board) => {
        const task = board.items.find((item) => item.ref === action.taskRef)
        if (!task) {
          throw new Error(`Task not found: ${action.taskRef}`)
        }
        if (task.status === 'done') {
          throw new Error(`Cannot retry completed task: ${action.taskRef}`)
        }

        const retryableBlockers = task.blockedBy.filter((blocker) =>
          RETRYABLE_ASSISTANT_BLOCKER_KINDS.has(blocker.kind),
        )
        if (retryableBlockers.length === 0) {
          throw new Error(`Task ${action.taskRef} has no retryable blockers to clear.`)
        }

        const blockersToClear =
          action.clearBlockers.length === 0
            ? retryableBlockers
            : action.clearBlockers.map((requested) => {
                const match = task.blockedBy.find(
                  (blocker) => blocker.kind === requested.kind && blocker.ref === requested.ref,
                )
                if (!match) {
                  throw new Error(
                    `Task ${action.taskRef} does not have blocker ${requested.kind}:${requested.ref}.`,
                  )
                }
                return match
              })

        const blockerKeys = new Set(
          blockersToClear.map((blocker) => `${blocker.kind}:${blocker.ref}`),
        )
        task.blockedBy = task.blockedBy.filter(
          (blocker) => !blockerKeys.has(`${blocker.kind}:${blocker.ref}`),
        )
        clearedBlockers = blockersToClear.map((blocker) => ({
          kind: blocker.kind as 'intervention' | 'merge_conflict',
          ref: blocker.ref,
        }))
        retriedTask = cloneTaskItem(task)
      },
    )
    await stores.attempts.resetTask(action.taskRef)
    const clearedBlocker = clearedBlockers[0]

    return {
      kind: 'retry_task',
      taskRef: action.taskRef,
      status: retriedTask?.status ?? 'planned',
      clearedBlockers,
      task: retriedTask,
      summary:
        clearedBlockers.length === 1 && clearedBlocker
          ? `Cleared retryable blocker ${clearedBlocker.kind}:${clearedBlocker.ref} from ${action.taskRef}.`
          : `Cleared ${clearedBlockers.length} retryable blockers from ${action.taskRef}.`,
    }
  }

  if (action.kind === 'request_planning') {
    const actionAttachments = resolveActionAttachments(
      action.attachmentAssetPaths,
      stores.availableAttachments,
    )
    if (action.mode === 'batch') {
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
          attachments: actionAttachments,
          requests: materialized.requests,
          writer: 'assistant',
          reason: `assistant request planning batch ${materialized.groupKey}`,
        },
      )

      return {
        kind: 'request_planning',
        mode: 'batch',
        groupKey: result.groupKey,
        requestKeys: result.entries.map((entry) => entry.requestKey),
        taskRefs: result.entries.map((entry) => entry.taskRef),
        requests: result.requests,
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

    if (action.mode === 'workflow') {
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
          attachments: actionAttachments,
          workflows: [...materialized.workflows] as Parameters<
            typeof requestGoalPlanningWorkflows
          >[1]['workflows'],
          writer: 'assistant',
          reason: 'assistant request planning workflows',
        },
      )

      return {
        kind: 'request_planning',
        mode: 'workflow',
        workflowKey: result.workflowKey,
        groupKeys: result.groupKeys,
        workflows: result.workflows,
        requestKeys: result.requestKeys,
        taskRefs: result.taskRefs,
        requests: result.requests,
        blockerTaskRefs: result.blockerTaskRefs,
        createdRequestKeys: result.createdRequestKeys,
        createdTaskRefs: result.createdTaskRefs,
        resolvedSourceResponseFormat: materialized.resolvedSourceResponseFormat,
        summary: result.workflowKey
          ? `Updated planning workflow ${result.workflowKey} across ${result.taskRefs.join(', ')}.`
          : `Requested planning workflows across ${result.taskRefs.join(', ')}.`,
      }
    }

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
        attachments: actionAttachments,
        requestedUpdates: materialized.requestedUpdates,
        blockedBy: materialized.blockedBy,
        writer: 'assistant',
        reason: `assistant request planning ${materialized.title}`,
      },
    )

    return {
      kind: 'request_planning',
      mode: 'single',
      requestKey: result.request.requestKey,
      taskRef: result.request.taskRef,
      request: result.request,
      created: result.created,
      taskCreated: result.taskCreated,
      resolvedSourceResponseFormat: materialized.resolvedSourceResponseFormat,
      summary: result.created
        ? `Requested planning follow-through in ${result.request.requestKey} for ${result.request.taskRef}.`
        : `Planning request already open in ${result.request.requestKey} for ${result.request.taskRef}.`,
    }
  }

  if (action.kind === 'request_decision') {
    const actionAttachments = resolveActionAttachments(
      action.attachmentAssetPaths,
      stores.availableAttachments,
    )
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
        attachments: actionAttachments,
        writer: 'assistant',
        reason: `assistant request decision ${action.decisionKey}`,
      },
    )

    if (result.decision.status === 'resolved') {
      return {
        kind: 'request_decision',
        decisionKey: result.decision.decisionKey,
        decision: result.decision,
        created: result.created,
        blockerAdded: result.blockerAdded,
        decisionStatus: result.decision.status,
        summary: `Decision ${result.decision.decisionKey} is already resolved.`,
      }
    }

    return {
      kind: 'request_decision',
      decisionKey: result.decision.decisionKey,
      decision: result.decision,
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

  if (action.kind === 'resolve_decisions') {
    const actionAttachments = resolveActionAttachments(
      action.attachmentAssetPaths,
      stores.availableAttachments,
    )
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
    const result = await answerGoalDecisions(
      {
        boardStore: stores.boardStore,
        decisions: stores.decisions,
        planningRequests: stores.planningRequests,
      },
      {
        goalKey,
        answers: materialized.answers,
        attachments: actionAttachments,
        followThrough: materialized.followThrough,
        writer: 'assistant',
        reason: `assistant resolve decisions ${materialized.answers
          .map((answer) => answer.decisionKey ?? answer.summary)
          .join(', ')}`,
      },
    )
    return {
      kind: 'resolve_decisions',
      decisionKeys: result.decisions.map((decision) => decision.decisionKey),
      decisions: result.decisions,
      createdDecisionKeys: result.createdDecisionKeys,
      blockerRemoved: result.blockerRemoved,
      resolvedSourceResponseFormat: materialized.sourceResponseFormat,
      followThrough: result.followThrough,
      summary: summarizeResolvedDecisionsResult(result),
    }
  }

  if (action.kind === 'set_preference') {
    if (action.mode === 'retire') {
      const document = await stores.preferences.retirePreference({
        preferenceKey: action.preferenceKey,
        reason: action.reason,
        supersededBy: action.supersededBy,
      })
      return {
        kind: 'set_preference',
        mode: 'retire',
        preferenceKey: action.preferenceKey,
        reason: action.reason,
        supersededBy: action.supersededBy,
        preference: (() => {
          const entry = document.entries.find((item) => item.preferenceKey === action.preferenceKey)
          return entry ? clonePreferenceEntry(entry) : undefined
        })(),
        retiredPreferenceKeys: [action.preferenceKey],
        summary: `Retired durable preference: ${action.preferenceKey}`,
      }
    }

    const document = await stores.preferences.recordPreference({
      preferenceKey: action.preferenceKey,
      summary: action.summary,
      rationale: action.rationale,
      supersedes: action.supersedes,
    })
    const preferenceKey = action.preferenceKey ?? slugifyPreferenceSummary(action.summary)
    return {
      kind: 'set_preference',
      mode: 'upsert',
      preferenceKey,
      preferenceSummary: action.summary,
      rationale: action.rationale,
      preference: (() => {
        const entry = document.entries.find((item) => item.preferenceKey === preferenceKey)
        return entry ? clonePreferenceEntry(entry) : undefined
      })(),
      retiredPreferences:
        action.supersedes && action.supersedes.length > 0
          ? document.entries
              .filter((entry) => action.supersedes?.includes(entry.preferenceKey))
              .map((entry) => clonePreferenceEntry(entry))
          : undefined,
      retiredPreferenceKeys: action.supersedes ?? [],
      summary: `Recorded durable preference: ${action.summary}`,
    }
  }

  if (action.kind === 'move_task') {
    let previousStatus: TaskStatus | undefined
    let movedTask: TaskItem | undefined
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
        previousStatus = task.status
        task.status = action.status
        movedTask = cloneTaskItem(task)
      },
    )

    return {
      kind: 'move_task',
      taskRef: action.taskRef,
      status: action.status,
      previousStatus,
      task: movedTask,
      summary: `Moved ${action.taskRef} to ${action.status}.`,
    }
  }

  if (action.kind === 'create_planning_task') {
    let createdRef = ''
    let createdTask: TaskItem | undefined
    await stores.boardStore.mutateBoard(
      goalKey,
      'assistant',
      'assistant create planning task',
      (board) => {
        createdRef = nextPlanningTaskRef(board.items.map((item) => item.ref))
        const task: TaskItem = {
          ref: createdRef,
          kind: 'planning',
          status: 'planned',
          title: action.title,
          description: action.description,
          acceptanceCriteria: action.acceptanceCriteria,
          blockedBy: action.blockedBy ?? [],
        }
        board.items.push(task)
        createdTask = cloneTaskItem(task)
      },
    )

    return {
      kind: 'create_planning_task',
      taskRef: createdRef,
      task: createdTask,
      summary: `Created planning task ${createdRef}.`,
    }
  }

  if (action.kind === 'request_planning_batch') {
    const actionAttachments = resolveActionAttachments(
      action.attachmentAssetPaths,
      stores.availableAttachments,
    )
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
        attachments: actionAttachments,
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
      requests: result.requests,
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
    const actionAttachments = resolveActionAttachments(
      action.attachmentAssetPaths,
      stores.availableAttachments,
    )
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
        attachments: actionAttachments,
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
      requests: result.requests,
      blockerTaskRefs: result.blockerTaskRefs,
      createdRequestKeys: result.createdRequestKeys,
      createdTaskRefs: result.createdTaskRefs,
      resolvedSourceResponseFormat: materialized.resolvedSourceResponseFormat,
      summary: result.workflowKey
        ? `Updated planning workflow ${result.workflowKey} across ${result.taskRefs.join(', ')}.`
        : `Requested planning workflows across ${result.taskRefs.join(', ')}.`,
    }
  }

  if (action.kind === 'resolve_decision') {
    const actionAttachments = resolveActionAttachments(
      action.attachmentAssetPaths,
      stores.availableAttachments,
    )
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
    const firstAnswer = materialized.answers[0]
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
        attachments: actionAttachments,
        followThrough: materialized.followThrough,
        writer: 'assistant',
        reason: `assistant resolve decision ${action.decisionKey}`,
      },
    )
    return {
      kind: 'resolve_decision',
      decisionKey: action.decisionKey,
      decision: result.decision,
      blockerRemoved: result.blockerRemoved,
      resolvedSourceResponseFormat: materialized.sourceResponseFormat,
      followThrough: result.followThrough,
      summary: summarizeResolvedDecisionResult(action.decisionKey, result),
    }
  }

  if (action.kind === 'record_answer') {
    const actionAttachments = resolveActionAttachments(
      action.attachmentAssetPaths,
      stores.availableAttachments,
    )
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
    const firstAnswer = materialized.answers[0]
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
        attachments: actionAttachments,
        followThrough: materialized.followThrough,
        writer: 'assistant',
        reason: `assistant record answer ${action.decisionKey ?? action.summary}`,
      },
    )
    return {
      kind: 'record_answer',
      decisionKey: result.decision.decisionKey,
      decision: result.decision,
      created: result.created,
      blockerRemoved: result.blockerRemoved,
      resolvedSourceResponseFormat: materialized.sourceResponseFormat,
      followThrough: result.followThrough,
      summary: summarizeRecordedAnswerResult(result.decision.decisionKey, result),
    }
  }

  if (action.kind === 'record_answers') {
    const actionAttachments = resolveActionAttachments(
      action.attachmentAssetPaths,
      stores.availableAttachments,
    )
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
        attachments: actionAttachments,
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
      decisions: result.decisions,
      createdDecisionKeys: result.createdDecisionKeys,
      blockerRemoved: result.blockerRemoved,
      resolvedSourceResponseFormat: materialized.sourceResponseFormat,
      followThrough: result.followThrough,
      summary: summarizeRecordedAnswersResult(result),
    }
  }

  if (action.kind === 'record_preference') {
    const document = await stores.preferences.recordPreference({
      preferenceKey: action.preferenceKey,
      summary: action.summary,
      rationale: action.rationale,
      supersedes: action.supersedes,
    })
    const preferenceKey = action.preferenceKey ?? slugifyPreferenceSummary(action.summary)
    return {
      kind: 'record_preference',
      preferenceKey,
      preferenceSummary: action.summary,
      rationale: action.rationale,
      preference: (() => {
        const entry = document.entries.find((item) => item.preferenceKey === preferenceKey)
        return entry ? clonePreferenceEntry(entry) : undefined
      })(),
      retiredPreferences:
        action.supersedes && action.supersedes.length > 0
          ? document.entries
              .filter((entry) => action.supersedes?.includes(entry.preferenceKey))
              .map((entry) => clonePreferenceEntry(entry))
          : undefined,
      retiredPreferenceKeys: action.supersedes ?? [],
      summary: `Recorded durable preference: ${action.summary}`,
    }
  }

  if (action.kind === 'retire_preference') {
    const document = await stores.preferences.retirePreference({
      preferenceKey: action.preferenceKey,
      reason: action.reason,
      supersededBy: action.supersededBy,
    })
    return {
      kind: 'retire_preference',
      preferenceKey: action.preferenceKey,
      reason: action.reason,
      supersededBy: action.supersededBy,
      preference: (() => {
        const entry = document.entries.find((item) => item.preferenceKey === action.preferenceKey)
        return entry ? clonePreferenceEntry(entry) : undefined
      })(),
      summary: `Retired durable preference: ${action.preferenceKey}`,
    }
  }

  if (action.kind === 'update_preference') {
    const document = await stores.preferences.writePreferences(action.content)
    return {
      kind: 'update_preference',
      content: action.content,
      preferences: document.entries.map((entry) => clonePreferenceEntry(entry)),
      summary: 'Updated durable preferences.',
    }
  }

  throw new Error(`Unsupported assistant action: ${(action as { kind: string }).kind}`)
}
