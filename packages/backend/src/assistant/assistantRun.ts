import { z } from 'zod'
import { ANSWER_CAPTURE_FORMATS } from '../domain/answerCaptureFormat'
import { BLOCKER_KINDS, TASK_KINDS, TASK_STATUSES } from '../domain/board'
import { INTERPRETABLE_SOURCE_RESPONSE_FORMATS } from '../runtime/answerInterpretation'
import { DECISION_STATUSES } from '../storage/decisionStore'
import { goalAttachmentRefArraySchema, goalAttachmentRefSchema } from '../storage/goalAttachmentStore'
import {
  PLANNING_REQUEST_STATUSES,
  goalPlanningRequestBlockedByWorkflowKeysSchema,
  goalPlanningRequestUpdateTargetArraySchema,
} from '../storage/planningRequestStore'
import { PREFERENCE_KEY_PATTERN } from '../storage/preferenceStore'

const matchHintArraySchema = z.array(z.string().min(1)).default([])
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

const assistantResultPlanningAnswerSchema = z.object({
  summary: z.string().min(1),
  answerKey: z.string().min(1).optional(),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: z.array(z.string().min(1)).optional(),
  captureFormat: z.enum(ANSWER_CAPTURE_FORMATS).optional(),
  answer: z.string().min(1),
})

const assistantResultPlanningRequestSchema = z.object({
  requestKey: z.string().min(1),
  workflowKey: z.string().min(1).optional(),
  workflowTaskKey: z.string().min(1).optional(),
  workflowSharedDecisionRefs: z.array(z.string().min(1)),
  workflowSharedAnswers: z.array(assistantResultPlanningAnswerSchema),
  blockedByWorkflowKeys: goalPlanningRequestBlockedByWorkflowKeysSchema,
  groupKey: z.string().min(1).optional(),
  groupTaskKey: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  taskRef: z.string().min(1),
  decisionRefs: z.array(z.string().min(1)),
  answers: z.array(assistantResultPlanningAnswerSchema),
  attachments: goalAttachmentRefArraySchema,
  requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  status: z.enum(PLANNING_REQUEST_STATUSES),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  resolution: z.string().min(1).optional(),
})

const assistantResultTaskSchema = z.object({
  ref: z.string().min(1),
  kind: z.enum(TASK_KINDS),
  status: z.enum(TASK_STATUSES),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  blockedBy: z.array(
    z.object({
      kind: z.enum(BLOCKER_KINDS),
      ref: z.string().min(1),
    }),
  ),
  attachmentAssetPaths: z.array(z.string().min(1)).optional(),
})

const assistantResultPreferenceEntrySchema = z.object({
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
  status: z.enum(['active', 'retired']),
  summary: z.string().min(1),
  rationale: z.string().min(1).optional(),
  retiredReason: z.string().min(1).optional(),
  supersededBy: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
})

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

const interpretableAnswerSourceArraySchema = z
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
    toolInvocationKey: z.string().min(1).optional(),
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
    answers: interpretablePlanningAnswerArraySchema,
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
    answers: interpretablePlanningAnswerArraySchema,
    requests: z.array(assistantPlanningBatchEntrySchema).default([]),
  }),
])

const assistantPlanningWorkflowLeafResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('planning'),
    workflowTaskKey: z.string().min(1).optional(),
    groupKey: z.string().min(1).optional(),
    requests: z.array(assistantResultPlanningRequestSchema).min(1).optional(),
    requestKeys: z.array(z.string().min(1)).min(1),
    taskRefs: z.array(z.string().min(1)).min(1),
    blockerTaskRefs: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
    requests: z.array(assistantResultPlanningRequestSchema).min(1).optional(),
    requestKeys: z.array(z.string().min(1)).min(1),
    taskRefs: z.array(z.string().min(1)).min(1),
    blockerTaskRefs: z.array(z.string().min(1)).min(1),
  }),
])

const assistantDecisionFollowThroughResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('planning'),
    workflowTaskKey: z.string().min(1).optional(),
    requests: z.array(assistantResultPlanningRequestSchema).min(1).optional(),
    requestKeys: z.array(z.string().min(1)).min(1),
    taskRefs: z.array(z.string().min(1)).min(1),
    blockerTaskRefs: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
    requests: z.array(assistantResultPlanningRequestSchema).min(1).optional(),
    requestKeys: z.array(z.string().min(1)).min(1),
    taskRefs: z.array(z.string().min(1)).min(1),
    blockerTaskRefs: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal('workflow_batch'),
    workflowKey: z.string().min(1).optional(),
    workflows: z.array(assistantPlanningWorkflowLeafResultSchema).min(1),
    requests: z.array(assistantResultPlanningRequestSchema).min(1).optional(),
    groupKeys: z.array(z.string().min(1)),
    requestKeys: z.array(z.string().min(1)).min(1),
    taskRefs: z.array(z.string().min(1)).min(1),
    blockerTaskRefs: z.array(z.string().min(1)).min(1),
  }),
])

const assistantDecisionAnswerSchema = z.object({
  summary: z.string().min(1),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
  decisionKey: z.string().min(1).optional(),
  taskRef: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  sourceExcerpt: z.string().min(1).optional(),
  sourceOccurrence: sourceOccurrenceSchema.optional(),
  answerSourceKey: z.string().min(1).optional(),
  answerSourceGroupKey: z.string().min(1).optional(),
})

const assistantResultDecisionSchema = z.object({
  decisionKey: z.string().min(1),
  summary: z.string().min(1),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: z.array(z.string().min(1)).optional(),
  captureFormat: z.enum(ANSWER_CAPTURE_FORMATS).optional(),
  status: z.enum(DECISION_STATUSES),
  taskRef: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  attachments: goalAttachmentRefArraySchema,
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
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

const retryTaskActionSchema = z.object({
  kind: z.literal('retry_task'),
  taskRef: z.string().min(1),
  reason: z.string().min(1),
  clearBlockers: z
    .array(
      z.object({
        kind: z.enum(['intervention', 'merge_conflict']),
        ref: z.string().min(1),
      }),
    )
    .default([]),
})

const requestPlanningSingleActionSchema = z.object({
  kind: z.literal('request_planning'),
  mode: z.literal('single').optional(),
  attachmentAssetPaths: z.array(z.string().min(1)).default([]),
  groupKey: z.string().min(1).optional(),
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
  blockedBy: z
    .array(
      z.object({
        kind: z.enum(BLOCKER_KINDS),
        ref: z.string().min(1),
      }),
    )
    .default([]),
})

const requestPlanningBatchActionSchema = z.object({
  kind: z.literal('request_planning'),
  mode: z.literal('batch'),
  attachmentAssetPaths: z.array(z.string().min(1)).default([]),
  groupKey: z.string().min(1),
  decisionRefs: z.array(z.string().min(1)).default([]),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  inferRemainingAnswers: z.boolean().optional(),
  answers: interpretablePlanningAnswerArraySchema,
  requests: z.array(assistantPlanningBatchEntrySchema).min(1),
})

const requestPlanningWorkflowActionSchema = z.object({
  kind: z.literal('request_planning'),
  mode: z.literal('workflow'),
  attachmentAssetPaths: z.array(z.string().min(1)).default([]),
  workflowKey: z.string().min(1).optional(),
  reuseTaskRef: z.string().min(1).optional(),
  reuseGroupKey: z.string().min(1).optional(),
  decisionRefs: z.array(z.string().min(1)).default([]),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  inferRemainingAnswers: z.boolean().optional(),
  answers: interpretablePlanningAnswerArraySchema,
  workflows: z.array(assistantPlanningWorkflowLeafSchema).min(1),
})

const requestPlanningActionSchema = z.union([
  requestPlanningSingleActionSchema,
  requestPlanningBatchActionSchema,
  requestPlanningWorkflowActionSchema,
])

const requestDecisionActionSchema = z.object({
  kind: z.literal('request_decision'),
  attachmentAssetPaths: z.array(z.string().min(1)).default([]),
  decisionKey: z.string().min(1),
  summary: z.string().min(1),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
  taskRef: z.string().min(1).optional(),
})

const resolveDecisionsActionSchema = z
  .object({
    kind: z.literal('resolve_decisions'),
    attachmentAssetPaths: z.array(z.string().min(1)).default([]),
    answerSources: interpretableAnswerSourceArraySchema,
    sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
    sourceResponse: z.string().min(1).optional(),
    inferOpenDecisions: z.boolean().default(false),
    inferDecisionTopics: z.boolean().default(false),
    answers: z.array(assistantDecisionAnswerSchema).default([]),
    followThrough: resolveDecisionFollowThroughSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.answers.length === 0 &&
      !value.inferOpenDecisions &&
      !value.inferDecisionTopics
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'resolve_decisions requires at least one explicit answer or an inference flag.',
        path: ['answers'],
      })
    }
  })

const setPreferenceUpsertActionSchema = z.object({
  kind: z.literal('set_preference'),
  mode: z.literal('upsert').optional(),
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
  summary: z.string().min(1),
  rationale: z.string().min(1).optional(),
  supersedes: z.array(z.string().regex(PREFERENCE_KEY_PATTERN)).default([]),
})

const setPreferenceRetireActionSchema = z.object({
  kind: z.literal('set_preference'),
  mode: z.literal('retire'),
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
  reason: z.string().min(1),
  supersededBy: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
})

const setPreferenceActionSchema = z.union([
  setPreferenceUpsertActionSchema,
  setPreferenceRetireActionSchema,
])

const legacyMoveTaskActionSchema = z.object({
  kind: z.literal('move_task'),
  taskRef: z.string().min(1),
  status: z.enum(['planned', 'in_review', 'merging', 'done']),
  reason: z.string().min(1),
})

const legacyCreatePlanningTaskActionSchema = z.object({
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
})

const legacyRequestPlanningBatchActionSchema = z.object({
  kind: z.literal('request_planning_batch'),
  attachmentAssetPaths: z.array(z.string().min(1)).default([]),
  groupKey: z.string().min(1),
  decisionRefs: z.array(z.string().min(1)).default([]),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  inferRemainingAnswers: z.boolean().optional(),
  answers: interpretablePlanningAnswerArraySchema,
  requests: z.array(assistantPlanningBatchEntrySchema).min(1),
})

const legacyRequestPlanningWorkflowsActionSchema = z.object({
  kind: z.literal('request_planning_workflows'),
  attachmentAssetPaths: z.array(z.string().min(1)).default([]),
  workflowKey: z.string().min(1).optional(),
  reuseTaskRef: z.string().min(1).optional(),
  reuseGroupKey: z.string().min(1).optional(),
  decisionRefs: z.array(z.string().min(1)).default([]),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  inferRemainingAnswers: z.boolean().optional(),
  answers: interpretablePlanningAnswerArraySchema,
  workflows: z.array(assistantPlanningWorkflowLeafSchema).min(1),
})

const legacyRecordAnswerActionSchema = z.object({
  kind: z.literal('record_answer'),
  attachmentAssetPaths: z.array(z.string().min(1)).default([]),
  summary: z.string().min(1),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
  decisionKey: z.string().min(1).optional(),
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

const legacyRecordAnswersActionSchema = z.object({
  kind: z.literal('record_answers'),
  attachmentAssetPaths: z.array(z.string().min(1)).default([]),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  inferOpenDecisions: z.boolean().default(false),
  inferDecisionTopics: z.boolean().default(false),
  answers: z.array(assistantDecisionAnswerSchema).default([]),
  followThrough: resolveDecisionFollowThroughSchema.optional(),
})

const legacyResolveDecisionActionSchema = z.object({
  kind: z.literal('resolve_decision'),
  attachmentAssetPaths: z.array(z.string().min(1)).default([]),
  decisionKey: z.string().min(1),
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

const legacyRecordPreferenceActionSchema = z.object({
  kind: z.literal('record_preference'),
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
  summary: z.string().min(1),
  rationale: z.string().min(1).optional(),
  supersedes: z.array(z.string().regex(PREFERENCE_KEY_PATTERN)).default([]),
})

const legacyRetirePreferenceActionSchema = z.object({
  kind: z.literal('retire_preference'),
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
  reason: z.string().min(1),
  supersededBy: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
})

const legacyUpdatePreferenceActionSchema = z.object({
  kind: z.literal('update_preference'),
  content: z.string().min(1),
})

export const assistantActionSchema = z.union([
  retryTaskActionSchema,
  requestPlanningActionSchema,
  requestDecisionActionSchema,
  resolveDecisionsActionSchema,
  setPreferenceActionSchema,
  legacyMoveTaskActionSchema,
  legacyCreatePlanningTaskActionSchema,
  legacyRequestPlanningBatchActionSchema,
  legacyRequestPlanningWorkflowsActionSchema,
  legacyRecordAnswerActionSchema,
  legacyRecordAnswersActionSchema,
  legacyResolveDecisionActionSchema,
  legacyRecordPreferenceActionSchema,
  legacyRetirePreferenceActionSchema,
  legacyUpdatePreferenceActionSchema,
])

const retryTaskActionResultSchema = z.object({
  kind: z.literal('retry_task'),
  taskRef: z.string().min(1),
  status: z.enum(TASK_STATUSES),
  clearedBlockers: z.array(
    z.object({
      kind: z.enum(['intervention', 'merge_conflict']),
      ref: z.string().min(1),
    }),
  ),
  task: assistantResultTaskSchema.optional(),
  summary: z.string().min(1),
})

const requestPlanningActionResultSchema = z.object({
  kind: z.literal('request_planning'),
  mode: z.enum(['single', 'batch', 'workflow']).optional(),
  requestKey: z.string().min(1).optional(),
  taskRef: z.string().min(1).optional(),
  request: assistantResultPlanningRequestSchema.optional(),
  created: z.boolean().optional(),
  taskCreated: z.boolean().optional(),
  groupKey: z.string().min(1).optional(),
  workflowKey: z.string().min(1).optional(),
  groupKeys: z.array(z.string().min(1)).optional(),
  workflows: z.array(assistantPlanningWorkflowLeafResultSchema).min(1).optional(),
  requestKeys: z.array(z.string().min(1)).optional(),
  taskRefs: z.array(z.string().min(1)).optional(),
  requests: z.array(assistantResultPlanningRequestSchema).min(1).optional(),
  blockerTaskRefs: z.array(z.string().min(1)).optional(),
  createdRequestKeys: z.array(z.string().min(1)).optional(),
  createdTaskRefs: z.array(z.string().min(1)).optional(),
  resolvedSourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  summary: z.string().min(1),
})

const requestDecisionActionResultSchema = z.object({
  kind: z.literal('request_decision'),
  decisionKey: z.string().min(1),
  decision: assistantResultDecisionSchema.optional(),
  created: z.boolean(),
  blockerAdded: z.boolean(),
  decisionStatus: z.enum(DECISION_STATUSES),
  summary: z.string().min(1),
})

const resolveDecisionsActionResultSchema = z.object({
  kind: z.literal('resolve_decisions'),
  decisionKeys: z.array(z.string().min(1)).min(1),
  decisions: z.array(assistantResultDecisionSchema).min(1).optional(),
  createdDecisionKeys: z.array(z.string().min(1)),
  blockerRemoved: z.boolean(),
  resolvedSourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  followThrough: assistantDecisionFollowThroughResultSchema.optional(),
  summary: z.string().min(1),
})

const setPreferenceActionResultSchema = z.object({
  kind: z.literal('set_preference'),
  mode: z.enum(['upsert', 'retire']).optional(),
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
  preferenceSummary: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  supersededBy: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
  preference: assistantResultPreferenceEntrySchema.optional(),
  retiredPreferences: z.array(assistantResultPreferenceEntrySchema).optional(),
  retiredPreferenceKeys: z.array(z.string().regex(PREFERENCE_KEY_PATTERN)).default([]),
  summary: z.string().min(1),
})

const legacyMoveTaskActionResultSchema = z.object({
  kind: z.literal('move_task'),
  taskRef: z.string().min(1),
  status: z.enum(TASK_STATUSES),
  previousStatus: z.enum(TASK_STATUSES).optional(),
  task: assistantResultTaskSchema.optional(),
  summary: z.string().min(1),
})

const legacyCreatePlanningTaskActionResultSchema = z.object({
  kind: z.literal('create_planning_task'),
  taskRef: z.string().min(1),
  task: assistantResultTaskSchema.optional(),
  summary: z.string().min(1),
})

const legacyRequestPlanningBatchActionResultSchema = z.object({
  kind: z.literal('request_planning_batch'),
  groupKey: z.string().min(1),
  requestKeys: z.array(z.string().min(1)).min(1),
  taskRefs: z.array(z.string().min(1)).min(1),
  requests: z.array(assistantResultPlanningRequestSchema).min(1).optional(),
  blockerTaskRefs: z.array(z.string().min(1)).min(1),
  createdRequestKeys: z.array(z.string().min(1)),
  createdTaskRefs: z.array(z.string().min(1)),
  resolvedSourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  summary: z.string().min(1),
})

const legacyRequestPlanningWorkflowsActionResultSchema = z.object({
  kind: z.literal('request_planning_workflows'),
  workflowKey: z.string().min(1).optional(),
  groupKeys: z.array(z.string().min(1)),
  workflows: z.array(assistantPlanningWorkflowLeafResultSchema).min(1),
  requestKeys: z.array(z.string().min(1)).min(1),
  taskRefs: z.array(z.string().min(1)).min(1),
  requests: z.array(assistantResultPlanningRequestSchema).min(1).optional(),
  blockerTaskRefs: z.array(z.string().min(1)).min(1),
  createdRequestKeys: z.array(z.string().min(1)),
  createdTaskRefs: z.array(z.string().min(1)),
  resolvedSourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  summary: z.string().min(1),
})

const legacyRecordAnswerActionResultSchema = z.object({
  kind: z.literal('record_answer'),
  decisionKey: z.string().min(1),
  decision: assistantResultDecisionSchema.optional(),
  created: z.boolean(),
  blockerRemoved: z.boolean(),
  resolvedSourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  followThrough: assistantDecisionFollowThroughResultSchema.optional(),
  summary: z.string().min(1),
})

const legacyRecordAnswersActionResultSchema = z.object({
  kind: z.literal('record_answers'),
  decisionKeys: z.array(z.string().min(1)).min(1),
  decisions: z.array(assistantResultDecisionSchema).min(1).optional(),
  createdDecisionKeys: z.array(z.string().min(1)),
  blockerRemoved: z.boolean(),
  resolvedSourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  followThrough: assistantDecisionFollowThroughResultSchema.optional(),
  summary: z.string().min(1),
})

const legacyResolveDecisionActionResultSchema = z.object({
  kind: z.literal('resolve_decision'),
  decisionKey: z.string().min(1),
  decision: assistantResultDecisionSchema.optional(),
  blockerRemoved: z.boolean(),
  resolvedSourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  followThrough: assistantDecisionFollowThroughResultSchema.optional(),
  summary: z.string().min(1),
})

const legacyRecordPreferenceActionResultSchema = z.object({
  kind: z.literal('record_preference'),
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
  preferenceSummary: z.string().min(1),
  rationale: z.string().min(1).optional(),
  preference: assistantResultPreferenceEntrySchema.optional(),
  retiredPreferences: z.array(assistantResultPreferenceEntrySchema).optional(),
  retiredPreferenceKeys: z.array(z.string().regex(PREFERENCE_KEY_PATTERN)),
  summary: z.string().min(1),
})

const legacyRetirePreferenceActionResultSchema = z.object({
  kind: z.literal('retire_preference'),
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
  reason: z.string().min(1),
  supersededBy: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
  preference: assistantResultPreferenceEntrySchema.optional(),
  summary: z.string().min(1),
})

const legacyUpdatePreferenceActionResultSchema = z.object({
  kind: z.literal('update_preference'),
  content: z.string().min(1),
  preferences: z.array(assistantResultPreferenceEntrySchema).optional(),
  summary: z.string().min(1),
})

export const assistantActionResultSchema = z.union([
  retryTaskActionResultSchema,
  requestPlanningActionResultSchema,
  requestDecisionActionResultSchema,
  resolveDecisionsActionResultSchema,
  setPreferenceActionResultSchema,
  legacyMoveTaskActionResultSchema,
  legacyCreatePlanningTaskActionResultSchema,
  legacyRequestPlanningBatchActionResultSchema,
  legacyRequestPlanningWorkflowsActionResultSchema,
  legacyRecordAnswerActionResultSchema,
  legacyRecordAnswersActionResultSchema,
  legacyResolveDecisionActionResultSchema,
  legacyRecordPreferenceActionResultSchema,
  legacyRetirePreferenceActionResultSchema,
  legacyUpdatePreferenceActionResultSchema,
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
  attachments: z.infer<typeof goalAttachmentRefSchema>[]
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
  attachments: z.infer<typeof goalAttachmentRefSchema>[]
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
  attachments: goalAttachmentRefArraySchema,
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
