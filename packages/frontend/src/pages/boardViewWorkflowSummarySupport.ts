import { type CapturedAnswer, type GoalPlanningWorkflowLeafState } from '../lib/api'
import {
  collectUniqueCapturedAnswersFromPlanningRequests,
  collectUniquePlanningRequestDecisionRefs,
  summarizePreviewText,
} from './boardViewStructuredEditors'

export function summarizeCapturedAnswer(answer: CapturedAnswer) {
  const metadata = [
    answer.prompt ? `prompt=${answer.prompt}` : null,
    answer.summaryKey ? `summaryKey=${answer.summaryKey}` : null,
    answer.answerKey ? `answerKey=${answer.answerKey}` : null,
    answer.matchHints && answer.matchHints.length > 0
      ? `matchHints=${answer.matchHints.join('|')}`
      : null,
    answer.captureFormat ? `captureFormat=${answer.captureFormat}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return metadata.length > 0
    ? `${answer.summary} [${metadata}]: ${answer.answer}`
    : `${answer.summary}: ${answer.answer}`
}

export function summarizeWorkflowLeafCardTitle(workflowChild: GoalPlanningWorkflowLeafState) {
  if (workflowChild.kind === 'planning') {
    return `Planning child ${workflowChild.workflowTaskKey ?? workflowChild.request.requestKey} -> ${workflowChild.request.title}`
  }

  return `Grouped child ${workflowChild.groupKey}`
}

export function summarizeWorkflowLeafRequestStatus(workflowChild: GoalPlanningWorkflowLeafState) {
  if (workflowChild.kind === 'planning') {
    return `Request status: ${workflowChild.request.status}`
  }

  const openCount = workflowChild.requests.filter((request) => request.status === 'open').length
  const resolvedCount = workflowChild.requests.filter(
    (request) => request.status === 'resolved',
  ).length
  const parts = [
    openCount > 0 ? `${openCount} open` : '',
    resolvedCount > 0 ? `${resolvedCount} resolved` : '',
  ].filter((part) => part.length > 0)

  if (parts.length === 0) {
    return null
  }

  return `Grouped request status: ${parts.join(' · ')}`
}

export function summarizeWorkflowLeafCardTail(workflowChild: GoalPlanningWorkflowLeafState) {
  return workflowChild.blockerTaskRefs.length > 0
    ? workflowChild.blockerTaskRefs.join(', ')
    : 'none'
}

export function summarizeWorkflowLeafDecisionRefs(workflowChild: GoalPlanningWorkflowLeafState) {
  const decisionRefs =
    workflowChild.kind === 'planning'
      ? workflowChild.request.decisionRefs
      : collectUniquePlanningRequestDecisionRefs(workflowChild.requests)

  if (decisionRefs.length === 0) {
    return null
  }

  return summarizePreviewText(decisionRefs.join(', '), 180)
}

export function summarizeWorkflowLeafCapturedAnswers(workflowChild: GoalPlanningWorkflowLeafState) {
  const answers =
    workflowChild.kind === 'planning'
      ? workflowChild.request.answers
      : collectUniqueCapturedAnswersFromPlanningRequests(workflowChild.requests)

  if (answers.length === 0) {
    return null
  }

  return summarizePreviewText(answers.map(summarizeCapturedAnswer).join(' | '), 220)
}

export function summarizeWorkflowLeafGroupedRequests(workflowChild: GoalPlanningWorkflowLeafState) {
  if (workflowChild.kind !== 'planning_batch' || workflowChild.requests.length === 0) {
    return null
  }

  return workflowChild.requests
    .map(
      (request) =>
        `${request.groupTaskKey ?? request.requestKey} [${request.status}]: ${request.title}`,
    )
    .join(' | ')
}
