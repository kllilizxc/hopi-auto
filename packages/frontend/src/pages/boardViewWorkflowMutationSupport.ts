import type {
  GoalDecisionAnswerBatchResult,
  GoalDecisionAnswerResult,
  GoalDecisionFollowThroughInput,
  GoalDecisionFollowThroughResult,
  GoalDecisionWorkflowBatchChildInput,
  GoalPlanningRequest,
  GoalPlanningWorkflowCreateChildInput,
  GoalPlanningWorkflowCreateInput,
} from '../lib/api'
import {
  parseBlockerRefsJson,
  parseInterpretablePlanningAnswersJson,
  parseWorkflowBatchRequestsJson,
} from './boardViewJsonInputSupport'
import {
  createExplicitAnswerSourceReferenceGroup,
  type ExplicitAnswerSourceReferenceGroup,
} from './boardViewSourceResponseSupport'
import { parseListInput } from './boardViewStructuredEditorCodec'
import type { DecisionFollowThroughDraft } from './boardViewStructuredEditorTypes'

export function buildDecisionFollowThroughAnswerSourceReferenceGroups(
  followThrough: GoalDecisionFollowThroughInput | undefined,
) {
  if (!followThrough) {
    return [] as ExplicitAnswerSourceReferenceGroup[]
  }

  if (followThrough.kind === 'planning') {
    return [
      createExplicitAnswerSourceReferenceGroup(
        'Decision planning follow-through answers',
        followThrough.answers,
      ),
    ].filter((group): group is ExplicitAnswerSourceReferenceGroup => group !== null)
  }

  if (followThrough.kind === 'planning_batch') {
    return [
      createExplicitAnswerSourceReferenceGroup(
        'Decision planning-batch follow-through answers',
        followThrough.answers,
      ),
    ].filter((group): group is ExplicitAnswerSourceReferenceGroup => group !== null)
  }

  const groups: ExplicitAnswerSourceReferenceGroup[] = []
  const rootGroup = createExplicitAnswerSourceReferenceGroup(
    'Decision workflow follow-through root answers',
    followThrough.answers,
  )
  if (rootGroup) {
    groups.push(rootGroup)
  }

  followThrough.workflows.forEach((workflowChild, index) => {
    const childGroup = createExplicitAnswerSourceReferenceGroup(
      `Decision workflow child ${index + 1} answers`,
      workflowChild.answers,
    )
    if (childGroup) {
      groups.push(childGroup)
    }
  })

  return groups
}

export function buildWorkflowAnswerSourceReferenceGroups(
  workflow: GoalPlanningWorkflowCreateInput,
) {
  const groups: ExplicitAnswerSourceReferenceGroup[] = []
  const sharedGroup = createExplicitAnswerSourceReferenceGroup(
    'Workflow shared answers',
    workflow.answers,
  )
  if (sharedGroup) {
    groups.push(sharedGroup)
  }

  workflow.workflows.forEach((workflowChild, index) => {
    const childGroup = createExplicitAnswerSourceReferenceGroup(
      `Workflow child ${index + 1} answers`,
      workflowChild.answers,
    )
    if (childGroup) {
      groups.push(childGroup)
    }
  })

  return groups
}

export function materializeSimpleWorkflowChild(draft: {
  childKind: 'planning' | 'planning_batch'
  requestKey: string
  workflowTaskKey: string
  groupKey: string
  blockedByWorkflowKeys: string
  childBlockedByJson: string
  title: string
  description: string
  acceptanceCriteria: string
  requestedUpdates: string
  childDecisionRefs: string
  childAnswersJson: string
  batchRequestsJson: string
}): GoalPlanningWorkflowCreateChildInput {
  if (draft.childKind === 'planning_batch') {
    return {
      kind: 'planning_batch',
      groupKey: draft.groupKey.trim(),
      blockedByWorkflowKeys: parseListInput(draft.blockedByWorkflowKeys),
      decisionRefs: parseListInput(draft.childDecisionRefs),
      answers: draft.childAnswersJson.trim()
        ? parseInterpretablePlanningAnswersJson(draft.childAnswersJson, 'Workflow child answers')
        : undefined,
      requests: draft.batchRequestsJson.trim()
        ? parseWorkflowBatchRequestsJson(draft.batchRequestsJson)
        : undefined,
    }
  }

  return {
    kind: 'planning',
    requestKey: draft.requestKey.trim() || undefined,
    workflowTaskKey: draft.workflowTaskKey.trim() || undefined,
    groupKey: draft.groupKey.trim() || undefined,
    blockedByWorkflowKeys: parseListInput(draft.blockedByWorkflowKeys),
    blockedBy: draft.childBlockedByJson.trim()
      ? parseBlockerRefsJson(draft.childBlockedByJson, 'Workflow child blockers')
      : undefined,
    title: draft.title.trim(),
    description: draft.description.trim(),
    acceptanceCriteria: parseListInput(draft.acceptanceCriteria),
    decisionRefs: parseListInput(draft.childDecisionRefs),
    answers: draft.childAnswersJson.trim()
      ? parseInterpretablePlanningAnswersJson(draft.childAnswersJson, 'Workflow child answers')
      : undefined,
    requestedUpdates: parseListInput(draft.requestedUpdates),
  }
}

export function materializeSimpleDecisionWorkflowChild(
  draft: DecisionFollowThroughDraft,
): GoalDecisionWorkflowBatchChildInput {
  if (draft.workflowChildKind === 'planning_batch') {
    return {
      kind: 'planning_batch',
      groupKey: draft.groupKey.trim(),
      blockedByWorkflowKeys: parseListInput(draft.blockedByWorkflowKeys),
      answers: draft.answersJson.trim()
        ? parseInterpretablePlanningAnswersJson(
            draft.answersJson,
            'Decision workflow child answers',
          )
        : undefined,
      requests: draft.batchRequestsJson.trim()
        ? parseWorkflowBatchRequestsJson(draft.batchRequestsJson)
        : undefined,
    }
  }

  return {
    kind: 'planning',
    workflowTaskKey: draft.workflowTaskKey.trim() || undefined,
    blockedByWorkflowKeys: parseListInput(draft.blockedByWorkflowKeys),
    title: draft.title.trim(),
    description: draft.description.trim(),
    acceptanceCriteria: parseListInput(draft.acceptanceCriteria),
    answers: draft.answersJson.trim()
      ? parseInterpretablePlanningAnswersJson(draft.answersJson, 'Decision workflow child answers')
      : undefined,
    requestedUpdates: parseListInput(draft.requestedUpdates),
  }
}

function extractWorkflowKeyFromPlanningRequests(requests: GoalPlanningRequest[] | undefined) {
  for (const request of requests ?? []) {
    const workflowKey = request.workflowKey?.trim()
    if (workflowKey) {
      return workflowKey
    }
  }

  return null
}

export function extractWorkflowKeyFromDecisionFollowThroughResult(
  followThrough: GoalDecisionFollowThroughResult | undefined,
) {
  if (!followThrough) {
    return null
  }

  if (followThrough.kind === 'workflow_batch') {
    const directWorkflowKey = followThrough.workflowKey?.trim()
    if (directWorkflowKey) {
      return directWorkflowKey
    }

    const topLevelRequestWorkflowKey = extractWorkflowKeyFromPlanningRequests(
      followThrough.requests,
    )
    if (topLevelRequestWorkflowKey) {
      return topLevelRequestWorkflowKey
    }

    for (const workflow of followThrough.workflows) {
      const childWorkflowKey = extractWorkflowKeyFromPlanningRequests(workflow.requests)
      if (childWorkflowKey) {
        return childWorkflowKey
      }
    }

    return null
  }

  return extractWorkflowKeyFromPlanningRequests(followThrough.requests)
}

export function extractWorkflowKeyFromDecisionMutationResult(
  result:
    | GoalDecisionAnswerResult
    | GoalDecisionAnswerBatchResult
    | {
        followThrough?: GoalDecisionFollowThroughResult
      }
    | undefined,
) {
  return extractWorkflowKeyFromDecisionFollowThroughResult(result?.followThrough)
}
