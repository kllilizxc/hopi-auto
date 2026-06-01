import { z } from 'zod'
import { BLOCKER_KINDS, TASK_STATUSES } from '../domain/board'
import {
  goalPlanningRequestAnswerArraySchema,
  goalPlanningRequestBlockedByWorkflowKeysSchema,
  goalPlanningRequestUpdateTargetArraySchema,
} from '../storage/planningRequestStore'

const assistantRuntimeEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    level: z.enum(['info', 'error']),
    role: z.string().min(1),
    content: z.string(),
  }),
  z.object({
    kind: z.literal('transcript'),
    transport: z.enum(['process', 'codex', 'claude', 'opencode']),
    entryKind: z.enum(['status', 'assistant', 'tool_call', 'tool_result', 'error']),
    summary: z.string().min(1),
    toolName: z.string().min(1).optional(),
    vendorEventType: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('worktree_prepared'),
    path: z.string().min(1),
    branch: z.string().min(1).optional(),
    baseBranch: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('artifact'),
    ref: z.string().min(1),
    label: z.string().min(1),
  }),
])

const assistantPlanningBatchEntrySchema = z.object({
  taskKey: z.string().min(1),
  requestKey: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  blockedBy: z
    .array(
      z.object({
        kind: z.enum(BLOCKER_KINDS),
        ref: z.string().min(1),
      }),
    )
    .default([]),
  blockedByTaskKeys: z.array(z.string().min(1)).default([]),
})

const assistantPlanningWorkflowLeafSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('planning'),
    requestKey: z.string().min(1).optional(),
    workflowTaskKey: z.string().min(1).optional(),
    blockedByWorkflowKeys: goalPlanningRequestBlockedByWorkflowKeysSchema,
    groupKey: z.string().min(1).optional(),
    title: z.string().min(1),
    description: z.string(),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    decisionRefs: z.array(z.string().min(1)).default([]),
    answers: goalPlanningRequestAnswerArraySchema,
    requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
    blockedBy: z
      .array(
        z.object({
          kind: z.enum(BLOCKER_KINDS),
          ref: z.string().min(1),
        }),
      )
      .default([]),
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
    blockedByWorkflowKeys: goalPlanningRequestBlockedByWorkflowKeysSchema,
    decisionRefs: z.array(z.string().min(1)).default([]),
    answers: goalPlanningRequestAnswerArraySchema,
    requests: z.array(assistantPlanningBatchEntrySchema).min(1),
  }),
])

const assistantPlanningWorkflowLeafResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('planning'),
    workflowTaskKey: z.string().min(1).optional(),
    groupKey: z.string().min(1).optional(),
    requestKeys: z.array(z.string().min(1)).min(1),
    taskRefs: z.array(z.string().min(1)).min(1),
    blockerTaskRefs: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
    requestKeys: z.array(z.string().min(1)).min(1),
    taskRefs: z.array(z.string().min(1)).min(1),
    blockerTaskRefs: z.array(z.string().min(1)).min(1),
  }),
])

const assistantDecisionAnswerSchema = z.object({
  summary: z.string().min(1),
  decisionKey: z.string().min(1).optional(),
  taskRef: z.string().min(1).optional(),
  answer: z.string().min(1),
})

const resolveDecisionLeafFollowThroughSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('planning'),
    title: z.string().min(1),
    description: z.string(),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    answers: goalPlanningRequestAnswerArraySchema,
    requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
    answers: goalPlanningRequestAnswerArraySchema,
    requests: z.array(assistantPlanningBatchEntrySchema).min(1),
  }),
])

const resolveDecisionFollowThroughSchema = z.discriminatedUnion('kind', [
  ...resolveDecisionLeafFollowThroughSchema.options,
  z.object({
    kind: z.literal('workflow_batch'),
    workflows: z.array(resolveDecisionLeafFollowThroughSchema).min(1),
  }),
])

export const assistantActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move_task'),
    taskRef: z.string().min(1),
    status: z.enum(['planned', 'in_review', 'merging', 'done']),
    reason: z.string().min(1),
  }),
  z.object({
    kind: z.literal('create_planning_task'),
    title: z.string().min(1),
    description: z.string(),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    blockedBy: z
      .array(
        z.object({
          kind: z.enum(BLOCKER_KINDS),
          ref: z.string().min(1),
        }),
      )
      .default([]),
  }),
  z.object({
    kind: z.literal('request_planning'),
    groupKey: z.string().min(1).optional(),
    title: z.string().min(1),
    description: z.string(),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    decisionRefs: z.array(z.string().min(1)).default([]),
    answers: goalPlanningRequestAnswerArraySchema,
    requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
    blockedBy: z
      .array(
        z.object({
          kind: z.enum(BLOCKER_KINDS),
          ref: z.string().min(1),
        }),
      )
      .default([]),
  }),
  z.object({
    kind: z.literal('request_planning_batch'),
    groupKey: z.string().min(1),
    decisionRefs: z.array(z.string().min(1)).default([]),
    answers: goalPlanningRequestAnswerArraySchema,
    requests: z.array(assistantPlanningBatchEntrySchema).min(1),
  }),
  z.object({
    kind: z.literal('request_planning_workflows'),
    workflowKey: z.string().min(1).optional(),
    reuseTaskRef: z.string().min(1).optional(),
    workflows: z.array(assistantPlanningWorkflowLeafSchema).min(1),
  }),
  z.object({
    kind: z.literal('request_decision'),
    decisionKey: z.string().min(1),
    summary: z.string().min(1),
    taskRef: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('record_answer'),
    summary: z.string().min(1),
    decisionKey: z.string().min(1).optional(),
    taskRef: z.string().min(1).optional(),
    answer: z.string().min(1),
    followThrough: resolveDecisionFollowThroughSchema.optional(),
  }),
  z.object({
    kind: z.literal('record_answers'),
    answers: z.array(assistantDecisionAnswerSchema).min(1),
    followThrough: resolveDecisionFollowThroughSchema.optional(),
  }),
  z.object({
    kind: z.literal('resolve_decision'),
    decisionKey: z.string().min(1),
    summary: z.string().min(1).optional(),
    taskRef: z.string().min(1).optional(),
    answer: z.string().min(1),
    followThrough: resolveDecisionFollowThroughSchema.optional(),
  }),
  z.object({
    kind: z.literal('record_preference'),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('update_preference'),
    content: z.string().min(1),
  }),
])

export const assistantActionResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move_task'),
    taskRef: z.string().min(1),
    status: z.enum(TASK_STATUSES),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('create_planning_task'),
    taskRef: z.string().min(1),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('request_planning'),
    requestKey: z.string().min(1).optional(),
    taskRef: z.string().min(1),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('request_planning_batch'),
    groupKey: z.string().min(1),
    requestKeys: z.array(z.string().min(1)).min(1),
    taskRefs: z.array(z.string().min(1)).min(1),
    blockerTaskRefs: z.array(z.string().min(1)).min(1),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('request_planning_workflows'),
    workflowKey: z.string().min(1).optional(),
    groupKeys: z.array(z.string().min(1)),
    workflows: z.array(assistantPlanningWorkflowLeafResultSchema).min(1),
    requestKeys: z.array(z.string().min(1)).min(1),
    taskRefs: z.array(z.string().min(1)).min(1),
    blockerTaskRefs: z.array(z.string().min(1)).min(1),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('request_decision'),
    decisionKey: z.string().min(1),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('record_answer'),
    decisionKey: z.string().min(1),
    followThroughGroupKeys: z.array(z.string().min(1)).optional(),
    followThroughRequestKeys: z.array(z.string().min(1)).optional(),
    followThroughTaskRefs: z.array(z.string().min(1)).optional(),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('record_answers'),
    decisionKeys: z.array(z.string().min(1)).min(1),
    followThroughGroupKeys: z.array(z.string().min(1)).optional(),
    followThroughRequestKeys: z.array(z.string().min(1)).optional(),
    followThroughTaskRefs: z.array(z.string().min(1)).optional(),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('resolve_decision'),
    decisionKey: z.string().min(1),
    followThroughGroupKeys: z.array(z.string().min(1)).optional(),
    followThroughRequestKeys: z.array(z.string().min(1)).optional(),
    followThroughTaskRefs: z.array(z.string().min(1)).optional(),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('record_preference'),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('update_preference'),
    summary: z.string().min(1),
  }),
])

export const ASSISTANT_RUN_STATUSES = ['completed', 'failed'] as const

export type GoalAssistantAction = z.infer<typeof assistantActionSchema>
export type GoalAssistantActionResult = z.infer<typeof assistantActionResultSchema>
export type GoalAssistantRunStatus = (typeof ASSISTANT_RUN_STATUSES)[number]

export interface GoalAssistantRunRecord {
  goalKey: string
  assistantRunId: string
  startedAt: string
  endedAt: string
  requestContent: string
  status: GoalAssistantRunStatus
  message: string
  actions: GoalAssistantAction[]
  actionResults: GoalAssistantActionResult[]
  events: z.infer<typeof assistantRuntimeEventSchema>[]
  error?: string
}

export interface GoalAssistantRunSummary {
  assistantRunId: string
  startedAt: string
  endedAt: string
  status: GoalAssistantRunStatus
  message: string
  actionCount: number
}

export interface GoalAssistantRunBundleFile {
  path: string
  content: string | null
}

export interface GoalAssistantRunBundle {
  goalKey: string
  assistantRunId: string
  context: GoalAssistantRunBundleFile
  prompt: GoalAssistantRunBundleFile
  outcome: GoalAssistantRunBundleFile
  result: GoalAssistantRunBundleFile
}

const goalAssistantRunRecordSchema = z.object({
  goalKey: z.string().min(1),
  assistantRunId: z.string().min(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  requestContent: z.string().min(1),
  status: z.enum(ASSISTANT_RUN_STATUSES),
  message: z.string(),
  actions: z.array(assistantActionSchema).default([]),
  actionResults: z.array(assistantActionResultSchema).default([]),
  events: z.array(assistantRuntimeEventSchema).default([]),
  error: z.string().min(1).optional(),
})

export function parseGoalAssistantRunRecord(source: string): GoalAssistantRunRecord {
  const raw = JSON.parse(source)
  return validateGoalAssistantRunRecord(raw)
}

export function validateGoalAssistantRunRecord(input: unknown): GoalAssistantRunRecord {
  const parsed = goalAssistantRunRecordSchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid assistant run record: ${issues}`)
  }

  return parsed.data
}

export function toAssistantRunSummary(run: GoalAssistantRunRecord): GoalAssistantRunSummary {
  return {
    assistantRunId: run.assistantRunId,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    message: run.message,
    actionCount: run.actionResults.length,
  }
}
