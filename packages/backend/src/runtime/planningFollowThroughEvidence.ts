import {
  type GoalPlanningRequest,
  type GoalPlanningRequestUpdateTarget,
  PLANNING_REQUEST_UPDATE_TARGETS,
  type PlanningRequestStore,
} from '../storage/planningRequestStore'
import type { GoalWriteTraceEntry } from './writeTrace'
import type { WriteTraceStore } from './writeTraceStore'

export interface PlanningFollowThroughEvidence {
  requestKeys: string[]
  decisionRefs: string[]
  requestedUpdates: GoalPlanningRequestUpdateTarget[]
  observedUpdates: GoalPlanningRequestUpdateTarget[]
  missingUpdates: GoalPlanningRequestUpdateTarget[]
}

export async function inspectPlanningFollowThroughEvidence(options: {
  goalKey: string
  taskRef: string
  planningRequests: PlanningRequestStore
  writeTraces: WriteTraceStore
  fallbackRequestedUpdates?: GoalPlanningRequestUpdateTarget[]
}): Promise<PlanningFollowThroughEvidence> {
  const requestSet = await options.planningRequests.ensureGoalPlanningRequests(options.goalKey)
  const relevantRequests = requestSet.requests.filter(
    (request) => request.status === 'open' && request.taskRef === options.taskRef,
  )
  const traces = await options.writeTraces.listEntries(options.goalKey, {
    taskRef: options.taskRef,
    limit: 40,
  })

  const evidence = summarizePlanningFollowThroughEvidence(relevantRequests, traces)
  if (evidence.requestedUpdates.length > 0 || !options.fallbackRequestedUpdates?.length) {
    return evidence
  }

  const requestedUpdates = mergeOrderedUpdateTargets(options.fallbackRequestedUpdates)
  const observedUpdates = requestedUpdates.filter((target) =>
    traces.some((entry) => traceTouchesRequestedUpdate(entry, target)),
  )

  return {
    ...evidence,
    requestedUpdates,
    observedUpdates,
    missingUpdates: requestedUpdates.filter((target) => !observedUpdates.includes(target)),
  }
}

export function summarizePlanningFollowThroughEvidence(
  requests: GoalPlanningRequest[],
  traces: GoalWriteTraceEntry[],
): PlanningFollowThroughEvidence {
  const requestKeys = requests.map((request) => request.requestKey)
  const decisionRefs = mergeOrderedStrings(requests.flatMap((request) => request.decisionRefs))
  const requestedUpdates = mergeOrderedUpdateTargets(
    requests.flatMap((request) => request.requestedUpdates),
  )
  const observedUpdates = requestedUpdates.filter((target) =>
    traces.some((entry) => traceTouchesRequestedUpdate(entry, target)),
  )

  return {
    requestKeys,
    decisionRefs,
    requestedUpdates,
    observedUpdates,
    missingUpdates: requestedUpdates.filter((target) => !observedUpdates.includes(target)),
  }
}

function traceTouchesRequestedUpdate(
  entry: GoalWriteTraceEntry,
  target: GoalPlanningRequestUpdateTarget,
) {
  const candidatePaths = [...entry.targetPaths, ...entry.changes.map((change) => change.path)]
  return candidatePaths.some((path) => path === target || path.endsWith(`/${target}`))
}

function mergeOrderedStrings(values: string[]) {
  const merged: string[] = []
  for (const value of values) {
    if (!merged.includes(value)) {
      merged.push(value)
    }
  }
  return merged
}

function mergeOrderedUpdateTargets(values: GoalPlanningRequestUpdateTarget[]) {
  const ordered = mergeOrderedStrings(values)
  const coreTargetSet = new Set<string>(PLANNING_REQUEST_UPDATE_TARGETS)
  const coreTargets = PLANNING_REQUEST_UPDATE_TARGETS.filter((target) => ordered.includes(target))
  const extraTargets = ordered.filter((target) => !coreTargetSet.has(target))
  return [...coreTargets, ...extraTargets]
}
