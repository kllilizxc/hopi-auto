import type { GoalAssistantAction } from './assistantRun'

type AssistantActionWithReusableAnswerSources = Extract<
  GoalAssistantAction,
  | { kind: 'request_planning' }
  | { kind: 'request_planning_batch' }
  | { kind: 'request_planning_workflows' }
  | { kind: 'record_answer' }
  | { kind: 'record_answers' }
  | { kind: 'resolve_decision' }
  | { kind: 'resolve_decisions' }
>

type AssistantActionReusableAnswerSource =
  AssistantActionWithReusableAnswerSources['answerSources'][number]

type AssistantActionBlocker = Extract<
  GoalAssistantAction,
  { kind: 'create_planning_task' }
>['blockedBy'][number]

interface AssistantGroupedPlanningRequestLike {
  taskKey: string
  title: string
  description: string
  acceptanceCriteria: string[]
  requestedUpdates?: string[]
  blockedBy?: AssistantActionBlocker[]
  blockedByTaskKeys?: string[]
}

interface AssistantActionDecisionAnswerLike {
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints: string[]
  decisionKey?: string
  taskRef?: string
  answer?: string
  sourceExcerpt?: string
  sourceOccurrence?: number
  answerSourceKey?: string
  answerSourceGroupKey?: string
}

export function summarizeAssistantActionPlanningAnswer(
  answer: Extract<
    GoalAssistantAction,
    { kind: 'request_planning' | 'request_planning_batch' | 'request_planning_workflows' }
  >['answers'][number],
) {
  const details = [answer.summary]
  if (answer.prompt) {
    details.push(`[prompt=${answer.prompt}]`)
  }
  if (answer.summaryKey) {
    details.push(`[summaryKey=${answer.summaryKey}]`)
  }
  if (answer.answerKey) {
    details.push(`[answerKey=${answer.answerKey}]`)
  }
  if (answer.matchHints.length > 0) {
    details.push(`[matchHints=${answer.matchHints.join(', ')}]`)
  }
  if (answer.answerSourceGroupKey) {
    details.push(`[answerSourceGroupKey=${answer.answerSourceGroupKey}]`)
  }
  if (answer.answerSourceKey) {
    details.push(`[answerSourceKey=${answer.answerSourceKey}]`)
  }
  if (answer.sourceExcerpt) {
    details.push(`[sourceExcerpt=${answer.sourceExcerpt}]`)
  }
  if (typeof answer.sourceOccurrence === 'number') {
    details.push(`[sourceOccurrence=${answer.sourceOccurrence}]`)
  }
  return answer.answer ? `${details.join(' ')}: ${answer.answer}` : details.join(' ')
}

export function summarizeAssistantActionBlockers(blockers: AssistantActionBlocker[]) {
  return blockers.map((blocker) => `${blocker.kind}:${blocker.ref}`).join(', ')
}

export function summarizeAcceptanceCriteria(acceptanceCriteria: string[]) {
  return acceptanceCriteria.join(' | ')
}

export function summarizeInlineAssistantText(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

export function formatGroupedPlanningRequestDetailLines(
  prefix: string,
  request: AssistantGroupedPlanningRequestLike,
) {
  const requestedUpdates = request.requestedUpdates ?? []
  const blockedBy = request.blockedBy ?? []
  const blockedByTaskKeys = request.blockedByTaskKeys ?? []
  return [
    `${prefix}: ${request.taskKey} -> updates ${requestedUpdates.join(', ')}`,
    `${prefix} ${request.taskKey} title: ${request.title}`,
    ...(request.description.trim().length > 0
      ? [`${prefix} ${request.taskKey} description: ${request.description}`]
      : []),
    ...(request.acceptanceCriteria.length > 0
      ? [
          `${prefix} ${request.taskKey} acceptance: ${summarizeAcceptanceCriteria(request.acceptanceCriteria)}`,
        ]
      : []),
    ...(blockedBy.length > 0
      ? [`${prefix} ${request.taskKey} blockers: ${summarizeAssistantActionBlockers(blockedBy)}`]
      : []),
    ...(blockedByTaskKeys.length > 0
      ? [`${prefix} ${request.taskKey} depends on: ${blockedByTaskKeys.join(', ')}`]
      : []),
  ]
}

function summarizeAssistantActionReusableAnswerSource(source: AssistantActionReusableAnswerSource) {
  const details = [source.answerSourceKey]
  if (source.sourceGroupKey) {
    details.push(`[sourceGroupKey=${source.sourceGroupKey}]`)
  }
  if (source.route) {
    details.push(`[route=${source.route}]`)
  }
  if (source.decisionKey) {
    details.push(`[decisionKey=${source.decisionKey}]`)
  }
  if (source.answerKey) {
    details.push(`[answerKey=${source.answerKey}]`)
  }
  if (source.summaryKey) {
    details.push(`[summaryKey=${source.summaryKey}]`)
  }
  if (source.summary) {
    details.push(`[summary=${source.summary}]`)
  }
  if (source.prompt) {
    details.push(`[prompt=${source.prompt}]`)
  }
  if (source.matchHints.length > 0) {
    details.push(`[matchHints=${source.matchHints.join(', ')}]`)
  }
  if ('sourceExcerpt' in source) {
    details.push(`[sourceExcerpt=${source.sourceExcerpt}]`)
    if (typeof source.sourceOccurrence === 'number') {
      details.push(`[sourceOccurrence=${source.sourceOccurrence}]`)
    }
  }
  return 'answer' in source ? `${details.join(' ')}: ${source.answer}` : details.join(' ')
}

export function appendAssistantActionReusableAnswerSourceDetails(
  lines: string[],
  answerSources: AssistantActionWithReusableAnswerSources['answerSources'],
) {
  if (answerSources.length === 0) {
    return
  }
  lines.push(`Reusable answer sources: ${answerSources.length}`)
  lines.push(
    `Reusable answer source detail: ${answerSources
      .map((source) => summarizeAssistantActionReusableAnswerSource(source))
      .join(' | ')}`,
  )
}

export function summarizeAssistantActionDecisionAnswer(answer: AssistantActionDecisionAnswerLike) {
  const details = [answer.summary]
  if (answer.decisionKey) {
    details.push(`[decisionKey=${answer.decisionKey}]`)
  }
  if (answer.summaryKey) {
    details.push(`[summaryKey=${answer.summaryKey}]`)
  }
  if (answer.prompt) {
    details.push(`[prompt=${answer.prompt}]`)
  }
  if (answer.matchHints.length > 0) {
    details.push(`[matchHints=${answer.matchHints.join(', ')}]`)
  }
  if (answer.taskRef) {
    details.push(`[taskRef=${answer.taskRef}]`)
  }
  if (answer.answerSourceGroupKey) {
    details.push(`[answerSourceGroupKey=${answer.answerSourceGroupKey}]`)
  }
  if (answer.answerSourceKey) {
    details.push(`[answerSourceKey=${answer.answerSourceKey}]`)
  }
  if (answer.sourceExcerpt) {
    details.push(`[sourceExcerpt=${answer.sourceExcerpt}]`)
  }
  if (typeof answer.sourceOccurrence === 'number') {
    details.push(`[sourceOccurrence=${answer.sourceOccurrence}]`)
  }
  return answer.answer ? `${details.join(' ')}: ${answer.answer}` : details.join(' ')
}

export function hasAssistantActionDirectDecisionAnswerDetail(
  answer: AssistantActionDecisionAnswerLike,
) {
  return Boolean(
    answer.answer ??
      answer.sourceExcerpt ??
      answer.answerSourceKey ??
      answer.answerSourceGroupKey ??
      (typeof answer.sourceOccurrence === 'number' ? String(answer.sourceOccurrence) : undefined),
  )
}

export function appendFollowThroughDetails(
  lines: string[],
  followThrough: Extract<
    GoalAssistantAction,
    { kind: 'record_answer' | 'record_answers' | 'resolve_decision' | 'resolve_decisions' }
  >['followThrough'],
) {
  if (!followThrough) {
    return
  }

  lines.push(`Follow-through kind: ${followThrough.kind}`)
  if (followThrough.kind === 'workflow_batch') {
    if (followThrough.workflowKey) {
      lines.push(`Follow-through workflow key: ${followThrough.workflowKey}`)
    }
    if (followThrough.reuseTaskRef) {
      lines.push(`Follow-through reusable task ref: ${followThrough.reuseTaskRef}`)
    }
    if (followThrough.reuseGroupKey) {
      lines.push(`Follow-through reusable group key: ${followThrough.reuseGroupKey}`)
    }
    for (const workflow of followThrough.workflows) {
      lines.push(...formatFollowThroughWorkflowChildDetails(workflow))
    }
    if (followThrough.answers.length > 0) {
      lines.push(`Follow-through shared planner answers: ${followThrough.answers.length}`)
      lines.push(
        `Follow-through shared planner answer detail: ${followThrough.answers
          .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
          .join(' | ')}`,
      )
    }
    if (followThrough.inferRemainingAnswers) {
      lines.push('Follow-through infers remaining answers: yes')
    }
    return
  }

  if (followThrough.kind === 'planning_batch') {
    lines.push(`Follow-through group key: ${followThrough.groupKey}`)
    for (const request of followThrough.requests) {
      lines.push(...formatFollowThroughGroupedPlanningRequestDetails(request))
    }
    if (followThrough.answers.length > 0) {
      lines.push(`Follow-through shared planner answers: ${followThrough.answers.length}`)
      lines.push(
        `Follow-through shared planner answer detail: ${followThrough.answers
          .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
          .join(' | ')}`,
      )
    }
    if (followThrough.inferRemainingAnswers) {
      lines.push('Follow-through infers remaining answers: yes')
    }
    return
  }

  if (followThrough.answers.length > 0) {
    lines.push(`Follow-through captured planner answers: ${followThrough.answers.length}`)
    lines.push(
      `Follow-through captured planner answer detail: ${followThrough.answers
        .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
        .join(' | ')}`,
    )
  }
  if (followThrough.inferRemainingAnswers) {
    lines.push('Follow-through infers remaining answers: yes')
  }
}

export function formatWorkflowActionChildDetails(workflow: {
  kind: 'planning' | 'planning_batch'
  requestKey?: string
  workflowTaskKey?: string
  blockedByWorkflowKeys?: string[]
  groupKey?: string
  title?: string
  description?: string
  acceptanceCriteria?: string[]
  decisionRefs?: string[]
  answers?: Array<{
    summary: string
    answer?: string
    prompt?: string
    summaryKey?: string
    answerKey?: string
    matchHints?: string[]
    answerSourceKey?: string
    answerSourceGroupKey?: string
    sourceExcerpt?: string
    sourceOccurrence?: number
  }>
  requestedUpdates?: string[]
  blockedBy?: AssistantActionBlocker[]
  requests?: Array<{
    taskKey: string
    requestKey?: string
    title: string
    description: string
    acceptanceCriteria: string[]
    requestedUpdates?: string[]
    blockedBy?: AssistantActionBlocker[]
    blockedByTaskKeys?: string[]
  }>
}) {
  const childKey = summarizeWorkflowActionChild(workflow)
  const blockedByWorkflowKeys = workflow.blockedByWorkflowKeys ?? []
  const decisionRefs = workflow.decisionRefs ?? []
  const answers = workflow.answers ?? []
  const requestedUpdates = workflow.requestedUpdates ?? []
  const blockedBy = workflow.blockedBy ?? []
  const requests = workflow.requests ?? []
  const acceptanceCriteria = workflow.acceptanceCriteria ?? []
  const description = workflow.description ?? ''
  if (workflow.kind === 'planning') {
    return [
      `Workflow child: ${childKey} -> updates ${requestedUpdates.join(', ')}`,
      `Workflow child ${childKey} title: ${workflow.title}`,
      ...(description.trim().length > 0
        ? [`Workflow child ${childKey} description: ${description}`]
        : []),
      ...(acceptanceCriteria.length > 0
        ? [
            `Workflow child ${childKey} acceptance: ${summarizeAcceptanceCriteria(acceptanceCriteria)}`,
          ]
        : []),
      ...(blockedBy.length > 0
        ? [`Workflow child ${childKey} blockers: ${summarizeAssistantActionBlockers(blockedBy)}`]
        : []),
      ...(blockedByWorkflowKeys.length > 0
        ? [`Workflow child ${childKey} depends on: ${blockedByWorkflowKeys.join(', ')}`]
        : []),
      ...(decisionRefs.length > 0
        ? [`Workflow child ${childKey} decisions: ${decisionRefs.join(', ')}`]
        : []),
      ...(answers.length > 0
        ? [
            `Workflow child ${childKey} planner answers: ${answers.length}`,
            `Workflow child ${childKey} planner answer detail: ${answers
              .map((answer) =>
                summarizeAssistantActionPlanningAnswer({
                  ...answer,
                  matchHints: answer.matchHints ?? [],
                }),
              )
              .join(' | ')}`,
          ]
        : []),
    ]
  }

  return [
    `Workflow child: ${childKey} -> requests ${requests.map((request) => request.taskKey).join(', ')}`,
    ...requests.flatMap((request) =>
      formatGroupedPlanningRequestDetailLines(`Workflow child ${childKey} grouped request`, {
        ...request,
        requestedUpdates: request.requestedUpdates ?? [],
        blockedBy: request.blockedBy ?? [],
        blockedByTaskKeys: request.blockedByTaskKeys ?? [],
      }),
    ),
    ...(blockedByWorkflowKeys.length > 0
      ? [`Workflow child ${childKey} depends on: ${blockedByWorkflowKeys.join(', ')}`]
      : []),
    ...(decisionRefs.length > 0
      ? [`Workflow child ${childKey} decisions: ${decisionRefs.join(', ')}`]
      : []),
    ...(answers.length > 0
      ? [
          `Workflow child ${childKey} planner answers: ${answers.length}`,
          `Workflow child ${childKey} planner answer detail: ${answers
            .map((answer) =>
              summarizeAssistantActionPlanningAnswer({
                ...answer,
                matchHints: answer.matchHints ?? [],
              }),
            )
            .join(' | ')}`,
        ]
      : []),
  ]
}

function formatFollowThroughWorkflowChildDetails(workflow: {
  kind: 'planning' | 'planning_batch'
  workflowTaskKey?: string
  blockedByWorkflowKeys?: string[]
  groupKey?: string
  title?: string
  description?: string
  acceptanceCriteria?: string[]
  answers?: Array<{
    summary: string
    answer?: string
    prompt?: string
    summaryKey?: string
    answerKey?: string
    matchHints?: string[]
    answerSourceKey?: string
    answerSourceGroupKey?: string
    sourceExcerpt?: string
    sourceOccurrence?: number
  }>
  requestedUpdates?: string[]
  requests?: Array<{
    taskKey: string
    requestKey?: string
    title: string
    description: string
    acceptanceCriteria: string[]
    requestedUpdates?: string[]
    blockedBy?: AssistantActionBlocker[]
    blockedByTaskKeys?: string[]
  }>
}) {
  const childKey = summarizeWorkflowFollowThroughChild(workflow)
  const blockedByWorkflowKeys = workflow.blockedByWorkflowKeys ?? []
  const answers = workflow.answers ?? []
  const requestedUpdates = workflow.requestedUpdates ?? []
  const requests = workflow.requests ?? []
  const acceptanceCriteria = workflow.acceptanceCriteria ?? []
  const description = workflow.description ?? ''
  if (workflow.kind === 'planning') {
    return [
      `Follow-through workflow child: ${childKey} -> updates ${requestedUpdates.join(', ')}`,
      `Follow-through workflow child ${childKey} title: ${workflow.title}`,
      ...(description.trim().length > 0
        ? [`Follow-through workflow child ${childKey} description: ${description}`]
        : []),
      ...(acceptanceCriteria.length > 0
        ? [
            `Follow-through workflow child ${childKey} acceptance: ${summarizeAcceptanceCriteria(acceptanceCriteria)}`,
          ]
        : []),
      ...(blockedByWorkflowKeys.length > 0
        ? [
            `Follow-through workflow child ${childKey} depends on: ${blockedByWorkflowKeys.join(', ')}`,
          ]
        : []),
      ...(answers.length > 0
        ? [
            `Follow-through workflow child ${childKey} planner answers: ${answers.length}`,
            `Follow-through workflow child ${childKey} planner answer detail: ${answers
              .map((answer) =>
                summarizeAssistantActionPlanningAnswer({
                  ...answer,
                  matchHints: answer.matchHints ?? [],
                }),
              )
              .join(' | ')}`,
          ]
        : []),
    ]
  }

  return [
    `Follow-through workflow child: ${childKey} -> requests ${requests.map((request) => request.taskKey).join(', ')}`,
    ...requests.flatMap((request) =>
      formatGroupedPlanningRequestDetailLines(
        `Follow-through workflow child ${childKey} grouped request`,
        {
          ...request,
          requestedUpdates: request.requestedUpdates ?? [],
          blockedBy: request.blockedBy ?? [],
          blockedByTaskKeys: request.blockedByTaskKeys ?? [],
        },
      ),
    ),
    ...(blockedByWorkflowKeys.length > 0
      ? [
          `Follow-through workflow child ${childKey} depends on: ${blockedByWorkflowKeys.join(', ')}`,
        ]
      : []),
    ...(answers.length > 0
      ? [
          `Follow-through workflow child ${childKey} planner answers: ${answers.length}`,
          `Follow-through workflow child ${childKey} planner answer detail: ${answers
            .map((answer) =>
              summarizeAssistantActionPlanningAnswer({
                ...answer,
                matchHints: answer.matchHints ?? [],
              }),
            )
            .join(' | ')}`,
        ]
      : []),
  ]
}

function summarizeWorkflowActionChild(workflow: {
  kind: 'planning' | 'planning_batch'
  workflowTaskKey?: string
  groupKey?: string
}) {
  if (workflow.kind === 'planning') {
    return workflow.workflowTaskKey ?? 'planning'
  }

  return workflow.groupKey
}

function summarizeWorkflowFollowThroughChild(workflow: {
  kind: 'planning' | 'planning_batch'
  workflowTaskKey?: string
  groupKey?: string
}) {
  if (workflow.kind === 'planning') {
    return workflow.workflowTaskKey ?? 'planning'
  }

  return workflow.groupKey
}

export function formatGroupedPlanningRequestDetails(request: {
  taskKey: string
  requestKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  requestedUpdates?: string[]
  blockedBy?: AssistantActionBlocker[]
  blockedByTaskKeys?: string[]
}) {
  return formatGroupedPlanningRequestDetailLines('Grouped request', {
    ...request,
    requestedUpdates: request.requestedUpdates ?? [],
    blockedBy: request.blockedBy ?? [],
    blockedByTaskKeys: request.blockedByTaskKeys ?? [],
  })
}

function formatFollowThroughGroupedPlanningRequestDetails(
  request: Extract<
    NonNullable<
      Extract<
        GoalAssistantAction,
        { kind: 'record_answer' | 'record_answers' | 'resolve_decision' | 'resolve_decisions' }
      >['followThrough']
    >,
    { kind: 'planning_batch' }
  >['requests'][number],
) {
  return formatGroupedPlanningRequestDetailLines('Follow-through grouped request', {
    ...request,
    requestedUpdates: request.requestedUpdates ?? [],
    blockedBy: request.blockedBy ?? [],
    blockedByTaskKeys: request.blockedByTaskKeys ?? [],
  })
}
