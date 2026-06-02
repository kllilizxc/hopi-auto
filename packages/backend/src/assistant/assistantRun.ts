import { z } from 'zod'
import { BLOCKER_KINDS, TASK_STATUSES } from '../domain/board'
import {
  goalPlanningRequestAnswerArraySchema,
  goalPlanningRequestBlockedByWorkflowKeysSchema,
  goalPlanningRequestUpdateTargetArraySchema,
} from '../storage/planningRequestStore'
import { PREFERENCE_KEY_PATTERN } from '../storage/preferenceStore'

const matchHintArraySchema = z.array(z.string().min(1)).default([])

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
    requests: z.array(assistantPlanningBatchEntrySchema).default([]),
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

const assistantDecisionFollowThroughResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('planning'),
    workflowTaskKey: z.string().min(1).optional(),
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
  z.object({
    kind: z.literal('workflow_batch'),
    workflowKey: z.string().min(1).optional(),
    workflows: z.array(assistantPlanningWorkflowLeafResultSchema).min(1),
    groupKeys: z.array(z.string().min(1)),
    requestKeys: z.array(z.string().min(1)).min(1),
    taskRefs: z.array(z.string().min(1)).min(1),
    blockerTaskRefs: z.array(z.string().min(1)).min(1),
  }),
])

const assistantDecisionAnswerSchema = z.object({
  summary: z.string().min(1),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
  decisionKey: z.string().min(1).optional(),
  taskRef: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  sourceExcerpt: z.string().min(1).optional(),
  answerSourceKey: z.string().min(1).optional(),
})

const interpretablePlanningAnswerArraySchema = z
  .array(
    z.object({
      summary: z.string().min(1),
      prompt: z.string().min(1).optional(),
      matchHints: matchHintArraySchema,
      answer: z.string().min(1).optional(),
      sourceExcerpt: z.string().min(1).optional(),
      answerSourceKey: z.string().min(1).optional(),
    }),
  )
  .default([])

const interpretableAnswerSourceArraySchema = z
  .array(
    z.union([
      z.object({
        answerSourceKey: z.string().min(1),
        answer: z.string().min(1),
      }),
      z.object({
        answerSourceKey: z.string().min(1),
        sourceExcerpt: z.string().min(1),
      }),
    ]),
  )
  .default([])

const resolveDecisionLeafFollowThroughSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('planning'),
    inferRemainingAnswers: z.boolean().optional(),
    title: z.string().min(1),
    description: z.string(),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    answers: interpretablePlanningAnswerArraySchema,
    requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
    inferRemainingAnswers: z.boolean().optional(),
    answers: interpretablePlanningAnswerArraySchema,
    requests: z.array(assistantPlanningBatchEntrySchema).min(1),
  }),
])

const resolveDecisionWorkflowLeafFollowThroughSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('planning'),
    workflowTaskKey: z.string().min(1).optional(),
    blockedByWorkflowKeys: goalPlanningRequestBlockedByWorkflowKeysSchema,
    title: z.string().min(1),
    description: z.string(),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    answers: interpretablePlanningAnswerArraySchema,
    requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
    blockedByWorkflowKeys: goalPlanningRequestBlockedByWorkflowKeysSchema,
    answers: interpretablePlanningAnswerArraySchema,
    requests: z.array(assistantPlanningBatchEntrySchema).default([]),
  }),
])

const resolveDecisionFollowThroughSchema = z.discriminatedUnion('kind', [
  ...resolveDecisionLeafFollowThroughSchema.options,
  z.object({
    kind: z.literal('workflow_batch'),
    workflowKey: z.string().min(1).optional(),
    reuseTaskRef: z.string().min(1).optional(),
    reuseGroupKey: z.string().min(1).optional(),
    inferRemainingAnswers: z.boolean().optional(),
    answers: interpretablePlanningAnswerArraySchema,
    workflows: z.array(resolveDecisionWorkflowLeafFollowThroughSchema).min(1),
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
    reuseGroupKey: z.string().min(1).optional(),
    decisionRefs: z.array(z.string().min(1)).default([]),
    answers: goalPlanningRequestAnswerArraySchema,
    workflows: z.array(assistantPlanningWorkflowLeafSchema).min(1),
  }),
  z.object({
    kind: z.literal('request_decision'),
    decisionKey: z.string().min(1),
    summary: z.string().min(1),
    prompt: z.string().min(1).optional(),
    matchHints: matchHintArraySchema,
    taskRef: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('record_answer'),
    summary: z.string().min(1),
    prompt: z.string().min(1).optional(),
    matchHints: matchHintArraySchema,
    decisionKey: z.string().min(1).optional(),
    taskRef: z.string().min(1).optional(),
    answer: z.string().min(1).optional(),
    sourceExcerpt: z.string().min(1).optional(),
    answerSourceKey: z.string().min(1).optional(),
    answerSources: interpretableAnswerSourceArraySchema,
    sourceResponseFormat: z
      .enum([
        'labeled_sections',
        'ordered_items',
        'ordered_blocks',
        'question_blocks',
        'question_spans',
        'question_closing_spans',
        'question_closing_blocks',
        'inline_topics',
        'topic_sentences',
        'topic_spans',
        'topic_middle_spans',
        'topic_closing_spans',
        'topic_closing_blocks',
        'topic_paragraphs',
        'topic_middle_blocks',
        'topic_blocks',
      ])
      .optional(),
    sourceResponse: z.string().min(1).optional(),
    followThrough: resolveDecisionFollowThroughSchema.optional(),
  }),
  z.object({
    kind: z.literal('record_answers'),
    answerSources: interpretableAnswerSourceArraySchema,
    sourceResponseFormat: z
      .enum([
        'labeled_sections',
        'ordered_items',
        'ordered_blocks',
        'question_blocks',
        'question_spans',
        'question_closing_spans',
        'question_closing_blocks',
        'inline_topics',
        'topic_sentences',
        'topic_spans',
        'topic_middle_spans',
        'topic_closing_spans',
        'topic_closing_blocks',
        'topic_paragraphs',
        'topic_middle_blocks',
        'topic_blocks',
      ])
      .optional(),
    sourceResponse: z.string().min(1).optional(),
    inferOpenDecisions: z.boolean().default(false),
    inferDecisionTopics: z.boolean().default(false),
    answers: z.array(assistantDecisionAnswerSchema).default([]),
    followThrough: resolveDecisionFollowThroughSchema.optional(),
  }),
  z.object({
    kind: z.literal('resolve_decision'),
    decisionKey: z.string().min(1),
    summary: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    matchHints: matchHintArraySchema,
    taskRef: z.string().min(1).optional(),
    answer: z.string().min(1).optional(),
    sourceExcerpt: z.string().min(1).optional(),
    answerSourceKey: z.string().min(1).optional(),
    answerSources: interpretableAnswerSourceArraySchema,
    sourceResponseFormat: z
      .enum([
        'labeled_sections',
        'ordered_items',
        'ordered_blocks',
        'question_blocks',
        'question_spans',
        'question_closing_spans',
        'question_closing_blocks',
        'inline_topics',
        'topic_sentences',
        'topic_spans',
        'topic_middle_spans',
        'topic_closing_spans',
        'topic_closing_blocks',
        'topic_paragraphs',
        'topic_middle_blocks',
        'topic_blocks',
      ])
      .optional(),
    sourceResponse: z.string().min(1).optional(),
    followThrough: resolveDecisionFollowThroughSchema.optional(),
  }),
  z.object({
    kind: z.literal('record_preference'),
    preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
    summary: z.string().min(1),
    rationale: z.string().min(1).optional(),
    supersedes: z.array(z.string().regex(PREFERENCE_KEY_PATTERN)).default([]),
  }),
  z.object({
    kind: z.literal('retire_preference'),
    preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
    reason: z.string().min(1),
    supersededBy: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
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
    created: z.boolean(),
    blockerRemoved: z.boolean(),
    followThrough: assistantDecisionFollowThroughResultSchema.optional(),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('record_answers'),
    decisionKeys: z.array(z.string().min(1)).min(1),
    createdDecisionKeys: z.array(z.string().min(1)),
    blockerRemoved: z.boolean(),
    followThrough: assistantDecisionFollowThroughResultSchema.optional(),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('resolve_decision'),
    decisionKey: z.string().min(1),
    blockerRemoved: z.boolean(),
    followThrough: assistantDecisionFollowThroughResultSchema.optional(),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('record_preference'),
    preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
    retiredPreferenceKeys: z.array(z.string().regex(PREFERENCE_KEY_PATTERN)),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('retire_preference'),
    preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
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
