import type {
  GoalAnswerSourceInput,
  GoalDecision,
  GoalDecisionFollowThroughInput,
  GoalSourceResponseFormat,
} from '../lib/api'
import {
  type FrontendDecisionLabeledSectionConsumer,
  type FrontendPlanningLabeledSectionConsumer,
  listLabeledSectionDecisionTopicIssues,
  listLabeledSectionExplicitConsumerMatchIssues,
  listLabeledSectionOpenDecisionIssues,
  listLabeledSectionStructureIssues,
  listLabeledSectionUnconsumedIssues,
} from './boardViewLabeledSectionSupport'
import {
  listAutoInlineTopicMixedAuthorityIssues,
  listInlineTopicDecisionTopicIssues,
  listInlineTopicExplicitConsumerMatchIssues,
  listInlineTopicOpenDecisionIssues,
  listInlineTopicStandaloneAuthorityIssues,
  listInlineTopicStructureIssues,
  listInlineTopicUnconsumedIssues,
} from './boardViewInlineTopicSupport'
import { listLabeledSectionStandaloneAuthorityIssues } from './boardViewInterpretationSupport'
import {
  listOrderedSourceResponseStructureIssues,
  listOrderedSourceResponseUnconsumedIssues,
  listQuestionBlockStructureIssues,
  listQuestionBlockUnconsumedIssues,
} from './boardViewOrderedQuestionBlockSupport'
import {
  listDecisionTopicRemainingKnownDecisionAmbiguityIssues,
  listDecisionTopicRemainingAnswerSourceAuthorityIssues,
  listDecisionTopicRemainingAnswerSourceContiguityIssues,
  listDecisionTopicRemainingAnswerSourceMergeConflictIssues,
} from './boardViewRemainingAnswerSourceSupport'

type DecisionSharedInterpretationValidationInput = {
  contextLabel: string
  format: GoalSourceResponseFormat
  sourceResponse: string
  decisionAnswers: FrontendDecisionLabeledSectionConsumer[]
  planningAnswers: FrontendPlanningLabeledSectionConsumer[]
  inferRemainingAnswers: boolean
  explicitDecisionKeys: string[]
}

type BatchDecisionSharedInterpretationValidationInput = {
  format: GoalSourceResponseFormat
  sourceResponse: string
  decisionAnswers: FrontendDecisionLabeledSectionConsumer[]
  planningAnswers: FrontendPlanningLabeledSectionConsumer[]
  answerSources: GoalAnswerSourceInput[] | undefined
  decisions: GoalDecision[]
  inferOpenDecisions: boolean
  inferDecisionTopics: boolean
  inferRemainingAnswers: boolean
}

export function followThroughInfersRemainingAnswers(
  followThrough: GoalDecisionFollowThroughInput | undefined,
) {
  return Boolean(
    followThrough &&
      'inferRemainingAnswers' in followThrough &&
      followThrough.inferRemainingAnswers,
  )
}

export function findFirstExplicitDecisionInterpretationIssue(
  input: DecisionSharedInterpretationValidationInput,
) {
  const {
    contextLabel,
    format,
    sourceResponse,
    decisionAnswers,
    planningAnswers,
    inferRemainingAnswers,
    explicitDecisionKeys,
  } = input
  const explicitConsumerCount = decisionAnswers.length + planningAnswers.length

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
    decisionAnswers,
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
    decisionAnswers,
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
    explicitConsumerCount,
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
    decisionAnswers,
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
    explicitConsumerCount,
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
    explicitDecisionAnswerCount: decisionAnswers.length,
    explicitPlanningAnswerCount: planningAnswers.length,
    explicitDecisionKeys,
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
    explicitDecisionAnswerCount: decisionAnswers.length,
    explicitPlanningAnswerCount: planningAnswers.length,
    explicitDecisionKeys,
    inferRemainingAnswers,
  })
  if (questionBlockUnconsumedIssues.length > 0) {
    return (
      questionBlockUnconsumedIssues[0] ??
      `${contextLabel} source response left unconsumed question blocks.`
    )
  }

  return null
}

export function findFirstBatchDecisionInterpretationIssue(
  input: BatchDecisionSharedInterpretationValidationInput,
) {
  const {
    format,
    sourceResponse,
    decisionAnswers,
    planningAnswers,
    answerSources,
    decisions,
    inferOpenDecisions,
    inferDecisionTopics,
    inferRemainingAnswers,
  } = input
  const explicitConsumerCount = decisionAnswers.length + planningAnswers.length
  const explicitDecisionKeys = decisionAnswers
    .map((answer) => answer.decisionKey?.trim())
    .filter((value): value is string => Boolean(value))
  const openDecisionKeys = decisions
    .filter((decision) => decision.status === 'open')
    .map((decision) => decision.decisionKey)
  const explicitDecisionAnswers = !inferOpenDecisions && !inferDecisionTopics ? decisionAnswers : []
  const explicitPlanningAnswers = !inferOpenDecisions && !inferDecisionTopics ? planningAnswers : []

  const labeledSectionStructureIssues = listLabeledSectionStructureIssues({
    format,
    sourceResponse,
  })
  if (labeledSectionStructureIssues.length > 0) {
    return (
      labeledSectionStructureIssues[0] ??
      'Labeled sections are structurally invalid for shared decision-answer interpretation.'
    )
  }

  const labeledSectionExplicitMatchIssues = listLabeledSectionExplicitConsumerMatchIssues({
    format,
    sourceResponse,
    decisionAnswers: explicitDecisionAnswers,
    planningAnswers: explicitPlanningAnswers,
  })
  if (labeledSectionExplicitMatchIssues.length > 0) {
    return (
      labeledSectionExplicitMatchIssues[0] ??
      'Labeled sections did not match explicit shared decision-answer consumers.'
    )
  }

  const inlineTopicStructureIssues = listInlineTopicStructureIssues({
    format,
    sourceResponse,
  })
  if (inlineTopicStructureIssues.length > 0) {
    return (
      inlineTopicStructureIssues[0] ??
      'Inline topics are structurally invalid for shared decision-answer interpretation.'
    )
  }

  const inlineTopicExplicitMatchIssues = listInlineTopicExplicitConsumerMatchIssues({
    format,
    sourceResponse,
    decisionAnswers: explicitDecisionAnswers,
    planningAnswers: explicitPlanningAnswers,
  })
  if (inlineTopicExplicitMatchIssues.length > 0) {
    return (
      inlineTopicExplicitMatchIssues[0] ??
      'Inline topics did not match explicit shared decision-answer consumers.'
    )
  }

  const inlineTopicUnconsumedIssues = listInlineTopicUnconsumedIssues({
    format,
    sourceResponse,
    explicitConsumerCount,
    inferOpenDecisions,
    inferDecisionTopics,
    inferRemainingAnswers,
  })
  if (inlineTopicUnconsumedIssues.length > 0) {
    return (
      inlineTopicUnconsumedIssues[0] ??
      'Inline topics left unconsumed shared decision-answer clauses.'
    )
  }

  const inlineTopicStandaloneAuthorityIssues = listInlineTopicStandaloneAuthorityIssues({
    format,
    sourceResponse,
    decisionAnswers: explicitDecisionAnswers,
    planningAnswers: explicitPlanningAnswers,
    decisions,
    inferDecisionTopics,
    inferOpenDecisions,
    inferRemainingAnswers,
  })
  if (inlineTopicStandaloneAuthorityIssues.length > 0) {
    return (
      inlineTopicStandaloneAuthorityIssues[0] ??
      'Inline topics left standalone authority outside shared decision-answer clauses.'
    )
  }

  const autoInlineTopicMixedAuthorityIssues = listAutoInlineTopicMixedAuthorityIssues({
    format,
    sourceResponse,
  })
  if (autoInlineTopicMixedAuthorityIssues.length > 0) {
    return (
      autoInlineTopicMixedAuthorityIssues[0] ??
      'Shared decision-answer source response mixed separator-style and verbal inline topic authority under auto format.'
    )
  }

  const inlineTopicDecisionTopicIssues = listInlineTopicDecisionTopicIssues({
    format,
    sourceResponse,
    decisions,
    inferDecisionTopics,
    inferOpenDecisions,
    inferRemainingAnswers,
    explicitDecisionAnswerCount: decisionAnswers.length,
    explicitPlanningAnswerCount: planningAnswers.length,
  })
  if (inlineTopicDecisionTopicIssues.length > 0) {
    return (
      inlineTopicDecisionTopicIssues[0] ??
      'Inline topics cannot be deterministically mapped onto current decision topics.'
    )
  }

  const inlineTopicOpenDecisionIssues = listInlineTopicOpenDecisionIssues({
    format,
    sourceResponse,
    decisions,
    inferOpenDecisions,
    explicitDecisionAnswerCount: decisionAnswers.length,
  })
  if (inlineTopicOpenDecisionIssues.length > 0) {
    return (
      inlineTopicOpenDecisionIssues[0] ??
      'Inline topics cannot be deterministically matched onto current open decisions.'
    )
  }

  const labeledSectionUnconsumedIssues = listLabeledSectionUnconsumedIssues({
    format,
    sourceResponse,
    explicitConsumerCount,
    inferOpenDecisions,
    inferDecisionTopics,
    inferRemainingAnswers,
  })
  if (labeledSectionUnconsumedIssues.length > 0) {
    return (
      labeledSectionUnconsumedIssues[0] ??
      'Labeled sections left unconsumed shared decision-answer sections.'
    )
  }

  const labeledSectionStandaloneAuthorityIssues = listLabeledSectionStandaloneAuthorityIssues({
    format,
    sourceResponse,
  })
  if (labeledSectionStandaloneAuthorityIssues.length > 0) {
    return (
      labeledSectionStandaloneAuthorityIssues[0] ??
      'Labeled sections left standalone authority outside shared decision-answer sections.'
    )
  }

  const orderedStructureIssues = listOrderedSourceResponseStructureIssues({
    format,
    sourceResponse,
  })
  if (orderedStructureIssues.length > 0) {
    return (
      orderedStructureIssues[0] ??
      'Shared decision-answer source response has invalid ordered structure.'
    )
  }

  const orderedUnconsumedIssues = listOrderedSourceResponseUnconsumedIssues({
    format,
    sourceResponse,
    explicitDecisionAnswerCount: decisionAnswers.length,
    explicitPlanningAnswerCount: planningAnswers.length,
    explicitDecisionKeys,
    inferOpenDecisions,
    openDecisionKeys,
  })
  if (orderedUnconsumedIssues.length > 0) {
    return (
      orderedUnconsumedIssues[0] ??
      'Shared decision-answer source response left unconsumed ordered units.'
    )
  }

  const questionBlockStructureIssues = listQuestionBlockStructureIssues({
    format,
    sourceResponse,
  })
  if (questionBlockStructureIssues.length > 0) {
    return (
      questionBlockStructureIssues[0] ??
      'Shared decision-answer source response has invalid question-block structure.'
    )
  }

  const questionBlockUnconsumedIssues = listQuestionBlockUnconsumedIssues({
    format,
    sourceResponse,
    explicitDecisionAnswerCount: decisionAnswers.length,
    explicitPlanningAnswerCount: planningAnswers.length,
    explicitDecisionKeys,
    inferOpenDecisions,
    inferDecisionTopics,
    inferRemainingAnswers,
    openDecisionKeys,
  })
  if (questionBlockUnconsumedIssues.length > 0) {
    return (
      questionBlockUnconsumedIssues[0] ??
      'Shared decision-answer source response left unconsumed question blocks.'
    )
  }

  const remainingAnswerSourceAuthorityIssues =
    listDecisionTopicRemainingAnswerSourceAuthorityIssues({
      format,
      sourceResponse,
      answerSources,
      inferDecisionTopics,
      inferOpenDecisions,
      inferRemainingAnswers,
      explicitDecisionAnswerCount: decisionAnswers.length,
      explicitPlanningAnswerCount: planningAnswers.length,
    })
  if (remainingAnswerSourceAuthorityIssues.length > 0) {
    return (
      remainingAnswerSourceAuthorityIssues[0] ??
      'Remaining answer sources need visible summary authority.'
    )
  }

  const remainingAnswerSourceContiguityIssues =
    listDecisionTopicRemainingAnswerSourceContiguityIssues({
      format,
      sourceResponse,
      answerSources,
      inferDecisionTopics,
      inferOpenDecisions,
      inferRemainingAnswers,
      explicitDecisionAnswerCount: decisionAnswers.length,
      explicitPlanningAnswerCount: planningAnswers.length,
    })
  if (remainingAnswerSourceContiguityIssues.length > 0) {
    return (
      remainingAnswerSourceContiguityIssues[0] ??
      'Remaining answer sources must stay contiguous by stable descriptor.'
    )
  }

  const remainingAnswerSourceMergeConflictIssues =
    listDecisionTopicRemainingAnswerSourceMergeConflictIssues({
      format,
      sourceResponse,
      answerSources,
      inferDecisionTopics,
      inferOpenDecisions,
      inferRemainingAnswers,
      explicitDecisionAnswerCount: decisionAnswers.length,
      explicitPlanningAnswerCount: planningAnswers.length,
    })
  if (remainingAnswerSourceMergeConflictIssues.length > 0) {
    return (
      remainingAnswerSourceMergeConflictIssues[0] ??
      'Remaining answer sources have conflicting merge metadata.'
    )
  }

  const remainingKnownDecisionAmbiguityIssues =
    listDecisionTopicRemainingKnownDecisionAmbiguityIssues({
      format,
      sourceResponse,
      answerSources,
      decisions,
      inferDecisionTopics,
      inferOpenDecisions,
      inferRemainingAnswers,
      explicitDecisionAnswerCount: decisionAnswers.length,
      explicitPlanningAnswerCount: planningAnswers.length,
    })
  if (remainingKnownDecisionAmbiguityIssues.length > 0) {
    return (
      remainingKnownDecisionAmbiguityIssues[0] ??
      'Remaining answer sources match multiple existing decisions.'
    )
  }

  const labeledSectionDecisionTopicIssues = listLabeledSectionDecisionTopicIssues({
    format,
    sourceResponse,
    decisions,
    inferDecisionTopics,
    inferOpenDecisions,
    inferRemainingAnswers,
    explicitDecisionAnswerCount: decisionAnswers.length,
    explicitPlanningAnswerCount: planningAnswers.length,
  })
  if (labeledSectionDecisionTopicIssues.length > 0) {
    return (
      labeledSectionDecisionTopicIssues[0] ??
      'Labeled sections cannot be deterministically mapped onto current decision topics.'
    )
  }

  const labeledSectionOpenDecisionIssues = listLabeledSectionOpenDecisionIssues({
    format,
    sourceResponse,
    decisions,
    inferOpenDecisions,
    explicitDecisionAnswerCount: decisionAnswers.length,
  })
  if (labeledSectionOpenDecisionIssues.length > 0) {
    return (
      labeledSectionOpenDecisionIssues[0] ??
      'Labeled sections cannot be deterministically matched onto current open decisions.'
    )
  }

  return null
}
