import type { BlockerRef } from '../lib/api'
import {
  hasAtLeastOneBatchRequest,
  hasAtLeastOneDecisionWorkflowChild,
  hasValidBatchRequestsJsonOrEmpty,
  hasValidPlanningAnswersJsonOrEmpty,
  normalizeOptionalString,
  parseDecisionWorkflowChildrenJson,
  parseWorkflowBatchRequestsJson,
  parseWorkflowChildrenJson,
} from './boardViewJsonInputSupport'
import { parseListInput, parseWorkflowChildEditorItems } from './boardViewStructuredEditorCodec'
import type {
  DecisionFollowThroughDraft,
  ReusableStringSuggestion,
  ReusableWorkflowGraphSuggestion,
} from './boardViewStructuredEditorTypes'
import { validateBatchRequestBlockers } from './boardViewStructuredEditorValidation'

type WorkflowChildDependencyDraftState = {
  dependencyKey: string
  blockedByWorkflowKeys: string[]
}

type WorkflowChildDependencyDraftSpec = {
  label: string
  kind: 'planning' | 'planning_batch'
  dependencyKey?: string
  groupKey?: string
  batchRequestPresence?: 'present' | 'empty' | 'invalid'
  blockedByWorkflowKeys: string[]
}

type WorkflowRootReuseFirstChildSpec = {
  kind: 'planning' | 'planning_batch'
  groupKey?: string
}

function uniqueWorkflowDependencyKeys(values: string[]) {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    unique.push(trimmed)
  }

  return unique
}

function uniqueWorkflowAuthoringIssues(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function buildReusableSuggestionValueSet(suggestions: ReusableStringSuggestion[]) {
  return new Set(
    suggestions.map((suggestion) => suggestion.value.trim()).filter((value) => value.length > 0),
  )
}

function replaceWorkflowChildDependencyDraftState(
  states: WorkflowChildDependencyDraftState[],
  next: WorkflowChildDependencyDraftState,
) {
  return [...states.filter((state) => state.dependencyKey !== next.dependencyKey), next]
}

function findWorkflowDependencyCycleKey(blockedByWorkflowKeysByKey: Map<string, string[]>) {
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (dependencyKey: string): string | null => {
    if (visited.has(dependencyKey)) {
      return null
    }
    if (visiting.has(dependencyKey)) {
      return dependencyKey
    }
    visiting.add(dependencyKey)
    for (const blockedByWorkflowKey of blockedByWorkflowKeysByKey.get(dependencyKey) ?? []) {
      if (!blockedByWorkflowKeysByKey.has(blockedByWorkflowKey)) {
        continue
      }
      const cycleKey = visit(blockedByWorkflowKey)
      if (cycleKey) {
        return cycleKey
      }
    }
    visiting.delete(dependencyKey)
    visited.add(dependencyKey)
    return null
  }

  for (const dependencyKey of blockedByWorkflowKeysByKey.keys()) {
    const cycleKey = visit(dependencyKey)
    if (cycleKey) {
      return cycleKey
    }
  }

  return null
}

function createWorkflowChildDependencyDraftSpec(
  label: string,
  child: {
    kind: 'planning' | 'planning_batch'
    workflowTaskKey?: string
    groupKey?: string
    requests?: unknown[]
    batchRequestPresence?: 'present' | 'empty' | 'invalid'
    blockedByWorkflowKeys?: string[]
  },
): WorkflowChildDependencyDraftSpec {
  return {
    label,
    kind: child.kind,
    dependencyKey:
      child.kind === 'planning_batch'
        ? normalizeOptionalString(child.groupKey)
        : normalizeOptionalString(child.workflowTaskKey),
    groupKey: normalizeOptionalString(child.groupKey),
    batchRequestPresence:
      child.kind === 'planning_batch'
        ? (child.batchRequestPresence ?? ((child.requests?.length ?? 0) > 0 ? 'present' : 'empty'))
        : undefined,
    blockedByWorkflowKeys: uniqueWorkflowDependencyKeys(child.blockedByWorkflowKeys ?? []),
  }
}

function resolveBatchRequestDraftPresence(source: string): 'present' | 'empty' | 'invalid' {
  if (source.trim().length === 0) {
    return 'empty'
  }

  try {
    return parseWorkflowBatchRequestsJson(source).length > 0 ? 'present' : 'empty'
  } catch {
    return 'invalid'
  }
}

function listWorkflowGroupedRequestReuseIssues(input: {
  reuseGroupKey: string
  draftChildren: WorkflowChildDependencyDraftSpec[]
}) {
  const reuseGroupKey = input.reuseGroupKey.trim()
  const issues: string[] = []

  for (const [index, child] of input.draftChildren.entries()) {
    if (child.kind !== 'planning_batch' || child.batchRequestPresence !== 'empty') {
      continue
    }

    if (!reuseGroupKey) {
      issues.push(
        `${child.label} needs at least one grouped request unless root reuseGroupKey is adopting an existing grouped planning sink.`,
      )
      continue
    }

    if ((child.groupKey?.trim() ?? '') !== reuseGroupKey) {
      issues.push(
        `${child.label} can leave grouped requests empty only when groupKey matches root reuseGroupKey: ${reuseGroupKey}.`,
      )
      continue
    }

    if (index !== 0) {
      issues.push(
        `${child.label} can leave grouped requests empty only on the first workflow child because root grouped reuse is consumed there.`,
      )
    }
  }

  return issues
}

function listBatchRequestTaskBlockerIssues(
  requests: Array<{
    label: string
    blockedBy?: BlockerRef[]
  }>,
  validTaskBlockerRefs?: Set<string>,
) {
  const blockerError = validateBatchRequestBlockers(requests, validTaskBlockerRefs)
  return blockerError ? [blockerError] : []
}

function listWorkflowRootReuseIssues(input: {
  reuseTaskRef: string
  reuseGroupKey: string
  firstChild?: WorkflowRootReuseFirstChildSpec
  validReuseTaskRefs?: ReusableStringSuggestion[]
  validReuseGroupKeys?: ReusableStringSuggestion[]
}) {
  const reuseTaskRef = input.reuseTaskRef.trim()
  const reuseGroupKey = input.reuseGroupKey.trim()
  const issues: string[] = []

  if (reuseTaskRef && reuseGroupKey) {
    issues.push('Direct workflow reuse can target only one existing surface at a time.')
    return issues
  }

  if (reuseGroupKey) {
    const firstChild = input.firstChild
    if (!firstChild || firstChild.kind !== 'planning_batch') {
      issues.push('Grouped workflow reuse requires the first child to be planning_batch.')
      return issues
    }

    const firstChildGroupKey = firstChild.groupKey?.trim() ?? ''
    if (firstChildGroupKey !== reuseGroupKey) {
      issues.push(`Grouped workflow reuse mismatch: ${reuseGroupKey} != ${firstChildGroupKey}`)
      return issues
    }

    const validReuseGroupKeys = input.validReuseGroupKeys
      ? buildReusableSuggestionValueSet(input.validReuseGroupKeys)
      : null
    if (validReuseGroupKeys && !validReuseGroupKeys.has(reuseGroupKey)) {
      issues.push(`Planning group not found for reuse: ${reuseGroupKey}`)
    }
    return issues
  }

  if (reuseTaskRef) {
    const validReuseTaskRefs = input.validReuseTaskRefs
      ? buildReusableSuggestionValueSet(input.validReuseTaskRefs)
      : null
    if (validReuseTaskRefs && !validReuseTaskRefs.has(reuseTaskRef)) {
      issues.push(`Planning task not found for reuse: ${reuseTaskRef}`)
    }
  }

  return issues
}

function resolveFirstWorkflowRootReuseChildSpecFromWorkflowDraft(workflowDraft: {
  childKind: 'planning' | 'planning_batch'
  groupKey: string
  childrenJson: string
}) {
  if (workflowDraft.childrenJson.trim().length > 0) {
    try {
      const children = parseWorkflowChildrenJson(workflowDraft.childrenJson)
      const firstChild = children[0]
      if (!firstChild) {
        return undefined
      }
      return {
        kind: firstChild.kind,
        groupKey: firstChild.kind === 'planning_batch' ? firstChild.groupKey : firstChild.groupKey,
      } satisfies WorkflowRootReuseFirstChildSpec
    } catch {
      return undefined
    }
  }

  return {
    kind: workflowDraft.childKind,
    groupKey: workflowDraft.groupKey,
  } satisfies WorkflowRootReuseFirstChildSpec
}

function resolveFirstWorkflowRootReuseChildSpecFromDecisionFollowThroughDraft(
  draft: DecisionFollowThroughDraft,
) {
  if (draft.kind !== 'workflow_batch') {
    return undefined
  }

  if (draft.workflowChildrenJson.trim().length > 0) {
    try {
      const children = parseDecisionWorkflowChildrenJson(draft.workflowChildrenJson)
      const firstChild = children[0]
      if (!firstChild) {
        return undefined
      }
      return {
        kind: firstChild.kind,
        groupKey: firstChild.kind === 'planning_batch' ? firstChild.groupKey : undefined,
      } satisfies WorkflowRootReuseFirstChildSpec
    } catch {
      return undefined
    }
  }

  return {
    kind: draft.workflowChildKind,
    groupKey: draft.groupKey,
  } satisfies WorkflowRootReuseFirstChildSpec
}

function buildCurrentWorkflowChildDependencyDraftStates(
  workflowGraphs: ReusableWorkflowGraphSuggestion[],
  workflowKey: string,
) {
  const trimmedWorkflowKey = workflowKey.trim()
  if (trimmedWorkflowKey.length === 0) {
    return [] as WorkflowChildDependencyDraftState[]
  }

  const workflowGraph = workflowGraphs.find(
    (suggestion) => suggestion.item.workflowKey === trimmedWorkflowKey,
  )
  if (!workflowGraph) {
    return [] as WorkflowChildDependencyDraftState[]
  }

  const { items, error } = parseWorkflowChildEditorItems(workflowGraph.item.childrenJson)
  if (error) {
    return [] as WorkflowChildDependencyDraftState[]
  }

  return items.flatMap((item) => {
    const spec = createWorkflowChildDependencyDraftSpec('Current workflow child', {
      kind: item.kind,
      workflowTaskKey: item.workflowTaskKey,
      groupKey: item.groupKey,
      blockedByWorkflowKeys: parseListInput(item.blockedByWorkflowKeys),
    })
    return spec.dependencyKey
      ? [
          {
            dependencyKey: spec.dependencyKey,
            blockedByWorkflowKeys: spec.blockedByWorkflowKeys,
          },
        ]
      : []
  })
}

function listWorkflowChildDependencyIssues(input: {
  currentStates: WorkflowChildDependencyDraftState[]
  draftChildren: WorkflowChildDependencyDraftSpec[]
}) {
  const issues: string[] = []
  let currentStates = [...input.currentStates]

  for (const child of input.draftChildren) {
    const dependencyKey = child.dependencyKey?.trim()
    const blockedByWorkflowKeys = uniqueWorkflowDependencyKeys(child.blockedByWorkflowKeys)
    let hasDependencyIssue = false

    if (blockedByWorkflowKeys.length > 0) {
      if (!dependencyKey) {
        issues.push(
          `${child.label} needs workflowTaskKey or groupKey before workflow dependencies can be resolved.`,
        )
        hasDependencyIssue = true
      } else if (blockedByWorkflowKeys.includes(dependencyKey)) {
        issues.push(`${child.label} cannot depend on itself: ${dependencyKey}.`)
        hasDependencyIssue = true
      } else {
        const currentKeys = new Set(currentStates.map((state) => state.dependencyKey))
        const missingKeys = blockedByWorkflowKeys.filter((key) => !currentKeys.has(key))
        if (missingKeys.length > 0) {
          issues.push(
            `${child.label} depends on workflow child keys that are not currently available: ${missingKeys.join(', ')}.`,
          )
          hasDependencyIssue = true
        } else {
          const blockedByWorkflowKeysByKey = new Map<string, string[]>()
          for (const state of currentStates) {
            blockedByWorkflowKeysByKey.set(
              state.dependencyKey,
              uniqueWorkflowDependencyKeys(state.blockedByWorkflowKeys),
            )
          }
          blockedByWorkflowKeysByKey.set(dependencyKey, blockedByWorkflowKeys)
          const cycleKey = findWorkflowDependencyCycleKey(blockedByWorkflowKeysByKey)
          if (cycleKey) {
            issues.push(`Workflow dependency cycle detected at: ${cycleKey}.`)
            hasDependencyIssue = true
          }
        }
      }
    }

    if (!dependencyKey || hasDependencyIssue) {
      continue
    }

    currentStates = replaceWorkflowChildDependencyDraftState(currentStates, {
      dependencyKey,
      blockedByWorkflowKeys,
    })
  }

  return issues
}

export function listWorkflowDraftDependencyIssues(
  workflowDraft: {
    reuseTaskRef: string
    reuseGroupKey: string
    workflowKey: string
    childKind: 'planning' | 'planning_batch'
    workflowTaskKey: string
    groupKey: string
    blockedByWorkflowKeys: string
    batchRequestsJson: string
    childrenJson: string
  },
  workflowGraphs: ReusableWorkflowGraphSuggestion[],
  reusableWorkflowTaskRefSuggestions: ReusableStringSuggestion[] = [],
  reusableWorkflowGroupKeySuggestions: ReusableStringSuggestion[] = [],
  validTaskBlockerRefs?: Set<string>,
) {
  const issues = listWorkflowRootReuseIssues({
    reuseTaskRef: workflowDraft.reuseTaskRef,
    reuseGroupKey: workflowDraft.reuseGroupKey,
    firstChild: resolveFirstWorkflowRootReuseChildSpecFromWorkflowDraft(workflowDraft),
    validReuseTaskRefs: reusableWorkflowTaskRefSuggestions,
    validReuseGroupKeys: reusableWorkflowGroupKeySuggestions,
  })
  const currentStates = buildCurrentWorkflowChildDependencyDraftStates(
    workflowGraphs,
    workflowDraft.workflowKey,
  )

  if (workflowDraft.childrenJson.trim().length > 0) {
    try {
      const children = parseWorkflowChildrenJson(workflowDraft.childrenJson)
      const draftChildren = children.map((child, index) =>
        createWorkflowChildDependencyDraftSpec(`Workflow child ${index + 1}`, child),
      )
      return uniqueWorkflowAuthoringIssues([
        ...issues,
        ...listWorkflowGroupedRequestReuseIssues({
          reuseGroupKey: workflowDraft.reuseGroupKey,
          draftChildren,
        }),
        ...children.flatMap((child, index) =>
          child.kind === 'planning_batch'
            ? listBatchRequestTaskBlockerIssues(
                child.requests?.map((request) => ({
                  label: `Workflow child ${index + 1} batch request blockers`,
                  blockedBy: request.blockedBy,
                })) ?? [],
                validTaskBlockerRefs,
              )
            : [],
        ),
        ...listWorkflowChildDependencyIssues({
          currentStates,
          draftChildren,
        }),
      ])
    } catch {
      return uniqueWorkflowAuthoringIssues(issues)
    }
  }

  const draftChildren = [
    createWorkflowChildDependencyDraftSpec('Workflow child 1', {
      kind: workflowDraft.childKind,
      workflowTaskKey: workflowDraft.workflowTaskKey,
      groupKey: workflowDraft.groupKey,
      batchRequestPresence:
        workflowDraft.childKind === 'planning_batch'
          ? resolveBatchRequestDraftPresence(workflowDraft.batchRequestsJson)
          : undefined,
      blockedByWorkflowKeys: parseListInput(workflowDraft.blockedByWorkflowKeys),
    }),
  ]

  return uniqueWorkflowAuthoringIssues([
    ...issues,
    ...listWorkflowGroupedRequestReuseIssues({
      reuseGroupKey: workflowDraft.reuseGroupKey,
      draftChildren,
    }),
    ...(workflowDraft.childKind === 'planning_batch'
      ? (() => {
          if (workflowDraft.batchRequestsJson.trim().length === 0) {
            return []
          }
          try {
            return listBatchRequestTaskBlockerIssues(
              parseWorkflowBatchRequestsJson(workflowDraft.batchRequestsJson).map((request) => ({
                label: 'Workflow child 1 batch request blockers',
                blockedBy: request.blockedBy,
              })),
              validTaskBlockerRefs,
            )
          } catch {
            return []
          }
        })()
      : []),
    ...listWorkflowChildDependencyIssues({
      currentStates,
      draftChildren,
    }),
  ])
}

export function listDecisionWorkflowChildDependencyIssues(
  draft: DecisionFollowThroughDraft,
  workflowGraphs: ReusableWorkflowGraphSuggestion[],
  reusableWorkflowTaskRefSuggestions: ReusableStringSuggestion[] = [],
  reusableWorkflowGroupKeySuggestions: ReusableStringSuggestion[] = [],
  validTaskBlockerRefs?: Set<string>,
) {
  if (draft.kind !== 'workflow_batch') {
    return []
  }

  const issues = listWorkflowRootReuseIssues({
    reuseTaskRef: draft.reuseTaskRef,
    reuseGroupKey: draft.reuseGroupKey,
    firstChild: resolveFirstWorkflowRootReuseChildSpecFromDecisionFollowThroughDraft(draft),
    validReuseTaskRefs: reusableWorkflowTaskRefSuggestions,
    validReuseGroupKeys: reusableWorkflowGroupKeySuggestions,
  })
  const currentStates = buildCurrentWorkflowChildDependencyDraftStates(
    workflowGraphs,
    draft.workflowKey,
  )

  if (draft.workflowChildrenJson.trim().length > 0) {
    try {
      const children = parseDecisionWorkflowChildrenJson(draft.workflowChildrenJson)
      const draftChildren = children.map((child, index) =>
        createWorkflowChildDependencyDraftSpec(`Follow-through workflow child ${index + 1}`, child),
      )
      return uniqueWorkflowAuthoringIssues([
        ...issues,
        ...listWorkflowGroupedRequestReuseIssues({
          reuseGroupKey: draft.reuseGroupKey,
          draftChildren,
        }),
        ...children.flatMap((child, index) =>
          child.kind === 'planning_batch'
            ? listBatchRequestTaskBlockerIssues(
                child.requests?.map((request) => ({
                  label: `Follow-through workflow child ${index + 1} batch request blockers`,
                  blockedBy: request.blockedBy,
                })) ?? [],
                validTaskBlockerRefs,
              )
            : [],
        ),
        ...listWorkflowChildDependencyIssues({
          currentStates,
          draftChildren,
        }),
      ])
    } catch {
      return uniqueWorkflowAuthoringIssues(issues)
    }
  }

  const draftChildren = [
    createWorkflowChildDependencyDraftSpec('Follow-through workflow child 1', {
      kind: draft.workflowChildKind,
      workflowTaskKey: draft.workflowTaskKey,
      groupKey: draft.groupKey,
      batchRequestPresence:
        draft.workflowChildKind === 'planning_batch'
          ? resolveBatchRequestDraftPresence(draft.batchRequestsJson)
          : undefined,
      blockedByWorkflowKeys: parseListInput(draft.blockedByWorkflowKeys),
    }),
  ]

  return uniqueWorkflowAuthoringIssues([
    ...issues,
    ...listWorkflowGroupedRequestReuseIssues({
      reuseGroupKey: draft.reuseGroupKey,
      draftChildren,
    }),
    ...(draft.workflowChildKind === 'planning_batch'
      ? (() => {
          if (draft.batchRequestsJson.trim().length === 0) {
            return []
          }
          try {
            return listBatchRequestTaskBlockerIssues(
              parseWorkflowBatchRequestsJson(draft.batchRequestsJson).map((request) => ({
                label: 'Follow-through workflow child 1 batch request blockers',
                blockedBy: request.blockedBy,
              })),
              validTaskBlockerRefs,
            )
          } catch {
            return []
          }
        })()
      : []),
    ...listWorkflowChildDependencyIssues({
      currentStates,
      draftChildren,
    }),
  ])
}

function isSimpleDecisionWorkflowChildDraftIncomplete(
  draft: DecisionFollowThroughDraft,
  validTaskBlockerRefs?: Set<string>,
) {
  if (!hasValidPlanningAnswersJsonOrEmpty(draft.answersJson, 'Decision workflow child answers')) {
    return true
  }

  if (draft.workflowChildKind === 'planning_batch') {
    return (
      draft.groupKey.trim().length === 0 ||
      !hasValidBatchRequestsJsonOrEmpty(draft.batchRequestsJson, validTaskBlockerRefs)
    )
  }

  return draft.title.trim().length === 0 || parseListInput(draft.acceptanceCriteria).length === 0
}

export function isDecisionFollowThroughDraftIncomplete(
  draft: DecisionFollowThroughDraft,
  workflowGraphs: ReusableWorkflowGraphSuggestion[] = [],
  reusableWorkflowTaskRefSuggestions: ReusableStringSuggestion[] = [],
  reusableWorkflowGroupKeySuggestions: ReusableStringSuggestion[] = [],
  validTaskBlockerRefs?: Set<string>,
) {
  if (draft.kind === 'none') {
    return false
  }

  if (draft.kind === 'planning') {
    return (
      draft.title.trim().length === 0 ||
      parseListInput(draft.acceptanceCriteria).length === 0 ||
      !hasValidPlanningAnswersJsonOrEmpty(
        draft.answersJson,
        'Decision planning follow-through answers',
      )
    )
  }

  if (draft.kind === 'planning_batch') {
    return (
      draft.groupKey.trim().length === 0 ||
      !hasValidBatchRequestsJsonOrEmpty(draft.batchRequestsJson, validTaskBlockerRefs) ||
      !hasValidPlanningAnswersJsonOrEmpty(
        draft.answersJson,
        'Decision planning-batch follow-through answers',
      ) ||
      !hasAtLeastOneBatchRequest(draft.batchRequestsJson)
    )
  }

  return (
    !hasValidPlanningAnswersJsonOrEmpty(
      draft.workflowAnswersJson,
      'Decision workflow follow-through root answers',
    ) ||
    listDecisionWorkflowChildDependencyIssues(
      draft,
      workflowGraphs,
      reusableWorkflowTaskRefSuggestions,
      reusableWorkflowGroupKeySuggestions,
      validTaskBlockerRefs,
    ).length > 0 ||
    (draft.workflowChildrenJson.trim().length > 0
      ? !hasAtLeastOneDecisionWorkflowChild(draft.workflowChildrenJson)
      : isSimpleDecisionWorkflowChildDraftIncomplete(draft, validTaskBlockerRefs))
  )
}
