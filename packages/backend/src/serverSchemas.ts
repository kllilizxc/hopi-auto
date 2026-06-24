import { z } from 'zod'
import { projectCodingDefaultsInputSchema } from './agent/projectCodingDefaults'
import { BLOCKER_KINDS, TASK_KINDS, TASK_STATUSES, type TodoBoard } from './domain/board'
import { INTERPRETABLE_SOURCE_RESPONSE_FORMATS } from './runtime/answerInterpretation'
import { goalAttachmentRefArraySchema } from './storage/goalAttachmentStore'
import {
  goalPlanningRequestBlockedByWorkflowKeysSchema,
  goalPlanningRequestUpdateTargetArraySchema,
} from './storage/planningRequestStore'
import { PREFERENCE_KEY_PATTERN } from './storage/preferenceStore'

export const matchHintArraySchema = z.array(z.string().min(1)).default([])
const sourceOccurrenceSchema = z.number().int().positive()
const interpretableSourceResponseFormatSchema = z.enum(INTERPRETABLE_SOURCE_RESPONSE_FORMATS)
const interpretablePlanningAnswerArraySchema = z
  .array(
    z.object({
      summary: z.string().min(1),
      answerKey: z.string().min(1).optional(),
      summaryKey: z.string().min(1).optional(),
      prompt: z.string().min(1).optional(),
      matchHints: matchHintArraySchema,
      answer: z.string().min(1).optional(),
      sourceExcerpt: z.string().min(1).optional(),
      sourceOccurrence: sourceOccurrenceSchema.optional(),
      answerSourceKey: z.string().min(1).optional(),
      answerSourceGroupKey: z.string().min(1).optional(),
    }),
  )
  .default([])

const interpretableAnswerSourceMetadataSchema = {
  answerSourceKey: z.string().min(1),
  sourceGroupKey: z.string().min(1).optional(),
  route: z.enum(['decision', 'planning']).optional(),
  decisionKey: z.string().min(1).optional(),
  answerKey: z.string().min(1).optional(),
  summaryKey: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
}

export const interpretableAnswerSourceArraySchema = z
  .array(
    z.union([
      z.object({
        ...interpretableAnswerSourceMetadataSchema,
        answer: z.string().min(1),
      }),
      z.object({
        ...interpretableAnswerSourceMetadataSchema,
        sourceExcerpt: z.string().min(1),
        sourceOccurrence: sourceOccurrenceSchema.optional(),
      }),
    ]),
  )
  .default([])

const blockerSchema = z.object({
  kind: z.enum(BLOCKER_KINDS),
  ref: z.string().min(1),
})

export const createTaskSchema = z.object({
  ref: z.string().min(1),
  kind: z.enum(TASK_KINDS),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)),
  blockedBy: z.array(blockerSchema).default([]),
})

export const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES),
  reason: z.string().min(1).default('manual transition'),
})

export const createDecisionSchema = z.object({
  decisionKey: z.string().min(1).optional(),
  summary: z.string().min(1),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
  taskRef: z.string().min(1).optional(),
})

export const createPlanningRequestSchema = z.object({
  requestKey: z.string().min(1).optional(),
  groupKey: z.string().min(1).optional(),
  groupTaskKey: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  decisionRefs: z.array(z.string().min(1)).default([]),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  inferRemainingAnswers: z.boolean().optional(),
  answers: interpretablePlanningAnswerArraySchema,
  requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  blockedBy: z.array(blockerSchema).default([]),
})

const planningBatchEntrySchema = z.object({
  taskKey: z.string().min(1),
  requestKey: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  blockedBy: z.array(blockerSchema).default([]),
  blockedByTaskKeys: z.array(z.string().min(1)).default([]),
})

const planningWorkflowLeafSchema = z.discriminatedUnion('kind', [
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
    answers: interpretablePlanningAnswerArraySchema,
    requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
    blockedBy: z.array(blockerSchema).default([]),
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
    blockedByWorkflowKeys: goalPlanningRequestBlockedByWorkflowKeysSchema,
    decisionRefs: z.array(z.string().min(1)).default([]),
    answers: interpretablePlanningAnswerArraySchema,
    requests: z.array(planningBatchEntrySchema).default([]),
  }),
])

export const createPlanningWorkflowBatchSchema = z.object({
  workflowKey: z.string().min(1).optional(),
  reuseTaskRef: z.string().min(1).optional(),
  reuseGroupKey: z.string().min(1).optional(),
  decisionRefs: z.array(z.string().min(1)).default([]),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  inferRemainingAnswers: z.boolean().optional(),
  answers: interpretablePlanningAnswerArraySchema,
  workflows: z.array(planningWorkflowLeafSchema).min(1),
})

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
    requests: z.array(planningBatchEntrySchema).min(1),
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
    requests: z.array(planningBatchEntrySchema).default([]),
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

export const resolveDecisionSchema = z.object({
  summary: z.string().min(1).optional(),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
  taskRef: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  sourceExcerpt: z.string().min(1).optional(),
  sourceOccurrence: sourceOccurrenceSchema.optional(),
  answerSourceKey: z.string().min(1).optional(),
  answerSourceGroupKey: z.string().min(1).optional(),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  followThrough: resolveDecisionFollowThroughSchema.optional(),
})

export const answerDecisionSchema = z.object({
  decisionKey: z.string().min(1).optional(),
  summary: z.string().min(1),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
  taskRef: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  sourceExcerpt: z.string().min(1).optional(),
  sourceOccurrence: sourceOccurrenceSchema.optional(),
  answerSourceKey: z.string().min(1).optional(),
  answerSourceGroupKey: z.string().min(1).optional(),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  followThrough: resolveDecisionFollowThroughSchema.optional(),
})

const answerDecisionBatchEntrySchema = z.object({
  decisionKey: z.string().min(1).optional(),
  summary: z.string().min(1),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
  taskRef: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  sourceExcerpt: z.string().min(1).optional(),
  sourceOccurrence: sourceOccurrenceSchema.optional(),
  answerSourceKey: z.string().min(1).optional(),
  answerSourceGroupKey: z.string().min(1).optional(),
})

export const answerDecisionBatchSchema = z.object({
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  inferOpenDecisions: z.boolean().default(false),
  inferDecisionTopics: z.boolean().default(false),
  answers: z.array(answerDecisionBatchEntrySchema).default([]),
  followThrough: resolveDecisionFollowThroughSchema.optional(),
})

export const assistantMessageSchema = z.object({
  content: z.string().min(1),
  attachments: goalAttachmentRefArraySchema,
})

export const assistantRunSchema = z.object({
  content: z.string().min(1),
  attachments: goalAttachmentRefArraySchema,
  appendUserMessage: z.boolean().default(true),
})

export const updatePreferenceSchema = z.object({
  content: z.string().min(1),
})

export const recordPreferenceSchema = z.object({
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
  summary: z.string().min(1),
  rationale: z.string().min(1).optional(),
  supersedes: z.array(z.string().regex(PREFERENCE_KEY_PATTERN)).default([]),
})

export const retirePreferenceSchema = z.object({
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
  reason: z.string().min(1),
  supersededBy: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
})

export const createProjectSchema = z.object({
  projectKey: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  rootDir: z.string().min(1),
  codingDefaults: projectCodingDefaultsInputSchema.optional(),
})

export const updateProjectSettingsSchema = z.object({
  codingDefaults: projectCodingDefaultsInputSchema.optional(),
})

export const createProjectGoalSchema = z.object({
  goalKey: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  successCriteria: z.array(z.string().min(1)).default([]),
})

const laneParallelismSchema = z
  .object({
    in_progress: z.number().int().positive().max(10).optional(),
    in_review: z.number().int().positive().max(10).optional(),
    merging: z.number().int().positive().max(10).optional(),
  })
  .partial()
  .optional()

export const automationStartSchema = z.object({
  maxSteps: z.number().int().positive().max(100).optional(),
  maxParallel: z.number().int().positive().max(10).optional(),
  laneParallelism: laneParallelismSchema,
})

export type BoardResponse = Omit<TodoBoard, 'items'> & {
  items: Array<TodoBoard['items'][number] & { running?: boolean }>
}
