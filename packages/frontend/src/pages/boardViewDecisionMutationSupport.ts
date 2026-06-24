import type {
  GoalDecision,
  GoalDecisionFollowThroughInput,
  GoalSourceResponseFormat,
} from '../lib/api'
import {
  normalizeOptionalString,
  normalizePositiveInteger,
  parseAnswerSourcesJson,
  parseDecisionAnswerEntriesJson,
  parseDecisionWorkflowChildrenJson,
  parseInterpretablePlanningAnswersJson,
  parseWorkflowBatchRequestsJson,
} from './boardViewJsonInputSupport'
import {
  buildPlanningAnswerConsumersFromDecisionFollowThrough,
  listDirectAnswerSourceReferenceIssues,
  listExplicitAnswerSourceReferenceExistenceIssues,
  listInferOpenDecisionExplicitAnswerIssues,
  formatSupportsInferDecisionTopics,
  formatSupportsInferOpenDecisions,
  formatSupportsInferRemainingAnswers,
  hasDirectAnswerSourceReferenceAuthority,
  hasInterpretationInputForSelectedFormat,
  resolveSelectedInterpretationFormat,
} from './boardViewInterpretationSupport'
import {
  findFirstBatchDecisionInterpretationIssue,
  findFirstExplicitDecisionInterpretationIssue,
  followThroughInfersRemainingAnswers,
} from './boardViewDecisionInterpretationSupport'
import { listMixedDecisionTopicAndRemainingAnswerIssues } from './boardViewRemainingAnswerSourceSupport'
import {
  createExplicitAnswerSourceReferenceGroup,
  type ExplicitAnswerSourceReferenceGroup,
} from './boardViewSourceResponseSupport'
import { parseListInput } from './boardViewStructuredEditorCodec'
import type { DecisionFollowThroughDraft } from './boardViewStructuredEditorTypes'
import {
  buildDecisionFollowThroughAnswerSourceReferenceGroups,
  materializeSimpleDecisionWorkflowChild,
} from './boardViewWorkflowMutationSupport'

export function materializeDecisionResolutionInput(
  decision: GoalDecision,
  draft: {
    summaryKey: string
    prompt: string
    matchHints: string
    taskRef: string
    answer: string
    sourceExcerpt: string
    sourceOccurrence: string
    answerSourceKey: string
    answerSourceGroupKey: string
    answerSourcesJson: string
    sourceResponse: string
    sourceResponseFormat: GoalSourceResponseFormat
  },
  followThrough: GoalDecisionFollowThroughInput | undefined,
) {
  const answer = normalizeOptionalString(draft.answer)
  const sourceExcerpt = normalizeOptionalString(draft.sourceExcerpt)
  const sourceResponse = normalizeOptionalString(draft.sourceResponse)
  const summaryKey = normalizeOptionalString(draft.summaryKey) ?? decision.summaryKey
  const prompt = normalizeOptionalString(draft.prompt) ?? decision.prompt
  const taskRef = normalizeOptionalString(draft.taskRef) ?? decision.taskRef
  const draftMatchHints = parseListInput(draft.matchHints)
  const matchHints = draftMatchHints.length > 0 ? draftMatchHints : decision.matchHints
  const answerSourceKey = normalizeOptionalString(draft.answerSourceKey)
  const answerSourceGroupKey = normalizeOptionalString(draft.answerSourceGroupKey)
  const answerSources = draft.answerSourcesJson.trim()
    ? parseAnswerSourcesJson(draft.answerSourcesJson, 'Decision resolve answer sources')
    : undefined
  const sourceResponseFormat = resolveSelectedInterpretationFormat(
    draft.sourceResponseFormat,
    sourceResponse,
    answerSources,
  )
  const answerSourceReferenceIssues = listDirectAnswerSourceReferenceIssues(
    answerSourceKey,
    answerSourceGroupKey,
  )
  const explicitAnswerSourceReferenceIssues = listExplicitAnswerSourceReferenceExistenceIssues(
    [
      createExplicitAnswerSourceReferenceGroup('Decision resolve explicit answer', [
        {
          answer,
          sourceExcerpt,
          answerSourceKey,
          answerSourceGroupKey,
        },
      ]),
      ...buildDecisionFollowThroughAnswerSourceReferenceGroups(followThrough),
    ].filter((group): group is ExplicitAnswerSourceReferenceGroup => group !== null),
    answerSources,
  )
  if (answerSourceReferenceIssues.length > 0) {
    throw new Error(
      answerSourceReferenceIssues[0] ??
        'Provide only answerSourceKey or answerSourceGroupKey for this explicit answer.',
    )
  }
  if (explicitAnswerSourceReferenceIssues.length > 0) {
    throw new Error(
      explicitAnswerSourceReferenceIssues[0] ??
        'Decision resolve answer references unknown structured answer sources.',
    )
  }

  const followThroughPlanningAnswers =
    buildPlanningAnswerConsumersFromDecisionFollowThrough(followThrough)
  const inferRemainingAnswers = followThroughInfersRemainingAnswers(followThrough)
  const interpretationIssue = findFirstExplicitDecisionInterpretationIssue({
    contextLabel: 'Decision resolve',
    format: draft.sourceResponseFormat,
    sourceResponse: draft.sourceResponse,
    decisionAnswers: [
      {
        decisionKey: decision.decisionKey,
        summaryKey,
        summary: decision.summary,
        prompt,
        matchHints,
      },
    ],
    planningAnswers: followThroughPlanningAnswers,
    inferRemainingAnswers,
    explicitDecisionKeys: [decision.decisionKey],
  })
  if (interpretationIssue) {
    throw new Error(interpretationIssue)
  }

  if (
    !answer &&
    !sourceExcerpt &&
    !sourceResponse &&
    (!answerSources || answerSources.length === 0) &&
    !hasDirectAnswerSourceReferenceAuthority(answerSourceKey, answerSourceGroupKey)
  ) {
    throw new Error(
      'Resolve decision needs an explicit answer, source excerpt, answerSourceKey, answerSourceGroupKey, answer sources JSON, or a shared source response.',
    )
  }

  if (
    inferRemainingAnswers &&
    !formatSupportsInferRemainingAnswers(draft.sourceResponseFormat)
  ) {
    throw new Error(
      'followThrough.inferRemainingAnswers is not supported by the current source-response format.',
    )
  }

  if (
    inferRemainingAnswers &&
    !hasInterpretationInputForSelectedFormat(
      draft.sourceResponseFormat,
      sourceResponse,
      answerSources,
    )
  ) {
    throw new Error(
      'followThrough.inferRemainingAnswers requires a compatible shared source response or structured answer sources.',
    )
  }

  const sourceOccurrence = normalizePositiveInteger(
    draft.sourceOccurrence,
    'Decision resolve sourceOccurrence',
  )
  if (sourceOccurrence !== undefined && !sourceExcerpt) {
    throw new Error('Decision resolve sourceOccurrence can only be set with sourceExcerpt.')
  }

  return {
    summary: decision.summary,
    summaryKey,
    prompt,
    matchHints,
    taskRef,
    answer,
    sourceExcerpt,
    sourceOccurrence,
    answerSourceKey,
    answerSourceGroupKey,
    answerSources,
    sourceResponse,
    sourceResponseFormat,
    followThrough,
  }
}

export function materializeDecisionFollowThroughInput(
  draft: DecisionFollowThroughDraft,
): GoalDecisionFollowThroughInput | undefined {
  if (draft.kind === 'none') {
    return undefined
  }

  if (draft.kind === 'planning') {
    return {
      kind: 'planning',
      inferRemainingAnswers: draft.inferRemainingAnswers || undefined,
      title: draft.title.trim(),
      description: draft.description.trim(),
      acceptanceCriteria: parseListInput(draft.acceptanceCriteria),
      answers: draft.answersJson.trim()
        ? parseInterpretablePlanningAnswersJson(
            draft.answersJson,
            'Decision planning follow-through answers',
          )
        : undefined,
      requestedUpdates: parseListInput(draft.requestedUpdates),
    }
  }

  if (draft.kind === 'planning_batch') {
    return {
      kind: 'planning_batch',
      groupKey: draft.groupKey.trim(),
      inferRemainingAnswers: draft.inferRemainingAnswers || undefined,
      answers: draft.answersJson.trim()
        ? parseInterpretablePlanningAnswersJson(
            draft.answersJson,
            'Decision planning-batch follow-through answers',
          )
        : undefined,
      requests: parseWorkflowBatchRequestsJson(draft.batchRequestsJson),
    }
  }

  return {
    kind: 'workflow_batch',
    workflowKey: draft.workflowKey.trim() || undefined,
    reuseTaskRef: draft.reuseTaskRef.trim() || undefined,
    reuseGroupKey: draft.reuseGroupKey.trim() || undefined,
    inferRemainingAnswers: draft.inferRemainingAnswers || undefined,
    answers: draft.workflowAnswersJson.trim()
      ? parseInterpretablePlanningAnswersJson(
          draft.workflowAnswersJson,
          'Decision workflow follow-through root answers',
        )
      : undefined,
    workflows: draft.workflowChildrenJson.trim()
      ? parseDecisionWorkflowChildrenJson(draft.workflowChildrenJson)
      : [materializeSimpleDecisionWorkflowChild(draft)],
  }
}

export function materializeSingleDecisionAnswerInput(
  draft: {
    summary: string
    summaryKey: string
    decisionKey: string
    prompt: string
    matchHints: string
    taskRef: string
    answer: string
    sourceExcerpt: string
    sourceOccurrence: string
    answerSourceKey: string
    answerSourceGroupKey: string
    answerSourcesJson: string
    sourceResponse: string
    sourceResponseFormat: GoalSourceResponseFormat
  },
  followThrough: GoalDecisionFollowThroughInput | undefined,
) {
  const summary = draft.summary.trim()
  if (!summary) {
    throw new Error('Single answer mode needs a decision summary.')
  }

  const answer = normalizeOptionalString(draft.answer)
  const sourceExcerpt = normalizeOptionalString(draft.sourceExcerpt)
  const sourceResponse = normalizeOptionalString(draft.sourceResponse)
  const answerSourceKey = normalizeOptionalString(draft.answerSourceKey)
  const answerSourceGroupKey = normalizeOptionalString(draft.answerSourceGroupKey)
  const answerSources = draft.answerSourcesJson.trim()
    ? parseAnswerSourcesJson(draft.answerSourcesJson, 'Decision answer sources')
    : undefined
  const sourceResponseFormat = resolveSelectedInterpretationFormat(
    draft.sourceResponseFormat,
    sourceResponse,
    answerSources,
  )
  const answerSourceReferenceIssues = listDirectAnswerSourceReferenceIssues(
    answerSourceKey,
    answerSourceGroupKey,
  )
  const explicitAnswerSourceReferenceIssues = listExplicitAnswerSourceReferenceExistenceIssues(
    [
      createExplicitAnswerSourceReferenceGroup('Single decision answer', [
        {
          answer,
          sourceExcerpt,
          answerSourceKey,
          answerSourceGroupKey,
        },
      ]),
      ...buildDecisionFollowThroughAnswerSourceReferenceGroups(followThrough),
    ].filter((group): group is ExplicitAnswerSourceReferenceGroup => group !== null),
    answerSources,
  )
  const followThroughPlanningAnswers =
    buildPlanningAnswerConsumersFromDecisionFollowThrough(followThrough)
  if (answerSourceReferenceIssues.length > 0) {
    throw new Error(
      answerSourceReferenceIssues[0] ??
        'Provide only answerSourceKey or answerSourceGroupKey for this explicit answer.',
    )
  }
  if (explicitAnswerSourceReferenceIssues.length > 0) {
    throw new Error(
      explicitAnswerSourceReferenceIssues[0] ??
        'Single decision answer references unknown structured answer sources.',
    )
  }

  const inferRemainingAnswers = followThroughInfersRemainingAnswers(followThrough)
  const interpretationIssue = findFirstExplicitDecisionInterpretationIssue({
    contextLabel: 'Single decision',
    format: draft.sourceResponseFormat,
    sourceResponse: draft.sourceResponse,
    decisionAnswers: [
      {
        decisionKey: draft.decisionKey,
        summaryKey: draft.summaryKey,
        summary,
        prompt: draft.prompt,
        matchHints: draft.matchHints,
      },
    ],
    planningAnswers: followThroughPlanningAnswers,
    inferRemainingAnswers,
    explicitDecisionKeys: [draft.decisionKey].filter(Boolean),
  })
  if (interpretationIssue) {
    throw new Error(interpretationIssue)
  }

  if (
    !answer &&
    !sourceExcerpt &&
    !sourceResponse &&
    (!answerSources || answerSources.length === 0) &&
    !hasDirectAnswerSourceReferenceAuthority(answerSourceKey, answerSourceGroupKey)
  ) {
    throw new Error(
      'Single answer mode needs an explicit answer, source excerpt, answerSourceKey, answerSourceGroupKey, answer sources JSON, or a shared source response.',
    )
  }
  if (
    inferRemainingAnswers &&
    !formatSupportsInferRemainingAnswers(draft.sourceResponseFormat)
  ) {
    throw new Error(
      'followThrough.inferRemainingAnswers is not supported by the current source-response format.',
    )
  }

  if (
    inferRemainingAnswers &&
    !hasInterpretationInputForSelectedFormat(
      draft.sourceResponseFormat,
      sourceResponse,
      answerSources,
    )
  ) {
    throw new Error(
      'followThrough.inferRemainingAnswers requires a compatible shared source response or structured answer sources.',
    )
  }

  const sourceOccurrence = normalizePositiveInteger(
    draft.sourceOccurrence,
    'Decision answer sourceOccurrence',
  )
  if (sourceOccurrence !== undefined && !sourceExcerpt) {
    throw new Error('Decision answer sourceOccurrence can only be set with sourceExcerpt.')
  }

  return {
    decisionKey: normalizeOptionalString(draft.decisionKey),
    summary,
    summaryKey: normalizeOptionalString(draft.summaryKey),
    prompt: normalizeOptionalString(draft.prompt),
    matchHints: parseListInput(draft.matchHints),
    taskRef: normalizeOptionalString(draft.taskRef),
    answer,
    sourceExcerpt,
    sourceOccurrence,
    answerSourceKey,
    answerSourceGroupKey,
    answerSources,
    sourceResponse,
    sourceResponseFormat,
    followThrough,
  }
}

export function materializeDecisionAnswerBatchInput(
  draft: {
    answerSourcesJson: string
    sourceResponse: string
    sourceResponseFormat: GoalSourceResponseFormat
    inferOpenDecisions: boolean
    inferDecisionTopics: boolean
    answersJson: string
  },
  followThrough: GoalDecisionFollowThroughInput | undefined,
  decisions: GoalDecision[] = [],
) {
  const sourceResponse = normalizeOptionalString(draft.sourceResponse)
  const answers = draft.answersJson.trim() ? parseDecisionAnswerEntriesJson(draft.answersJson) : []
  const answerSources = draft.answerSourcesJson.trim()
    ? parseAnswerSourcesJson(draft.answerSourcesJson, 'Decision answer sources')
    : undefined
  const sourceResponseFormat = resolveSelectedInterpretationFormat(
    draft.sourceResponseFormat,
    sourceResponse,
    answerSources,
  )
  const inferRemainingAnswers = followThroughInfersRemainingAnswers(followThrough)
  if (!sourceResponse && answers.length === 0 && (!answerSources || answerSources.length === 0)) {
    throw new Error(
      'Shared reply mode needs answers JSON, answer sources JSON, or a shared source response to interpret.',
    )
  }
  if (
    (draft.inferOpenDecisions || draft.inferDecisionTopics || inferRemainingAnswers) &&
    !hasInterpretationInputForSelectedFormat(
      draft.sourceResponseFormat,
      sourceResponse,
      answerSources,
    )
  ) {
    throw new Error(
      'Shared reply inference requires a compatible shared source response or structured answer sources.',
    )
  }
  if (
    inferRemainingAnswers &&
    !formatSupportsInferRemainingAnswers(draft.sourceResponseFormat)
  ) {
    throw new Error(
      'Infer remaining planner answers is not supported by the current source-response format.',
    )
  }
  if (draft.inferOpenDecisions && !formatSupportsInferOpenDecisions(draft.sourceResponseFormat)) {
    throw new Error('Infer open decisions is not supported by the current source-response format.')
  }
  if (draft.inferDecisionTopics && !formatSupportsInferDecisionTopics(draft.sourceResponseFormat)) {
    throw new Error(
      'Infer decision topics is not supported by the current source-response format.',
    )
  }
  const mixedInferenceIssues = listMixedDecisionTopicAndRemainingAnswerIssues(
    draft.sourceResponseFormat,
    answerSources,
    draft.inferDecisionTopics,
    inferRemainingAnswers,
  )
  if (mixedInferenceIssues.length > 0) {
    throw new Error(
      mixedInferenceIssues[0] ??
        'Infer decision topics plus infer remaining planner answers needs compatible structured answer sources.',
    )
  }
  const inferOpenDecisionIssues = listInferOpenDecisionExplicitAnswerIssues(
    answers,
    draft.inferOpenDecisions,
  )
  if (inferOpenDecisionIssues.length > 0) {
    throw new Error(inferOpenDecisionIssues[0] ?? 'Infer open decisions requires decisionKey.')
  }

  const explicitAnswerSourceReferenceIssues = listExplicitAnswerSourceReferenceExistenceIssues(
    [
      createExplicitAnswerSourceReferenceGroup('Decision answer batch', answers),
      ...buildDecisionFollowThroughAnswerSourceReferenceGroups(followThrough),
    ].filter((group): group is ExplicitAnswerSourceReferenceGroup => group !== null),
    answerSources,
  )
  if (explicitAnswerSourceReferenceIssues.length > 0) {
    throw new Error(
      explicitAnswerSourceReferenceIssues[0] ??
        'Decision answer batch references unknown structured answer sources.',
    )
  }

  const interpretationIssue = findFirstBatchDecisionInterpretationIssue({
    format: draft.sourceResponseFormat,
    sourceResponse: draft.sourceResponse,
    decisionAnswers: answers,
    planningAnswers: buildPlanningAnswerConsumersFromDecisionFollowThrough(followThrough),
    answerSources,
    decisions,
    inferOpenDecisions: draft.inferOpenDecisions,
    inferDecisionTopics: draft.inferDecisionTopics,
    inferRemainingAnswers,
  })
  if (interpretationIssue) {
    throw new Error(interpretationIssue)
  }

  return {
    answers,
    answerSources,
    sourceResponse,
    sourceResponseFormat,
    inferOpenDecisions: draft.inferOpenDecisions,
    inferDecisionTopics: draft.inferDecisionTopics,
    followThrough,
  }
}
