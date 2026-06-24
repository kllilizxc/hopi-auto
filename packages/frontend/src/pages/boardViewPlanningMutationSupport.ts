import type {
  GoalAnswerSourceInput,
  GoalPlanningWorkflowCreateInput,
  GoalSourceResponseFormat,
} from '../lib/api'
import {
  type FrontendPlanningLabeledSectionConsumer,
  listLabeledSectionExplicitConsumerMatchIssues,
  listLabeledSectionStructureIssues,
  listLabeledSectionUnconsumedIssues,
} from './boardViewLabeledSectionSupport'
import {
  listAutoInlineTopicMixedAuthorityIssues,
  listInlineTopicExplicitConsumerMatchIssues,
  listInlineTopicStandaloneAuthorityIssues,
  listInlineTopicStructureIssues,
  listInlineTopicUnconsumedIssues,
} from './boardViewInlineTopicSupport'
import {
  normalizeOptionalString,
  parseAnswerSourcesJson,
  parseBlockerRefsJson,
  parseInterpretablePlanningAnswersJson,
  parseWorkflowChildrenJson,
} from './boardViewJsonInputSupport'
import {
  hasInterpretationInputForSelectedFormat,
  listExplicitAnswerSourceReferenceExistenceIssues,
  listLabeledSectionStandaloneAuthorityIssues,
  resolveSelectedInterpretationFormat,
} from './boardViewInterpretationSupport'
import {
  listOrderedSourceResponseStructureIssues,
  listOrderedSourceResponseUnconsumedIssues,
  listQuestionBlockStructureIssues,
  listQuestionBlockUnconsumedIssues,
} from './boardViewOrderedQuestionBlockSupport'
import {
  listPlanningRemainingAnswerSourceAuthorityIssues,
  listPlanningRemainingAnswerSourceContiguityIssues,
  listPlanningRemainingAnswerSourceMergeConflictIssues,
} from './boardViewRemainingAnswerSourceSupport'
import {
  buildPlanningAnswerEditorItemsFromWorkflowDraft,
  createExplicitAnswerSourceReferenceGroup,
  type ExplicitAnswerSourceReferenceGroup,
} from './boardViewSourceResponseSupport'
import { parseListInput } from './boardViewStructuredEditorCodec'
import {
  buildWorkflowAnswerSourceReferenceGroups,
  materializeSimpleWorkflowChild,
} from './boardViewWorkflowMutationSupport'

type PlanningSharedInterpretationValidationInput = {
  contextLabel: 'Planning' | 'Workflow'
  remainingAnswerSourceLabel: 'planner' | 'workflow'
  format: GoalSourceResponseFormat
  sourceResponse: string
  planningAnswers: FrontendPlanningLabeledSectionConsumer[]
  answerSources?: GoalAnswerSourceInput[]
  inferRemainingAnswers: boolean
}

function findFirstPlanningSharedInterpretationIssue(
  input: PlanningSharedInterpretationValidationInput,
) {
  const {
    contextLabel,
    remainingAnswerSourceLabel,
    format,
    sourceResponse,
    planningAnswers,
    answerSources,
    inferRemainingAnswers,
  } = input

  const labeledSectionStructureIssues = listLabeledSectionStructureIssues({
    format,
    sourceResponse,
  })
  if (labeledSectionStructureIssues.length > 0) {
    return (
      labeledSectionStructureIssues[0] ??
      `${contextLabel} source response has invalid labeled-section structure.`
    )
  }

  const labeledSectionExplicitMatchIssues = listLabeledSectionExplicitConsumerMatchIssues({
    format,
    sourceResponse,
    planningAnswers,
  })
  if (labeledSectionExplicitMatchIssues.length > 0) {
    return (
      labeledSectionExplicitMatchIssues[0] ??
      `${contextLabel} source response did not match explicit labeled-section consumers.`
    )
  }

  const inlineTopicStructureIssues = listInlineTopicStructureIssues({
    format,
    sourceResponse,
  })
  if (inlineTopicStructureIssues.length > 0) {
    return (
      inlineTopicStructureIssues[0] ??
      `${contextLabel} source response has invalid inline-topic structure.`
    )
  }

  const inlineTopicExplicitMatchIssues = listInlineTopicExplicitConsumerMatchIssues({
    format,
    sourceResponse,
    planningAnswers,
  })
  if (inlineTopicExplicitMatchIssues.length > 0) {
    return (
      inlineTopicExplicitMatchIssues[0] ??
      `${contextLabel} source response did not match explicit inline-topic consumers.`
    )
  }

  const inlineTopicUnconsumedIssues = listInlineTopicUnconsumedIssues({
    format,
    sourceResponse,
    explicitConsumerCount: planningAnswers.length,
    inferRemainingAnswers,
  })
  if (inlineTopicUnconsumedIssues.length > 0) {
    return (
      inlineTopicUnconsumedIssues[0] ??
      `${contextLabel} source response left unconsumed inline topic clauses.`
    )
  }

  const inlineTopicStandaloneAuthorityIssues = listInlineTopicStandaloneAuthorityIssues({
    format,
    sourceResponse,
    planningAnswers,
    inferRemainingAnswers,
  })
  if (inlineTopicStandaloneAuthorityIssues.length > 0) {
    return (
      inlineTopicStandaloneAuthorityIssues[0] ??
      `${contextLabel} source response left standalone authority outside inline topic clauses.`
    )
  }

  const autoInlineTopicMixedAuthorityIssues = listAutoInlineTopicMixedAuthorityIssues({
    format,
    sourceResponse,
  })
  if (autoInlineTopicMixedAuthorityIssues.length > 0) {
    return (
      autoInlineTopicMixedAuthorityIssues[0] ??
      `${contextLabel} source response mixed separator-style and verbal inline topic authority under auto format.`
    )
  }

  const labeledSectionUnconsumedIssues = listLabeledSectionUnconsumedIssues({
    format,
    sourceResponse,
    explicitConsumerCount: planningAnswers.length,
    inferRemainingAnswers,
  })
  if (labeledSectionUnconsumedIssues.length > 0) {
    return (
      labeledSectionUnconsumedIssues[0] ??
      `${contextLabel} source response left unconsumed labeled sections.`
    )
  }

  const labeledSectionStandaloneAuthorityIssues = listLabeledSectionStandaloneAuthorityIssues({
    format,
    sourceResponse,
  })
  if (labeledSectionStandaloneAuthorityIssues.length > 0) {
    return (
      labeledSectionStandaloneAuthorityIssues[0] ??
      `${contextLabel} source response left standalone authority outside labeled sections.`
    )
  }

  const orderedStructureIssues = listOrderedSourceResponseStructureIssues({
    format,
    sourceResponse,
  })
  if (orderedStructureIssues.length > 0) {
    return (
      orderedStructureIssues[0] ?? `${contextLabel} source response has invalid ordered structure.`
    )
  }

  const orderedUnconsumedIssues = listOrderedSourceResponseUnconsumedIssues({
    format,
    sourceResponse,
    explicitPlanningAnswerCount: planningAnswers.length,
  })
  if (orderedUnconsumedIssues.length > 0) {
    return (
      orderedUnconsumedIssues[0] ?? `${contextLabel} source response left unconsumed ordered units.`
    )
  }

  const questionBlockStructureIssues = listQuestionBlockStructureIssues({
    format,
    sourceResponse,
  })
  if (questionBlockStructureIssues.length > 0) {
    return (
      questionBlockStructureIssues[0] ??
      `${contextLabel} source response has invalid question-block structure.`
    )
  }

  const questionBlockUnconsumedIssues = listQuestionBlockUnconsumedIssues({
    format,
    sourceResponse,
    explicitPlanningAnswerCount: planningAnswers.length,
    inferRemainingAnswers,
  })
  if (questionBlockUnconsumedIssues.length > 0) {
    return (
      questionBlockUnconsumedIssues[0] ??
      `${contextLabel} source response left unconsumed question blocks.`
    )
  }

  if (
    inferRemainingAnswers &&
    !hasInterpretationInputForSelectedFormat(
      format,
      normalizeOptionalString(sourceResponse),
      answerSources,
    )
  ) {
    return 'inferRemainingAnswers requires a compatible shared source response or structured answer sources.'
  }

  const remainingAnswerSourceAuthorityIssues = listPlanningRemainingAnswerSourceAuthorityIssues({
    format,
    sourceResponse,
    answerSources,
    inferRemainingAnswers,
    explicitPlanningAnswerCount: planningAnswers.length,
  })
  if (remainingAnswerSourceAuthorityIssues.length > 0) {
    return (
      remainingAnswerSourceAuthorityIssues[0] ??
      `Remaining ${remainingAnswerSourceLabel} answer sources need visible summary authority.`
    )
  }

  const remainingAnswerSourceContiguityIssues = listPlanningRemainingAnswerSourceContiguityIssues({
    format,
    sourceResponse,
    answerSources,
    inferRemainingAnswers,
    explicitPlanningAnswerCount: planningAnswers.length,
  })
  if (remainingAnswerSourceContiguityIssues.length > 0) {
    return (
      remainingAnswerSourceContiguityIssues[0] ??
      `Remaining ${remainingAnswerSourceLabel} answer sources must stay contiguous by stable descriptor.`
    )
  }

  const remainingAnswerSourceMergeConflictIssues =
    listPlanningRemainingAnswerSourceMergeConflictIssues({
      format,
      sourceResponse,
      answerSources,
      inferRemainingAnswers,
      explicitPlanningAnswerCount: planningAnswers.length,
    })
  if (remainingAnswerSourceMergeConflictIssues.length > 0) {
    return (
      remainingAnswerSourceMergeConflictIssues[0] ??
      `Remaining ${remainingAnswerSourceLabel} answer sources have conflicting merge metadata.`
    )
  }

  return null
}

export function materializePlanningRequestInput(draft: {
  requestKey: string
  groupKey: string
  groupTaskKey: string
  title: string
  description: string
  acceptanceCriteria: string
  decisionRefs: string
  answersJson: string
  answerSourcesJson: string
  sourceResponse: string
  sourceResponseFormat: GoalSourceResponseFormat
  inferRemainingAnswers: boolean
  requestedUpdates: string
  blockedByJson: string
}) {
  const answers = draft.answersJson.trim()
    ? parseInterpretablePlanningAnswersJson(draft.answersJson, 'Planning answers')
    : undefined
  const answerSources = draft.answerSourcesJson.trim()
    ? parseAnswerSourcesJson(draft.answerSourcesJson, 'Planning answer sources')
    : undefined
  const sourceResponse = normalizeOptionalString(draft.sourceResponse)
  const sourceResponseFormat = resolveSelectedInterpretationFormat(
    draft.sourceResponseFormat,
    sourceResponse,
    answerSources,
  )
  const answerSourceReferenceIssues = listExplicitAnswerSourceReferenceExistenceIssues(
    [createExplicitAnswerSourceReferenceGroup('Planning answers', answers)].filter(
      (group): group is ExplicitAnswerSourceReferenceGroup => group !== null,
    ),
    answerSources,
  )
  if (answerSourceReferenceIssues.length > 0) {
    throw new Error(
      answerSourceReferenceIssues[0] ??
        'Planning answers reference unknown structured answer sources.',
    )
  }

  const interpretationIssue = findFirstPlanningSharedInterpretationIssue({
    contextLabel: 'Planning',
    remainingAnswerSourceLabel: 'planner',
    format: draft.sourceResponseFormat,
    sourceResponse: draft.sourceResponse,
    planningAnswers: answers ?? [],
    answerSources,
    inferRemainingAnswers: draft.inferRemainingAnswers,
  })
  if (interpretationIssue) {
    throw new Error(interpretationIssue)
  }

  return {
    requestKey: draft.requestKey.trim() || undefined,
    groupKey: draft.groupKey.trim() || undefined,
    groupTaskKey: draft.groupTaskKey.trim() || undefined,
    title: draft.title.trim(),
    description: draft.description.trim(),
    acceptanceCriteria: parseListInput(draft.acceptanceCriteria),
    decisionRefs: parseListInput(draft.decisionRefs),
    answers,
    answerSources,
    sourceResponse,
    sourceResponseFormat,
    inferRemainingAnswers: draft.inferRemainingAnswers,
    requestedUpdates: parseListInput(draft.requestedUpdates),
    blockedBy: draft.blockedByJson.trim()
      ? parseBlockerRefsJson(draft.blockedByJson, 'Planning request blockers')
      : undefined,
  }
}

export function materializeWorkflowMutationInput(draft: {
  workflowKey: string
  reuseTaskRef: string
  reuseGroupKey: string
  sharedDecisionRefs: string
  sharedAnswersJson: string
  answerSourcesJson: string
  sourceResponse: string
  sourceResponseFormat: GoalSourceResponseFormat
  inferRemainingAnswers: boolean
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
  childrenJson: string
}): GoalPlanningWorkflowCreateInput {
  const workflows = draft.childrenJson.trim()
    ? parseWorkflowChildrenJson(draft.childrenJson)
    : [materializeSimpleWorkflowChild(draft)]
  const sharedAnswers = draft.sharedAnswersJson.trim()
    ? parseInterpretablePlanningAnswersJson(draft.sharedAnswersJson, 'Workflow shared answers')
    : undefined
  const answerSources = draft.answerSourcesJson.trim()
    ? parseAnswerSourcesJson(draft.answerSourcesJson, 'Workflow answer sources')
    : undefined
  const sourceResponse = normalizeOptionalString(draft.sourceResponse)
  const sourceResponseFormat = resolveSelectedInterpretationFormat(
    draft.sourceResponseFormat,
    sourceResponse,
    answerSources,
  )
  const workflow: GoalPlanningWorkflowCreateInput = {
    workflowKey: draft.workflowKey.trim() || undefined,
    reuseTaskRef: draft.reuseTaskRef.trim() || undefined,
    reuseGroupKey: draft.reuseGroupKey.trim() || undefined,
    decisionRefs: parseListInput(draft.sharedDecisionRefs),
    answers: sharedAnswers,
    answerSources,
    sourceResponse,
    sourceResponseFormat,
    inferRemainingAnswers: draft.inferRemainingAnswers,
    workflows,
  }
  const answerSourceReferenceIssues = listExplicitAnswerSourceReferenceExistenceIssues(
    buildWorkflowAnswerSourceReferenceGroups(workflow),
    answerSources,
  )
  if (answerSourceReferenceIssues.length > 0) {
    throw new Error(
      answerSourceReferenceIssues[0] ??
        'Workflow answers reference unknown structured answer sources.',
    )
  }

  const interpretationIssue = findFirstPlanningSharedInterpretationIssue({
    contextLabel: 'Workflow',
    remainingAnswerSourceLabel: 'workflow',
    format: draft.sourceResponseFormat,
    sourceResponse: draft.sourceResponse,
    planningAnswers: buildPlanningAnswerEditorItemsFromWorkflowDraft(draft),
    answerSources,
    inferRemainingAnswers: draft.inferRemainingAnswers,
  })
  if (interpretationIssue) {
    throw new Error(interpretationIssue)
  }

  return workflow
}
