import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { AgentRunner } from './agent/AgentRunner'
import { MockAgentRunner } from './agent/AgentRunner'
import { ConfiguredRoleProcessRunner } from './agent/ConfiguredRoleProcessRunner'
import {
  GoalAssistantNotConfiguredError,
  createGoalAssistantRuntime,
} from './assistant/GoalAssistantRuntime'
import { createAssistantRunStore } from './assistant/assistantRunStore'
import { BLOCKER_KINDS, TASK_KINDS, TASK_STATUSES } from './domain/board'
import {
  AnswerInterpretationError,
  createInterpretedSourceResponseState,
  listInterpretableFollowThroughAnswerSummaries,
  materializeInterpretedDecisionAnswerBatch,
  materializeInterpretedDecisionAnswers,
  materializeInterpretedDecisionFollowThrough,
} from './runtime/answerInterpretation'
import { createAssistantThreadStore } from './runtime/assistantThreadStore'
import { createAttemptStore } from './runtime/attemptStore'
import {
  answerGoalDecision,
  answerGoalDecisions,
  requestGoalDecision,
  resolveGoalDecision,
} from './runtime/decisionRequest'
import { createGoalDocsStore } from './runtime/goalDocsStore'
import {
  listGoalPlanningWorkflows,
  readGoalPlanningWorkflow,
  requestGoalPlanning,
  requestGoalPlanningWorkflows,
} from './runtime/planningRequest'
import { createRunHistoryStore } from './runtime/runHistoryStore'
import { createWriteTraceStore } from './runtime/writeTraceStore'
import { reconcileOnce } from './scheduler/reconcileOnce'
import { createBoardStore } from './storage/boardStore'
import { createDecisionStore } from './storage/decisionStore'
import { createProjectPaths } from './storage/paths'
import {
  createPlanningRequestStore,
  goalPlanningRequestAnswerArraySchema,
  goalPlanningRequestBlockedByWorkflowKeysSchema,
  goalPlanningRequestUpdateTargetArraySchema,
} from './storage/planningRequestStore'
import {
  PREFERENCE_KEY_PATTERN,
  PreferenceStoreError,
  createPreferenceStore,
} from './storage/preferenceStore'
import indexPage from './ui/index.html'

export interface ServerOptions {
  rootDir?: string
  port?: number
  runner?: AgentRunner
}

type EventClient = ReadableStreamDefaultController<Uint8Array>

const jsonHeaders = { 'content-type': 'application/json' }
const encoder = new TextEncoder()

const blockerSchema = z.object({
  kind: z.enum(BLOCKER_KINDS),
  ref: z.string().min(1),
})

const createTaskSchema = z.object({
  ref: z.string().min(1),
  kind: z.enum(TASK_KINDS),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)),
  blockedBy: z.array(blockerSchema).default([]),
})

const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES),
  reason: z.string().min(1).default('manual transition'),
})

const createDecisionSchema = z.object({
  decisionKey: z.string().min(1).optional(),
  summary: z.string().min(1),
  taskRef: z.string().min(1).optional(),
})

const createPlanningRequestSchema = z.object({
  requestKey: z.string().min(1).optional(),
  groupKey: z.string().min(1).optional(),
  groupTaskKey: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  decisionRefs: z.array(z.string().min(1)).default([]),
  answers: goalPlanningRequestAnswerArraySchema,
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
    answers: goalPlanningRequestAnswerArraySchema,
    requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
    blockedBy: z.array(blockerSchema).default([]),
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
    blockedByWorkflowKeys: goalPlanningRequestBlockedByWorkflowKeysSchema,
    decisionRefs: z.array(z.string().min(1)).default([]),
    answers: goalPlanningRequestAnswerArraySchema,
    requests: z.array(planningBatchEntrySchema).default([]),
  }),
])

const interpretablePlanningAnswerArraySchema = z
  .array(
    z.object({
      summary: z.string().min(1),
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

const createPlanningWorkflowBatchSchema = z.object({
  workflowKey: z.string().min(1).optional(),
  reuseTaskRef: z.string().min(1).optional(),
  reuseGroupKey: z.string().min(1).optional(),
  decisionRefs: z.array(z.string().min(1)).default([]),
  answers: z
    .array(
      z.object({
        summary: z.string().min(1),
        answer: z.string().min(1),
      }),
    )
    .default([]),
  workflows: z.array(planningWorkflowLeafSchema).min(1),
})

const resolveDecisionLeafFollowThroughSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('planning'),
    title: z.string().min(1),
    description: z.string(),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    answers: interpretablePlanningAnswerArraySchema,
    requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
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
    answers: interpretablePlanningAnswerArraySchema,
    workflows: z.array(resolveDecisionWorkflowLeafFollowThroughSchema).min(1),
  }),
])

const resolveDecisionSchema = z.object({
  summary: z.string().min(1).optional(),
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
      'inline_topics',
      'topic_sentences',
      'topic_paragraphs',
      'topic_blocks',
    ])
    .optional(),
  sourceResponse: z.string().min(1).optional(),
  followThrough: resolveDecisionFollowThroughSchema.optional(),
})

const answerDecisionSchema = z.object({
  decisionKey: z.string().min(1).optional(),
  summary: z.string().min(1),
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
      'inline_topics',
      'topic_sentences',
      'topic_paragraphs',
      'topic_blocks',
    ])
    .optional(),
  sourceResponse: z.string().min(1).optional(),
  followThrough: resolveDecisionFollowThroughSchema.optional(),
})

const answerDecisionBatchEntrySchema = z.object({
  decisionKey: z.string().min(1).optional(),
  summary: z.string().min(1),
  taskRef: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  sourceExcerpt: z.string().min(1).optional(),
  answerSourceKey: z.string().min(1).optional(),
})

const answerDecisionBatchSchema = z.object({
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: z
    .enum([
      'labeled_sections',
      'ordered_items',
      'ordered_blocks',
      'inline_topics',
      'topic_sentences',
      'topic_paragraphs',
      'topic_blocks',
    ])
    .optional(),
  sourceResponse: z.string().min(1).optional(),
  inferOpenDecisions: z.boolean().default(false),
  inferDecisionTopics: z.boolean().default(false),
  answers: z.array(answerDecisionBatchEntrySchema).default([]),
  followThrough: resolveDecisionFollowThroughSchema.optional(),
})

const assistantMessageSchema = z.object({
  content: z.string().min(1),
})

const assistantRunSchema = z.object({
  content: z.string().min(1),
})

const updatePreferenceSchema = z.object({
  content: z.string().min(1),
})

const recordPreferenceSchema = z.object({
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
  summary: z.string().min(1),
  rationale: z.string().min(1).optional(),
  supersedes: z.array(z.string().regex(PREFERENCE_KEY_PATTERN)).default([]),
})

const retirePreferenceSchema = z.object({
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
  reason: z.string().min(1),
  supersededBy: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
})

export function createServer(options: ServerOptions = {}): Bun.Server<undefined> {
  const rootDir = options.rootDir ?? process.cwd()
  const store = createBoardStore(rootDir)
  const decisions = createDecisionStore(rootDir)
  const planningRequests = createPlanningRequestStore(rootDir)
  const preferences = createPreferenceStore(rootDir)
  const goalDocs = createGoalDocsStore(rootDir)
  const assistantThread = createAssistantThreadStore(rootDir)
  const assistantRuns = createAssistantRunStore(rootDir)
  const assistantRuntime = createGoalAssistantRuntime(rootDir)
  const attempts = createAttemptStore(rootDir)
  const history = createRunHistoryStore(rootDir)
  const writeTraces = createWriteTraceStore(rootDir)
  const runner = options.runner ?? createDefaultRunner(rootDir)
  const clients = new Set<EventClient>()

  function broadcast(payload: unknown) {
    const message = encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
    for (const client of clients) {
      try {
        client.enqueue(message)
      } catch {
        clients.delete(client)
      }
    }
  }

  return Bun.serve({
    routes: {
      '/': indexPage,
    },
    port: options.port ?? 3000,
    async fetch(request, server) {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const goalKey = routeGoalKey(parts)

      try {
        if (request.method === 'GET' && url.pathname === '/api/events') {
          server.timeout(request, 0)
          return eventsResponse(clients)
        }

        if (request.method === 'GET' && url.pathname === '/api/preferences') {
          return jsonResponse(await preferences.readPreferences())
        }

        if (request.method === 'POST' && url.pathname === '/api/preferences') {
          const body = await parseJsonBody(request, updatePreferenceSchema)
          const document = await preferences.writePreferences(body.content)
          broadcast({ type: 'preferences_changed' })
          return jsonResponse(document)
        }

        if (request.method === 'POST' && url.pathname === '/api/preferences/record') {
          const body = await parseJsonBody(request, recordPreferenceSchema)
          const document = await preferences.recordPreference(body)
          broadcast({ type: 'preferences_changed' })
          return jsonResponse(document)
        }

        if (request.method === 'POST' && url.pathname === '/api/preferences/retire') {
          const body = await parseJsonBody(request, retirePreferenceSchema)
          const document = await preferences.retirePreference(body)
          broadcast({ type: 'preferences_changed' })
          return jsonResponse(document)
        }

        if (request.method === 'GET' && isGoalRoute(parts, 'board')) {
          const currentGoalKey = requireGoalKey(parts)
          return jsonResponse(await store.readBoard(currentGoalKey))
        }

        if (request.method === 'GET' && isGoalRoute(parts, 'docs') && parts.length === 4) {
          const currentGoalKey = requireGoalKey(parts)
          const board = await store.readBoard(currentGoalKey)
          return jsonResponse(await goalDocs.readGoalDocs(currentGoalKey, board.goal.title))
        }

        if (request.method === 'GET' && isGoalRoute(parts, 'runs') && parts.length === 4) {
          const currentGoalKey = requireGoalKey(parts)
          return jsonResponse({
            goalKey: currentGoalKey,
            runs: await history.listRuns(currentGoalKey),
          })
        }

        if (request.method === 'GET' && isGoalRoute(parts, 'runs') && parts.length === 5) {
          const currentGoalKey = requireGoalKey(parts)
          const runId = requirePathPart(parts, 4)
          const run = await history.readRun(currentGoalKey, runId)
          if (!run) {
            throw new HttpError(404, `Run not found: ${runId}`)
          }
          return jsonResponse(run)
        }

        if (request.method === 'GET' && isGoalRoute(parts, 'write-traces') && parts.length === 4) {
          const currentGoalKey = requireGoalKey(parts)
          return jsonResponse({
            goalKey: currentGoalKey,
            entries: await writeTraces.listEntries(currentGoalKey, {
              taskRef: stringQuery(url, 'taskRef'),
              runId: stringQuery(url, 'runId'),
              stepId: stringQuery(url, 'stepId'),
              role: roleQuery(url),
              limit: numberQuery(url, 'limit'),
            }),
          })
        }

        if (request.method === 'GET' && isGoalRoute(parts, 'decisions') && parts.length === 4) {
          const currentGoalKey = requireGoalKey(parts)
          return jsonResponse(await decisions.readGoalDecisions(currentGoalKey))
        }

        if (
          request.method === 'GET' &&
          isGoalRoute(parts, 'planning-requests') &&
          parts.length === 5 &&
          parts[4] === 'workflows'
        ) {
          const currentGoalKey = requireGoalKey(parts)
          return jsonResponse({
            goalKey: currentGoalKey,
            workflows: await listGoalPlanningWorkflows(
              {
                boardStore: store,
                planningRequests,
              },
              {
                goalKey: currentGoalKey,
              },
            ),
          })
        }

        if (
          request.method === 'GET' &&
          isGoalRoute(parts, 'planning-requests') &&
          parts.length === 6 &&
          parts[4] === 'workflows'
        ) {
          const currentGoalKey = requireGoalKey(parts)
          const workflowKey = requirePathPart(parts, 5)
          const workflow = await readGoalPlanningWorkflow(
            {
              boardStore: store,
              planningRequests,
            },
            {
              goalKey: currentGoalKey,
              workflowKey,
            },
          )
          if (!workflow) {
            throw new HttpError(404, `Planning workflow not found: ${workflowKey}`)
          }
          return jsonResponse(workflow)
        }

        if (
          request.method === 'GET' &&
          isGoalRoute(parts, 'planning-requests') &&
          parts.length === 4
        ) {
          const currentGoalKey = requireGoalKey(parts)
          return jsonResponse(await planningRequests.readGoalPlanningRequests(currentGoalKey))
        }

        if (request.method === 'POST' && isGoalRoute(parts, 'decisions') && parts.length === 4) {
          const currentGoalKey = requireGoalKey(parts)
          const body = await parseJsonBody(request, createDecisionSchema)
          const result = await requestGoalDecision(
            {
              boardStore: store,
              decisions,
              planningRequests,
            },
            {
              goalKey: currentGoalKey,
              decisionKey: body.decisionKey,
              summary: body.summary,
              taskRef: body.taskRef,
              writer: 'api',
              reason: `api request decision ${body.decisionKey ?? body.summary}`,
            },
          )
          broadcast({ type: 'decisions_changed', goalKey: currentGoalKey })
          if (result.blockerAdded) {
            broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          }
          return jsonResponse(result.decision, result.created ? 201 : 200)
        }

        if (
          request.method === 'POST' &&
          isGoalRoute(parts, 'decisions') &&
          parts.length === 5 &&
          parts[4] === 'answer'
        ) {
          const currentGoalKey = requireGoalKey(parts)
          const body = await parseJsonBody(request, answerDecisionSchema)
          const sourceResponseState = createInterpretedSourceResponseState(
            body.sourceResponse,
            body.sourceResponseFormat,
          )
          const answers = materializeInterpretedDecisionAnswers(
            [
              {
                summary: body.summary,
                decisionKey: body.decisionKey,
                taskRef: body.taskRef,
                answer: body.answer,
                sourceExcerpt: body.sourceExcerpt,
                answerSourceKey: body.answerSourceKey,
              },
            ],
            body.sourceResponse,
            body.answerSources,
            body.sourceResponseFormat,
            sourceResponseState,
            listInterpretableFollowThroughAnswerSummaries(body.followThrough).map((summary) => [
              summary,
            ]),
          )
          const firstAnswer = answers[0]
          if (!firstAnswer) {
            throw new HttpError(400, 'Expected one decision answer.')
          }
          const result = await answerGoalDecision(
            {
              boardStore: store,
              decisions,
              planningRequests,
            },
            {
              goalKey: currentGoalKey,
              decisionKey: firstAnswer.decisionKey,
              summary: firstAnswer.summary,
              taskRef: firstAnswer.taskRef,
              answer: firstAnswer.answer,
              followThrough: materializeInterpretedDecisionFollowThrough(
                body.followThrough,
                body.sourceResponse,
                body.answerSources,
                body.sourceResponseFormat,
                sourceResponseState,
              ),
              writer: 'api',
              reason: `api record answer ${body.decisionKey ?? body.summary}`,
            },
          )
          broadcast({ type: 'decisions_changed', goalKey: currentGoalKey })
          if (result.followThrough) {
            broadcast({ type: 'planning_requests_changed', goalKey: currentGoalKey })
          }
          if (result.blockerRemoved || result.followThrough) {
            broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          }
          return jsonResponse(result, result.created ? 201 : 200)
        }

        if (
          request.method === 'POST' &&
          isGoalRoute(parts, 'decisions') &&
          parts.length === 5 &&
          parts[4] === 'answers'
        ) {
          const currentGoalKey = requireGoalKey(parts)
          const body = await parseJsonBody(request, answerDecisionBatchSchema)
          const current = await decisions.readGoalDecisions(currentGoalKey)
          const sourceResponseState = createInterpretedSourceResponseState(
            body.sourceResponse,
            body.sourceResponseFormat,
          )
          const answers = materializeInterpretedDecisionAnswerBatch(
            body.answers,
            current.decisions
              .filter((decision) => decision.status === 'open')
              .map((decision) => ({
                decisionKey: decision.decisionKey,
                summary: decision.summary,
                taskRef: decision.taskRef,
              })),
            body.inferOpenDecisions ?? false,
            body.sourceResponse,
            body.answerSources,
            body.sourceResponseFormat,
            sourceResponseState,
            body.inferDecisionTopics ?? false,
            current.decisions.map((decision) => ({
              decisionKey: decision.decisionKey,
              summary: decision.summary,
              taskRef: decision.taskRef,
            })),
            listInterpretableFollowThroughAnswerSummaries(body.followThrough),
          )
          const result = await answerGoalDecisions(
            {
              boardStore: store,
              decisions,
              planningRequests,
            },
            {
              goalKey: currentGoalKey,
              answers,
              followThrough: materializeInterpretedDecisionFollowThrough(
                body.followThrough,
                body.sourceResponse,
                body.answerSources,
                body.sourceResponseFormat,
                sourceResponseState,
              ),
              writer: 'api',
              reason: `api record answers ${answers
                .map((answer) => answer.decisionKey ?? answer.summary)
                .join(', ')}`,
            },
          )
          broadcast({ type: 'decisions_changed', goalKey: currentGoalKey })
          if (result.followThrough) {
            broadcast({ type: 'planning_requests_changed', goalKey: currentGoalKey })
          }
          if (result.blockerRemoved || result.followThrough) {
            broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          }
          return jsonResponse(result, result.createdDecisionKeys.length > 0 ? 201 : 200)
        }

        if (
          request.method === 'POST' &&
          isGoalRoute(parts, 'decisions') &&
          parts.length === 6 &&
          parts[5] === 'resolve'
        ) {
          const currentGoalKey = requireGoalKey(parts)
          const decisionKey = requirePathPart(parts, 4)
          const body = await parseJsonBody(request, resolveDecisionSchema)
          const current = await decisions.readGoalDecisions(currentGoalKey)
          if (!current.decisions.some((item) => item.decisionKey === decisionKey)) {
            throw new HttpError(404, `Decision not found: ${decisionKey}`)
          }
          const sourceResponseState = createInterpretedSourceResponseState(
            body.sourceResponse,
            body.sourceResponseFormat,
          )
          const materializedAnswers = materializeInterpretedDecisionAnswers(
            [
              {
                summary: body.summary ?? `Decision: ${decisionKey}`,
                decisionKey,
                taskRef: body.taskRef,
                answer: body.answer,
                sourceExcerpt: body.sourceExcerpt,
                answerSourceKey: body.answerSourceKey,
              },
            ],
            body.sourceResponse,
            body.answerSources,
            body.sourceResponseFormat,
            sourceResponseState,
            listInterpretableFollowThroughAnswerSummaries(body.followThrough).map((summary) => [
              summary,
            ]),
          )
          const firstAnswer = materializedAnswers[0]
          if (!firstAnswer) {
            throw new HttpError(400, `Expected one decision answer for ${decisionKey}.`)
          }
          const result = await resolveGoalDecision(
            {
              boardStore: store,
              decisions,
              planningRequests,
            },
            {
              goalKey: currentGoalKey,
              decisionKey,
              answer: firstAnswer.answer,
              followThrough: materializeInterpretedDecisionFollowThrough(
                body.followThrough,
                body.sourceResponse,
                body.answerSources,
                body.sourceResponseFormat,
                sourceResponseState,
              ),
              writer: 'api',
              reason: `api resolve decision ${decisionKey}`,
            },
          )
          broadcast({ type: 'decisions_changed', goalKey: currentGoalKey })
          if (result.followThrough) {
            broadcast({ type: 'planning_requests_changed', goalKey: currentGoalKey })
          }
          if (result.blockerRemoved || result.followThrough) {
            broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          }
          return jsonResponse(result)
        }

        if (
          request.method === 'POST' &&
          isGoalRoute(parts, 'planning-requests') &&
          parts.length === 5 &&
          parts[4] === 'workflows'
        ) {
          const currentGoalKey = requireGoalKey(parts)
          const body = await parseJsonBody(request, createPlanningWorkflowBatchSchema)
          const result = await requestGoalPlanningWorkflows(
            {
              boardStore: store,
              planningRequests,
            },
            {
              goalKey: currentGoalKey,
              workflowKey: body.workflowKey,
              reuseTaskRef: body.reuseTaskRef,
              reuseGroupKey: body.reuseGroupKey,
              decisionRefs: body.decisionRefs,
              answers: body.answers,
              workflows: body.workflows,
              writer: 'api',
              reason: 'api request planning workflows',
            },
          )
          broadcast({ type: 'planning_requests_changed', goalKey: currentGoalKey })
          broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          return jsonResponse(result, result.createdRequestKeys.length > 0 ? 201 : 200)
        }

        if (
          request.method === 'POST' &&
          isGoalRoute(parts, 'planning-requests') &&
          parts.length === 4
        ) {
          const currentGoalKey = requireGoalKey(parts)
          const body = await parseJsonBody(request, createPlanningRequestSchema)
          const result = await requestGoalPlanning(
            {
              boardStore: store,
              planningRequests,
            },
            {
              goalKey: currentGoalKey,
              requestKey: body.requestKey,
              groupKey: body.groupKey,
              groupTaskKey: body.groupTaskKey,
              title: body.title,
              description: body.description,
              acceptanceCriteria: body.acceptanceCriteria,
              decisionRefs: body.decisionRefs,
              answers: body.answers,
              requestedUpdates: body.requestedUpdates,
              blockedBy: body.blockedBy,
              writer: 'api',
              reason: `api request planning ${body.requestKey ?? body.title}`,
            },
          )
          broadcast({ type: 'planning_requests_changed', goalKey: currentGoalKey })
          if (result.taskCreated) {
            broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          }
          return jsonResponse(result.request, result.created ? 201 : 200)
        }

        if (
          request.method === 'GET' &&
          parts[0] === 'api' &&
          parts[1] === 'goals' &&
          Boolean(parts[2]) &&
          parts[3] === 'assistant' &&
          parts[4] === 'thread' &&
          parts.length === 5
        ) {
          const currentGoalKey = requireGoalKey(parts)
          return jsonResponse(await assistantThread.readThread(currentGoalKey))
        }

        if (
          request.method === 'GET' &&
          parts[0] === 'api' &&
          parts[1] === 'goals' &&
          Boolean(parts[2]) &&
          parts[3] === 'assistant' &&
          parts[4] === 'runs' &&
          parts.length === 5
        ) {
          const currentGoalKey = requireGoalKey(parts)
          return jsonResponse({
            goalKey: currentGoalKey,
            runs: await assistantRuns.listRuns(currentGoalKey),
          })
        }

        if (
          request.method === 'GET' &&
          parts[0] === 'api' &&
          parts[1] === 'goals' &&
          Boolean(parts[2]) &&
          parts[3] === 'assistant' &&
          parts[4] === 'runs' &&
          parts.length === 7 &&
          parts[6] === 'bundle'
        ) {
          const currentGoalKey = requireGoalKey(parts)
          const assistantRunId = requirePathPart(parts, 5)
          const bundle = await assistantRuns.readBundle(currentGoalKey, assistantRunId)
          if (!bundle) {
            throw new HttpError(404, `Assistant run bundle not found: ${assistantRunId}`)
          }
          return jsonResponse(bundle)
        }

        if (
          request.method === 'GET' &&
          parts[0] === 'api' &&
          parts[1] === 'goals' &&
          Boolean(parts[2]) &&
          parts[3] === 'assistant' &&
          parts[4] === 'runs' &&
          parts.length === 6
        ) {
          const currentGoalKey = requireGoalKey(parts)
          const assistantRunId = requirePathPart(parts, 5)
          const run = await assistantRuns.readRun(currentGoalKey, assistantRunId)
          if (!run) {
            throw new HttpError(404, `Assistant run not found: ${assistantRunId}`)
          }
          return jsonResponse(run)
        }

        if (
          request.method === 'POST' &&
          parts[0] === 'api' &&
          parts[1] === 'goals' &&
          Boolean(parts[2]) &&
          parts[3] === 'assistant' &&
          parts[4] === 'messages' &&
          parts.length === 5
        ) {
          const currentGoalKey = requireGoalKey(parts)
          const body = await parseJsonBody(request, assistantMessageSchema)
          return jsonResponse(
            await assistantThread.appendUserMessage(currentGoalKey, body.content),
            201,
          )
        }

        if (
          request.method === 'POST' &&
          parts[0] === 'api' &&
          parts[1] === 'goals' &&
          Boolean(parts[2]) &&
          parts[3] === 'assistant' &&
          parts[4] === 'run' &&
          parts.length === 5
        ) {
          const currentGoalKey = requireGoalKey(parts)
          if (!(await assistantRuntime.isConfigured())) {
            throw new HttpError(409, 'Goal assistant is not configured.')
          }
          const body = await parseJsonBody(request, assistantRunSchema)
          const result = await assistantRuntime.run({
            goalKey: currentGoalKey,
            content: body.content,
          })
          broadcast({ type: 'assistant_changed', goalKey: currentGoalKey })
          if (
            result.actionResults.some(
              (actionResult) =>
                actionResult.kind === 'request_decision' ||
                actionResult.kind === 'resolve_decision' ||
                actionResult.kind === 'record_answer' ||
                actionResult.kind === 'record_answers',
            )
          ) {
            broadcast({ type: 'decisions_changed', goalKey: currentGoalKey })
          }
          broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          if (
            result.actionResults.some(
              (actionResult) =>
                actionResult.kind === 'request_planning' ||
                actionResult.kind === 'request_planning_batch' ||
                actionResult.kind === 'request_planning_workflows' ||
                ((actionResult.kind === 'resolve_decision' ||
                  actionResult.kind === 'record_answer' ||
                  actionResult.kind === 'record_answers') &&
                  (actionResult.followThrough?.requestKeys.length ?? 0) > 0),
            )
          ) {
            broadcast({ type: 'planning_requests_changed', goalKey: currentGoalKey })
          }
          if (
            result.actionResults.some(
              (actionResult) =>
                actionResult.kind === 'record_preference' ||
                actionResult.kind === 'update_preference',
            )
          ) {
            broadcast({ type: 'preferences_changed' })
          }
          return jsonResponse(result)
        }

        if (request.method === 'POST' && isGoalRoute(parts, 'tasks') && parts.length === 4) {
          const currentGoalKey = requireGoalKey(parts)
          const body = await parseJsonBody(request, createTaskSchema)
          await store.mutateBoard(currentGoalKey, 'api', `create ${body.ref}`, (board) => {
            if (board.items.some((task) => task.ref === body.ref)) {
              throw new HttpError(409, `Task already exists: ${body.ref}`)
            }

            board.items.push({
              ...body,
              blockedBy: body.blockedBy ?? [],
              status: 'planned',
            })
          })
          broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          return jsonResponse(await store.readBoard(currentGoalKey), 201)
        }

        if (
          request.method === 'POST' &&
          isGoalRoute(parts, 'tasks') &&
          parts.length === 6 &&
          parts[5] === 'move'
        ) {
          const currentGoalKey = requireGoalKey(parts)
          const body = await parseJsonBody(request, moveTaskSchema)
          const taskRef = requirePathPart(parts, 4)
          await store.mutateBoard(
            currentGoalKey,
            'api',
            body.reason ?? 'manual transition',
            (board) => {
              const task = board.items.find((item) => item.ref === taskRef)
              if (!task) {
                throw new HttpError(404, `Task not found: ${taskRef}`)
              }
              task.status = body.status
            },
          )
          broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          return jsonResponse(await store.readBoard(currentGoalKey))
        }

        if (request.method === 'POST' && isGoalRoute(parts, 'reconcile')) {
          const currentGoalKey = requireGoalKey(parts)
          const result = await reconcileOnce({
            goalKey: currentGoalKey,
            store,
            planningRequests,
            attempts,
            history,
            runner,
            writer: 'api',
          })
          broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          return jsonResponse(result)
        }

        return jsonResponse({ error: 'Not found' }, 404)
      } catch (error) {
        if (error instanceof HttpError) {
          return jsonResponse({ error: error.message }, error.status)
        }
        if (error instanceof GoalAssistantNotConfiguredError) {
          return jsonResponse({ error: error.message }, 409)
        }
        if (error instanceof AnswerInterpretationError) {
          return jsonResponse({ error: error.message }, 400)
        }
        if (error instanceof PreferenceStoreError) {
          return jsonResponse({ error: error.message }, 400)
        }

        const correlationId = crypto.randomUUID()
        if (goalKey) {
          await store
            .appendEvent(goalKey, {
              writer: 'api',
              action: 'system_error',
              goalKey,
              systemError: {
                kind: 'route_error',
                message: errorMessage(error),
                correlationId,
              },
            })
            .catch(() => undefined)
        }

        return jsonResponse({ error: 'Internal server error', correlationId }, 500)
      }
    },
  })
}

function createDefaultRunner(rootDir: string): AgentRunner {
  const paths = createProjectPaths(rootDir)
  if (existsSync(paths.adapterConfigPath())) {
    return new ConfiguredRoleProcessRunner({ rootDir })
  }

  return new MockAgentRunner()
}

function isGoalRoute(parts: string[], leaf: string) {
  return parts[0] === 'api' && parts[1] === 'goals' && Boolean(parts[2]) && parts[3] === leaf
}

function routeGoalKey(parts: string[]) {
  return parts[0] === 'api' && parts[1] === 'goals' ? parts[2] : undefined
}

function requireGoalKey(parts: string[]) {
  return requirePathPart(parts, 2)
}

function requirePathPart(parts: string[], index: number) {
  const value = parts[index]
  if (!value) {
    throw new HttpError(404, 'Not found')
  }
  return value
}

async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new HttpError(400, 'Invalid request body')
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request body')
  }
  return parsed.data
}

function stringQuery(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim()
  return value ? value : undefined
}

function numberQuery(url: URL, key: string) {
  const value = stringQuery(url, key)
  if (!value) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, `Invalid query parameter: ${key}`)
  }
  return parsed
}

function roleQuery(url: URL) {
  const value = stringQuery(url, 'role')
  if (!value) {
    return undefined
  }

  const parsed = z.enum(['planner', 'generator', 'reviewer', 'merger']).safeParse(value)
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid query parameter: role')
  }
  return parsed.data
}

function eventsResponse(clients: Set<EventClient>) {
  let client: EventClient | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = controller
      clients.add(controller)
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'))
    },
    cancel() {
      if (client) {
        clients.delete(client)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

if (import.meta.main) {
  const server = createServer({ rootDir: join(import.meta.dir, '..', '..', '..') })
  console.log(`[API] Server listening on http://localhost:${server.port}`)
}
