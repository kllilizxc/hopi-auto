import {
  type CapturedAnswer,
  type GoalDecision,
  type GoalDecisionAnswerBatchResult,
  type GoalDecisionAnswerResult,
  type GoalDecisionFollowThroughResult,
  type GoalPlanningRequest,
  type GoalPlanningRequestSet,
  type GoalPlanningWorkflowCreateResult,
  type GoalPlanningWorkflowState,
  type GoalSourceResponseFormat,
  type PreferenceDocument,
  resolveGoalDecision,
  type TodoBoard,
  type TodoTaskItem,
} from '../lib/api'
import {
  collectUniqueWorkflowSharedAnswersFromPlanningRequests,
  collectUniqueWorkflowSharedDecisionRefsFromPlanningRequests,
} from './boardViewStructuredEditors'

export type ExistingPlanningMutationAuthoritySnapshot = {
  existingRequestKeys: string[]
  existingTaskRefs: string[]
  existingGroupKeys: string[]
  existingWorkflowKeys: string[]
}

export type GoalDecisionPlanningLeafFollowThroughResult = Extract<
  GoalDecisionFollowThroughResult,
  { kind: 'planning' }
>
export type GoalDecisionPlanningBatchLeafFollowThroughResult = Extract<
  GoalDecisionFollowThroughResult,
  { kind: 'planning_batch' }
>
export type GoalDecisionWorkflowBatchRootFollowThroughResult = Extract<
  GoalDecisionFollowThroughResult,
  { kind: 'workflow_batch' }
>

export type GoalDecisionFollowThroughReuseAuthority = {
  createdRequestKeys: string[]
  reusedRequestKeys: string[]
  createdTaskRefs: string[]
  reusedTaskRefs: string[]
  createdGroupKeys: string[]
  reusedGroupKeys: string[]
  workflowCreated?: boolean
}

export type GoalDecisionLeafFollowThroughResultWithReuse =
  | (GoalDecisionPlanningLeafFollowThroughResult & GoalDecisionFollowThroughReuseAuthority)
  | (GoalDecisionPlanningBatchLeafFollowThroughResult & GoalDecisionFollowThroughReuseAuthority)

export type GoalDecisionFollowThroughResultWithReuse =
  | GoalDecisionLeafFollowThroughResultWithReuse
  | (Omit<GoalDecisionWorkflowBatchRootFollowThroughResult, 'workflows'> &
      GoalDecisionFollowThroughReuseAuthority & {
        workflowSharedDecisionRefs: string[]
        workflowSharedAnswers: CapturedAnswer[]
        workflows: GoalDecisionLeafFollowThroughResultWithReuse[]
      })

export type GoalDecisionResolveMutationResult = Omit<
  Awaited<ReturnType<typeof resolveGoalDecision>>,
  'followThrough'
> & {
  followThrough?: GoalDecisionFollowThroughResultWithReuse
}

export type GoalDecisionAnswerResultWithReuse = Omit<GoalDecisionAnswerResult, 'followThrough'> & {
  followThrough?: GoalDecisionFollowThroughResultWithReuse
}

export type GoalDecisionAnswerBatchResultWithReuse = Omit<
  GoalDecisionAnswerBatchResult,
  'followThrough'
> & {
  followThrough?: GoalDecisionFollowThroughResultWithReuse
}

export type GoalPlanningWorkflowCreateChildResultWithReuse =
  GoalPlanningWorkflowCreateResult['workflows'][number] & {
    createdGroupKeys: string[]
    reusedGroupKeys: string[]
  }

export type GoalPlanningWorkflowCreateResultWithReuse = Omit<
  GoalPlanningWorkflowCreateResult & {
    created: boolean
    resolvedSourceResponseFormat?: GoalSourceResponseFormat
  },
  'workflows'
> & {
  workflowCreated: boolean
  createdGroupKeys: string[]
  reusedGroupKeys: string[]
  workflows: GoalPlanningWorkflowCreateChildResultWithReuse[]
}

export function buildExistingPlanningMutationAuthoritySnapshot(
  board: TodoBoard | undefined,
  planningRequests: GoalPlanningRequestSet | undefined,
  workflows: { goalKey: string; workflows: GoalPlanningWorkflowState[] } | undefined,
): ExistingPlanningMutationAuthoritySnapshot {
  return {
    existingRequestKeys: Array.from(
      new Set((planningRequests?.requests ?? []).map((request) => request.requestKey)),
    ),
    existingTaskRefs: Array.from(new Set((board?.items ?? []).map((task) => task.ref))),
    existingGroupKeys: Array.from(
      new Set(
        (planningRequests?.requests ?? [])
          .map((request) => request.groupKey?.trim())
          .filter((groupKey): groupKey is string => Boolean(groupKey && groupKey.length > 0)),
      ),
    ),
    existingWorkflowKeys: Array.from(
      new Set((workflows?.workflows ?? []).map((workflow) => workflow.workflowKey)),
    ),
  }
}

export function partitionMutationAuthorityRefs(refs: string[], existingRefs: string[]) {
  const existing = new Set(existingRefs)
  const created: string[] = []
  const reused: string[] = []

  for (const ref of refs) {
    if (!ref || created.includes(ref) || reused.includes(ref)) {
      continue
    }
    if (existing.has(ref)) {
      reused.push(ref)
    } else {
      created.push(ref)
    }
  }

  return {
    created,
    reused,
  }
}

export function buildDecisionFollowThroughReuseAuthority(
  followThrough: GoalDecisionFollowThroughResult,
  existingState: ExistingPlanningMutationAuthoritySnapshot,
): GoalDecisionFollowThroughReuseAuthority {
  const requestRefs = partitionMutationAuthorityRefs(
    followThrough.requestKeys,
    existingState.existingRequestKeys,
  )
  const taskRefs = partitionMutationAuthorityRefs(
    followThrough.taskRefs,
    existingState.existingTaskRefs,
  )
  const groupKeys =
    'groupKeys' in followThrough
      ? partitionMutationAuthorityRefs(followThrough.groupKeys, existingState.existingGroupKeys)
      : 'groupKey' in followThrough
        ? partitionMutationAuthorityRefs([followThrough.groupKey], existingState.existingGroupKeys)
        : { created: [], reused: [] }

  return {
    createdRequestKeys: requestRefs.created,
    reusedRequestKeys: requestRefs.reused,
    createdTaskRefs: taskRefs.created,
    reusedTaskRefs: taskRefs.reused,
    createdGroupKeys: groupKeys.created,
    reusedGroupKeys: groupKeys.reused,
    workflowCreated:
      'workflowKey' in followThrough && followThrough.workflowKey
        ? !existingState.existingWorkflowKeys.includes(followThrough.workflowKey)
        : undefined,
  }
}

export function enrichDecisionFollowThroughResultWithReuse(
  followThrough: GoalDecisionFollowThroughResult,
  existingState: ExistingPlanningMutationAuthoritySnapshot,
): GoalDecisionFollowThroughResultWithReuse {
  const authority = buildDecisionFollowThroughReuseAuthority(followThrough, existingState)

  if (followThrough.kind === 'workflow_batch') {
    return {
      ...followThrough,
      ...authority,
      workflowSharedDecisionRefs: collectUniqueWorkflowSharedDecisionRefsFromPlanningRequests(
        followThrough.requests,
      ),
      workflowSharedAnswers: collectUniqueWorkflowSharedAnswersFromPlanningRequests(
        followThrough.requests,
      ),
      workflows: followThrough.workflows.map(
        (workflow) =>
          enrichDecisionFollowThroughResultWithReuse(
            workflow,
            existingState,
          ) as GoalDecisionLeafFollowThroughResultWithReuse,
      ),
    }
  }

  return {
    ...followThrough,
    ...authority,
  }
}

export function collectWorkflowCreateChildGroupKeys(
  workflow: GoalPlanningWorkflowCreateResult['workflows'][number],
) {
  return Array.from(
    new Set(
      [
        'groupKey' in workflow ? workflow.groupKey?.trim() : undefined,
        ...workflow.requests.map((request) => request.groupKey?.trim()),
      ].filter((groupKey): groupKey is string => Boolean(groupKey && groupKey.length > 0)),
    ),
  )
}

export function buildWorkflowCreateChildReuseAuthority(
  workflow: GoalPlanningWorkflowCreateResult['workflows'][number],
  existingState: ExistingPlanningMutationAuthoritySnapshot,
) {
  const groupKeys = partitionMutationAuthorityRefs(
    collectWorkflowCreateChildGroupKeys(workflow),
    existingState.existingGroupKeys,
  )

  return {
    createdGroupKeys: groupKeys.created,
    reusedGroupKeys: groupKeys.reused,
  }
}

export function enrichWorkflowCreateResultWithReuse(
  result: GoalPlanningWorkflowCreateResult & {
    created: boolean
    resolvedSourceResponseFormat?: GoalSourceResponseFormat
  },
  existingState: ExistingPlanningMutationAuthoritySnapshot,
): GoalPlanningWorkflowCreateResultWithReuse {
  const groupKeys = partitionMutationAuthorityRefs(
    result.groupKeys,
    existingState.existingGroupKeys,
  )

  return {
    ...result,
    workflowCreated: result.workflowKey
      ? !existingState.existingWorkflowKeys.includes(result.workflowKey)
      : result.created,
    createdGroupKeys: groupKeys.created,
    reusedGroupKeys: groupKeys.reused,
    workflows: result.workflows.map((workflow) => ({
      ...workflow,
      ...buildWorkflowCreateChildReuseAuthority(workflow, existingState),
    })),
  }
}

export function summarizeDecisionMutationResult(
  decision: GoalDecision & {
    created?: boolean
  },
) {
  const details = [
    decision.decisionKey,
    decision.summaryKey ? `summaryKey=${decision.summaryKey}` : null,
    decision.taskRef ? `task=${decision.taskRef}` : null,
    decision.matchHints && decision.matchHints.length > 0
      ? `matchHints=${decision.matchHints.join('|')}`
      : null,
  ].filter(Boolean)

  return `${decision.created === false ? 'Reused open decision' : 'Opened decision'} ${details.join(' · ')}.`
}

export function summarizeDecisionFollowThroughResult(
  followThrough: GoalDecisionFollowThroughResult,
) {
  const details = [
    `kind=${followThrough.kind}`,
    'workflowKey' in followThrough && followThrough.workflowKey
      ? `workflow=${followThrough.workflowKey}`
      : null,
    'groupKey' in followThrough && followThrough.groupKey
      ? `group=${followThrough.groupKey}`
      : null,
    'groupKeys' in followThrough && followThrough.groupKeys.length > 0
      ? `${followThrough.groupKeys.length} group sink(s)`
      : null,
    'workflows' in followThrough ? `${followThrough.workflows.length} workflow child(ren)` : null,
    'workflowSharedDecisionRefs' in followThrough &&
    Array.isArray(followThrough.workflowSharedDecisionRefs) &&
    followThrough.workflowSharedDecisionRefs.length > 0
      ? `${followThrough.workflowSharedDecisionRefs.length} shared decision ref(s)`
      : null,
    'workflowSharedAnswers' in followThrough &&
    Array.isArray(followThrough.workflowSharedAnswers) &&
    followThrough.workflowSharedAnswers.length > 0
      ? `${followThrough.workflowSharedAnswers.length} shared answer(s)`
      : null,
    `${followThrough.requestKeys.length} request(s)`,
    `${followThrough.taskRefs.length} task(s)`,
    `${followThrough.blockerTaskRefs.length} blocker task(s)`,
  ].filter(Boolean)

  return details.join(' · ')
}

export function summarizeTaskMutationResult(task: TodoTaskItem) {
  const details = [
    task.ref,
    task.kind,
    `status=${task.status}`,
    `${task.acceptanceCriteria.length} acceptance item(s)`,
    task.blockedBy.length > 0 ? `${task.blockedBy.length} blocker(s)` : null,
  ].filter(Boolean)

  return details.join(' · ')
}

export function summarizePlanningRequestMutationResult(
  request: GoalPlanningRequest & { resolvedSourceResponseFormat?: GoalSourceResponseFormat },
) {
  const details = [
    request.requestKey,
    `task=${request.taskRef}`,
    request.workflowKey ? `workflow=${request.workflowKey}` : null,
    request.workflowTaskKey ? `child=${request.workflowTaskKey}` : null,
    request.groupKey ? `group=${request.groupKey}` : null,
    request.resolvedSourceResponseFormat
      ? `resolvedFormat=${request.resolvedSourceResponseFormat}`
      : null,
  ].filter(Boolean)

  return details.join(' · ')
}

export function summarizePreferenceDocumentMutationResult(document: PreferenceDocument) {
  const activeCount = document.entries.filter((entry) => entry.status === 'active').length
  const retiredCount = document.entries.filter((entry) => entry.status === 'retired').length

  return `${document.entries.length} preference(s) total · ${activeCount} active · ${retiredCount} retired`
}

export function summarizeWorkflowCreateMutationResult(
  result: GoalPlanningWorkflowCreateResultWithReuse,
) {
  const reusedRequestKeys = listReusedMutationRefs(result.requestKeys, result.createdRequestKeys)
  const reusedTaskRefs = listReusedMutationRefs(result.taskRefs, result.createdTaskRefs)
  const details = [
    result.workflowKey ?? 'workflow_batch',
    result.workflowCreated ? 'workflow created' : 'workflow updated',
    result.workflows.length > 0 ? `${result.workflows.length} workflow child(ren)` : null,
    result.groupKeys.length > 0 ? `${result.groupKeys.length} group sink(s)` : null,
    result.createdGroupKeys.length > 0
      ? `${result.createdGroupKeys.length} group(s) created`
      : null,
    result.reusedGroupKeys.length > 0 ? `${result.reusedGroupKeys.length} group(s) reused` : null,
    result.workflowSharedDecisionRefs.length > 0
      ? `${result.workflowSharedDecisionRefs.length} shared decision ref(s)`
      : null,
    result.workflowSharedAnswers.length > 0
      ? `${result.workflowSharedAnswers.length} shared answer(s)`
      : null,
    `${result.createdRequestKeys.length} request(s) created`,
    `${result.createdTaskRefs.length} task(s) created`,
    reusedRequestKeys.length > 0 ? `${reusedRequestKeys.length} request(s) reused` : null,
    reusedTaskRefs.length > 0 ? `${reusedTaskRefs.length} task(s) reused` : null,
    result.blockerTaskRefs.length > 0 ? `${result.blockerTaskRefs.length} blocker task(s)` : null,
    result.resolvedSourceResponseFormat
      ? `resolvedFormat=${result.resolvedSourceResponseFormat}`
      : null,
  ].filter(Boolean)

  return details.join(' · ')
}

export function listReusedMutationRefs(allRefs: string[], createdRefs: string[]) {
  if (allRefs.length === 0) {
    return []
  }

  const created = new Set(createdRefs)
  return allRefs.filter((ref) => !created.has(ref))
}

export function formatTimestamp(value: string) {
  return new Date(value).toLocaleString()
}
