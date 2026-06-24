import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentRole } from '../agent/AgentRunner'
import type { TaskItem } from '../domain/board'
import { stringifyBoardYaml } from '../domain/validation'
import { type BoardStore, createBoardStore } from '../storage/boardStore'
import {
  type DecisionStore,
  type GoalDecision,
  createDecisionStore,
} from '../storage/decisionStore'
import { normalizeGoalAttachmentAssetPath } from '../storage/goalAttachmentStore'
import { createProjectPaths } from '../storage/paths'
import {
  type GoalPlanningRequest,
  type PlanningRequestStore,
  createPlanningRequestStore,
} from '../storage/planningRequestStore'
import { type PreferenceStore, createPreferenceStore } from '../storage/preferenceStore'
import {
  type MergeScriptAttemptRecord,
  PROJECT_MERGE_SCRIPT_RELATIVE_PATH,
  mergeScriptAttemptPath,
  readProjectMergeScript,
} from './gitMergeExecutor'
import { type GoalDocsStore, createGoalDocsStore } from './goalDocsStore'
import { summarizePlanningFollowThroughEvidence } from './planningFollowThroughEvidence'
import {
  type LatestReviewerFeedback,
  type MergeScriptDiagnostics,
  type PlannerContextInputs,
  type RelevantGoalImage,
  renderContextMarkdown,
  renderPromptMarkdown,
} from './roleProcessContextRendering'
import { type RunHistoryStore, createRunHistoryStore } from './runHistoryStore'
import type { GoalWriteTraceEntry } from './writeTrace'
import { type WriteTraceStore, createWriteTraceStore } from './writeTraceStore'

export interface RoleProcessContextBundle {
  projectRoot: string
  goalFile: string
  designFile: string
  extraWritableRoots?: string[]
  contextFile: string
  promptFile: string
  outcomeFile: string
  canonicalOutcomeFile: string
  browserHarnessDir: string
  browserHarnessArtifactDir: string
  canonicalBrowserHarnessArtifactDir: string
  imageFiles?: string[]
}

export interface PrepareRoleProcessBundleOptions {
  goalKey: string
  goalTitle: string
  runId: string
  stepId: string
  role: AgentRole
  task: TaskItem
}

export interface RoleProcessContextBuilder {
  prepareBundle(options: PrepareRoleProcessBundleOptions): Promise<RoleProcessContextBundle>
}

export function createRoleProcessContextBuilder(
  rootDir = process.cwd(),
  goalDocs: GoalDocsStore = createGoalDocsStore(rootDir),
  boardStore: BoardStore = createBoardStore(rootDir),
  decisions: DecisionStore = createDecisionStore(rootDir),
  planningRequests: PlanningRequestStore = createPlanningRequestStore(rootDir),
  preferences: PreferenceStore = createPreferenceStore(rootDir),
  history: RunHistoryStore = createRunHistoryStore(rootDir),
  writeTraces: WriteTraceStore = createWriteTraceStore(rootDir),
): RoleProcessContextBuilder {
  const paths = createProjectPaths(rootDir)

  return {
    async prepareBundle(options) {
      const docs = await goalDocs.ensureGoalDocs(options.goalKey, options.goalTitle)
      const docsSnapshot = await goalDocs.readGoalDocs(options.goalKey, options.goalTitle)
      const contextFile = paths.runtimeContextPath(options.goalKey, options.runId, options.stepId)
      const promptFile = paths.runtimePromptPath(options.goalKey, options.runId, options.stepId)
      const canonicalOutcomeFile = paths.runtimeOutcomePath(
        options.goalKey,
        options.runId,
        options.stepId,
      )
      const worktreeStepDir = join(
        paths.worktreePath(options.goalKey, options.task.ref, options.runId),
        '.hopi-runtime',
        'goals',
        options.goalKey,
        'runs',
        options.runId,
        options.stepId,
      )
      const outcomeFile = join(worktreeStepDir, 'outcome.json')
      const browserHarnessDir = 'scripts/hopi/browser-harness'
      const browserHarnessArtifactDir = join(worktreeStepDir, 'browser-harness')
      const canonicalBrowserHarnessArtifactDir = join(
        paths.runtimeStepDir(options.goalKey, options.runId, options.stepId),
        'browser-harness',
      )

      const relevantTraces = (
        await writeTraces.listEntries(options.goalKey, {
          taskRef: options.task.ref,
          limit: 12,
        })
      ).filter((entry) => entry.stepId !== options.stepId)
      const filteredRelevantTraces = filterRelevantTraces(relevantTraces, options.runId)
      const relevantRunEvidence = await loadRelevantRunEvidence({
        goalKey: options.goalKey,
        runId: options.runId,
        stepId: options.stepId,
        role: options.role,
        task: options.task,
        history,
      })
      const latestReviewerFeedback =
        options.role === 'generator' && options.task.kind === 'engineering'
          ? await loadLatestReviewerFeedback({
              goalKey: options.goalKey,
              taskRef: options.task.ref,
              currentStepId: options.stepId,
              history,
              paths,
            })
          : undefined
      const mergeScriptDiagnostics =
        options.role === 'merger' && options.task.kind === 'engineering'
          ? await loadMergeScriptDiagnostics({
              rootDir,
              goalKey: options.goalKey,
              runId: options.runId,
              stepId: options.stepId,
            })
          : undefined
      const plannerInputs =
        options.task.kind === 'planning'
          ? await loadPlannerContextInputs(
              options.goalKey,
              boardStore,
              decisions,
              planningRequests,
              preferences,
              paths,
              options.task,
              filteredRelevantTraces,
            )
          : undefined
      const relevantGoalImages =
        options.task.kind === 'planning'
          ? (plannerInputs?.relevantGoalImages ?? [])
          : collectTaskGoalImages(options.task, 'task attachmentAssetPaths')
      const imageFiles = await resolveRelevantGoalImageFiles(
        options.goalKey,
        paths,
        relevantGoalImages,
      )
      await mkdir(dirname(contextFile), { recursive: true })
      const context = renderContextMarkdown({
        ...options,
        goalFile: docs.goalFile,
        designFile: docs.designFile,
        outcomeFile,
        browserHarnessDir,
        browserHarnessArtifactDir,
        plannerInputs,
        relevantGoalImages,
        docsStatus: {
          goalStatus: docsSnapshot.goal.status,
          designStatus: docsSnapshot.design.status,
        },
        latestReviewerFeedback,
        mergeScriptDiagnostics,
        relevantRunEvidence,
        relevantTraces: filteredRelevantTraces,
      })
      await Bun.write(contextFile, context)
      await Bun.write(
        promptFile,
        renderPromptMarkdown({
          role: options.role,
          taskKind: options.task.kind,
          docsStatus: {
            goalStatus: docsSnapshot.goal.status,
            designStatus: docsSnapshot.design.status,
          },
          context,
          outcomeFile,
        }),
      )
      await Bun.write(canonicalOutcomeFile, '')

      return {
        projectRoot: rootDir,
        goalFile: docs.goalFile,
        designFile: docs.designFile,
        extraWritableRoots:
          options.role === 'planner' && options.task.kind === 'planning'
            ? [dirname(docs.goalFile)]
            : undefined,
        contextFile,
        promptFile,
        outcomeFile,
        canonicalOutcomeFile,
        browserHarnessDir,
        browserHarnessArtifactDir,
        canonicalBrowserHarnessArtifactDir,
        imageFiles: imageFiles.length > 0 ? imageFiles : undefined,
      }
    },
  }
}

function filterRelevantTraces(entries: GoalWriteTraceEntry[], runId: string) {
  const sanitizedEntries = entries
    .map((entry) => sanitizeTraceEntry(entry))
    .filter((entry): entry is GoalWriteTraceEntry => Boolean(entry))
  const sameRun = sanitizedEntries.filter((entry) => entry.runId === runId)
  const previousTaskEntries = sanitizedEntries.filter((entry) => entry.runId !== runId)
  return [...sameRun, ...previousTaskEntries].slice(0, 6)
}

function sanitizeTraceEntry(entry: GoalWriteTraceEntry): GoalWriteTraceEntry | null {
  const targetPaths = entry.targetPaths.filter(isRelevantTracePath)
  const changes = entry.changes.filter((change) => isRelevantTracePath(change.path))
  if (targetPaths.length === 0 && changes.length === 0) {
    return null
  }

  return {
    ...entry,
    targetPaths,
    changes,
  }
}

function isRelevantTracePath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  if (
    normalized.startsWith('.hopi/runtime/') ||
    normalized.includes('/.hopi/runtime/') ||
    normalized.startsWith('dist/') ||
    normalized.includes('/dist/') ||
    normalized.startsWith('.vite/') ||
    normalized.includes('/.vite/') ||
    normalized.startsWith('node_modules/') ||
    normalized.includes('/node_modules/')
  ) {
    return false
  }

  return true
}

async function loadPlannerContextInputs(
  goalKey: string,
  boardStore: BoardStore,
  decisions: DecisionStore,
  planningRequests: PlanningRequestStore,
  preferences: PreferenceStore,
  paths: ReturnType<typeof createProjectPaths>,
  task: TaskItem,
  relevantTraces: GoalWriteTraceEntry[],
): Promise<PlannerContextInputs> {
  const board = await boardStore.readBoard(goalKey)
  const decisionSet = await decisions.ensureGoalDecisions(goalKey)
  const planningRequestSet = await planningRequests.ensureGoalPlanningRequests(goalKey)
  const preferenceDocument = await preferences.readPreferences()
  const relevantPlanningRequests = planningRequestSet.requests
    .filter((request) => request.status === 'open' && request.taskRef === task.ref)
    .map((request) => ({
      requestKey: request.requestKey,
      workflowKey: request.workflowKey,
      workflowSharedAnswers: request.workflowSharedAnswers,
      workflowTaskKey: request.workflowTaskKey,
      blockedByWorkflowKeys: request.blockedByWorkflowKeys,
      groupKey: request.groupKey,
      groupTaskKey: request.groupTaskKey,
      title: request.title,
      taskRef: request.taskRef,
      decisionRefs: request.decisionRefs,
      answers: request.answers,
      attachments: request.attachments,
      requestedUpdates: request.requestedUpdates,
    }))
  const relatedPlanningGroups = summarizeRelatedPlanningGroups(
    planningRequestSet.requests,
    task.ref,
  )
  const planningFollowThroughEvidence = summarizePlanningFollowThroughEvidence(
    planningRequestSet.requests.filter(
      (request) => request.status === 'open' && request.taskRef === task.ref,
    ),
    relevantTraces,
  )
  const decisionByKey = new Map(
    decisionSet.decisions.map((decision) => [decision.decisionKey, decision] as const),
  )
  const relevantGoalImages = collectPlanningGoalImages(
    task,
    relevantPlanningRequests,
    decisionByKey,
  )

  return {
    goalDocsRoot: dirname(paths.todoPath(goalKey)),
    todoFile: paths.todoPath(goalKey),
    todoContent: stringifyBoardYaml(board),
    decisionsFile: paths.decisionsPath(goalKey),
    decisionsContent: await Bun.file(paths.decisionsPath(goalKey)).text(),
    decisionEntries: decisionSet.decisions,
    planningRequestsFile: paths.planningRequestsPath(goalKey),
    planningRequestsContent: await Bun.file(paths.planningRequestsPath(goalKey)).text(),
    relevantPlanningRequests,
    relatedPlanningGroups,
    planningFollowThroughEvidence: {
      requestedUpdates: planningFollowThroughEvidence.requestedUpdates,
      observedUpdates: planningFollowThroughEvidence.observedUpdates,
      missingUpdates: planningFollowThroughEvidence.missingUpdates,
    },
    preferenceFile: preferenceDocument.path,
    preferenceContent: preferenceDocument.content,
    preferenceEntries: preferenceDocument.entries,
    relevantGoalImages,
  }
}

function collectPlanningGoalImages(
  task: TaskItem,
  requests: PlannerContextInputs['relevantPlanningRequests'],
  decisionByKey: ReadonlyMap<string, GoalDecision>,
) {
  let relevantImages = collectTaskGoalImages(task, 'task attachmentAssetPaths')

  for (const request of requests) {
    relevantImages = mergeRelevantGoalImages(
      relevantImages,
      request.attachments.map((attachment) => ({
        assetPath: attachment.assetPath,
        fileName: attachment.fileName,
        mediaType: attachment.mediaType,
        sources: [`planning request ${request.requestKey}`],
      })),
    )
    for (const decisionKey of request.decisionRefs) {
      const decision = decisionByKey.get(decisionKey)
      if (!decision) {
        continue
      }
      relevantImages = mergeRelevantGoalImages(
        relevantImages,
        decision.attachments.map((attachment) => ({
          assetPath: attachment.assetPath,
          fileName: attachment.fileName,
          mediaType: attachment.mediaType,
          sources: [`decision ${decision.decisionKey}`],
        })),
      )
    }
  }

  return relevantImages
}

function collectTaskGoalImages(task: TaskItem, source: string): RelevantGoalImage[] {
  return (task.attachmentAssetPaths ?? []).map((assetPath) => ({
    assetPath: normalizeGoalAttachmentAssetPath(assetPath),
    sources: [source],
  }))
}

function mergeRelevantGoalImages(
  existing: RelevantGoalImage[],
  incoming: RelevantGoalImage[],
): RelevantGoalImage[] {
  const merged = new Map(
    existing.map((image) => [
      image.assetPath,
      {
        ...image,
        sources: [...image.sources],
      },
    ]),
  )

  for (const image of incoming) {
    const assetPath = normalizeGoalAttachmentAssetPath(image.assetPath)
    const current = merged.get(assetPath)
    if (current) {
      current.fileName ??= image.fileName
      current.mediaType ??= image.mediaType
      current.sources = mergeUniqueStrings([...current.sources, ...image.sources])
      continue
    }
    merged.set(assetPath, {
      assetPath,
      fileName: image.fileName,
      mediaType: image.mediaType,
      sources: mergeUniqueStrings(image.sources),
    })
  }

  return [...merged.values()]
}

async function resolveRelevantGoalImageFiles(
  goalKey: string,
  paths: ReturnType<typeof createProjectPaths>,
  images: RelevantGoalImage[],
) {
  const imageFiles: string[] = []
  for (const image of images) {
    const absolutePath = paths.goalAssetPath(goalKey, image.assetPath)
    if (!(await Bun.file(absolutePath).exists())) {
      throw new Error(`Relevant Goal image not found: ${image.assetPath}`)
    }
    imageFiles.push(absolutePath)
  }
  return imageFiles
}

function summarizeRelatedPlanningGroups(requests: GoalPlanningRequest[], taskRef: string) {
  const currentGroupKeys = mergeUniqueStrings(
    requests
      .filter((request) => request.status === 'open' && request.taskRef === taskRef)
      .map((request) => request.groupKey)
      .filter((groupKey): groupKey is string => Boolean(groupKey)),
  )

  return currentGroupKeys
    .map((groupKey) => ({
      groupKey,
      requests: requests
        .filter(
          (request) =>
            request.status === 'open' &&
            request.groupKey === groupKey &&
            request.taskRef !== taskRef,
        )
        .map((request) => ({
          requestKey: request.requestKey,
          groupTaskKey: request.groupTaskKey,
          taskRef: request.taskRef,
          title: request.title,
          decisionRefs: request.decisionRefs,
          workflowSharedAnswers: request.workflowSharedAnswers,
          answers: request.answers,
          requestedUpdates: request.requestedUpdates,
        })),
    }))
    .filter((group) => group.requests.length > 0)
}

function mergeUniqueStrings(values: string[]) {
  const merged: string[] = []
  for (const value of values) {
    if (!merged.includes(value)) {
      merged.push(value)
    }
  }
  return merged
}

async function loadRelevantRunEvidence(options: {
  goalKey: string
  runId: string
  stepId: string
  role: AgentRole
  task: TaskItem
  history: RunHistoryStore
}) {
  if (
    options.task.kind !== 'engineering' ||
    (options.role !== 'reviewer' && options.role !== 'merger')
  ) {
    return []
  }

  const goalHistory = await options.history.readGoalHistory(options.goalKey)
  const currentRun = goalHistory.runs.find((run) => run.runId === options.runId)
  const otherRuns = goalHistory.runs
    .filter((run) => run.taskRef === options.task.ref && run.runId !== options.runId)
    .toReversed()
  const orderedRuns = [...(currentRun ? [currentRun] : []), ...otherRuns]

  return orderedRuns
    .flatMap((run) =>
      run.steps
        .filter((step) => step.stepId !== options.stepId)
        .filter(
          (step) =>
            Boolean(step.execution?.worktree) ||
            (step.execution?.artifacts.length ?? 0) > 0 ||
            step.transcript.length > 0,
        )
        .map((step) => ({
          runId: run.runId,
          stepId: step.stepId,
          role: step.role,
          outcome: step.outcome,
          artifacts: step.execution?.artifacts ?? [],
          transcriptSummaries: summarizeTranscriptEvidence(step.transcript).slice(0, 4),
          worktreePath: step.execution?.worktree?.path,
        })),
    )
    .slice(0, 6)
}

async function loadLatestReviewerFeedback(options: {
  goalKey: string
  taskRef: string
  currentStepId: string
  history: RunHistoryStore
  paths: ReturnType<typeof createProjectPaths>
}): Promise<LatestReviewerFeedback | undefined> {
  const goalHistory = await options.history.readGoalHistory(options.goalKey)
  const latestRejectedReviewer = goalHistory.runs
    .filter((run) => run.taskRef === options.taskRef)
    .flatMap((run) =>
      run.steps
        .filter((step) => step.role === 'reviewer' && step.outcome === 'reject')
        .filter((step) => step.stepId !== options.currentStepId)
        .map((step) => ({
          runId: run.runId,
          step,
        })),
    )
    .sort((left, right) =>
      (right.step.endedAt ?? right.step.startedAt).localeCompare(
        left.step.endedAt ?? left.step.startedAt,
      ),
    )[0]

  if (!latestRejectedReviewer) {
    return undefined
  }

  const outcome = await readRuntimeOutcome(
    options.paths.runtimeOutcomePath(
      options.goalKey,
      latestRejectedReviewer.runId,
      latestRejectedReviewer.step.stepId,
    ),
  )
  const reason =
    outcome?.reason?.trim() ||
    latestRejectedReviewer.step.messages.at(-1)?.content ||
    'The latest reviewer pass rejected the prior generator attempt.'

  return {
    runId: latestRejectedReviewer.runId,
    stepId: latestRejectedReviewer.step.stepId,
    rejectedAt: latestRejectedReviewer.step.endedAt ?? latestRejectedReviewer.step.startedAt,
    reason,
    artifactRef: outcome?.artifactRef,
    artifactLabel: outcome?.artifactLabel,
  }
}

async function loadMergeScriptDiagnostics(options: {
  rootDir: string
  goalKey: string
  runId: string
  stepId: string
}): Promise<MergeScriptDiagnostics | undefined> {
  const attemptPath = mergeScriptAttemptPath(options.rootDir, options)
  const attemptFile = Bun.file(attemptPath)
  if (!(await attemptFile.exists())) {
    return undefined
  }

  try {
    const latestAttempt = JSON.parse(await attemptFile.text()) as MergeScriptAttemptRecord
    const scriptPath =
      latestAttempt.scriptPath || join(options.rootDir, PROJECT_MERGE_SCRIPT_RELATIVE_PATH)
    const scriptContent = await readProjectMergeScript(scriptPath)
    if (!scriptContent) {
      return undefined
    }

    return {
      scriptPath,
      scriptContent,
      latestAttempt,
    }
  } catch {
    return undefined
  }
}

async function readRuntimeOutcome(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return null
  }

  try {
    const raw = JSON.parse(await file.text()) as {
      kind?: string
      reason?: string
      artifactRef?: string
      artifactLabel?: string
    }
    return raw
  } catch {
    return null
  }
}

function summarizeTranscriptEvidence(
  entries: Array<{
    kind: 'status' | 'assistant' | 'tool_call' | 'tool_result' | 'error'
    summary: string
    toolName?: string
    toolInvocationKey?: string
  }>,
) {
  const summaries: string[] = []
  const interactions = new Map<
    string,
    {
      toolName?: string
      callSummary?: string
      resultSummaries: string[]
    }
  >()
  const orderedKeys: string[] = []

  for (const entry of entries) {
    if (entry.toolInvocationKey && (entry.kind === 'tool_call' || entry.kind === 'tool_result')) {
      const current = interactions.get(entry.toolInvocationKey)
      if (!current) {
        interactions.set(entry.toolInvocationKey, {
          toolName: entry.toolName,
          callSummary: entry.kind === 'tool_call' ? entry.summary : undefined,
          resultSummaries: entry.kind === 'tool_result' ? [entry.summary] : [],
        })
        orderedKeys.push(entry.toolInvocationKey)
      } else {
        current.toolName ??= entry.toolName
        if (entry.kind === 'tool_call') {
          current.callSummary ??= entry.summary
        } else {
          current.resultSummaries.push(entry.summary)
        }
      }
      continue
    }

    summaries.push(entry.summary)
  }

  for (const key of orderedKeys) {
    const interaction = interactions.get(key)
    if (!interaction) {
      continue
    }

    const toolLabel = interaction.callSummary ?? interaction.toolName ?? 'Tool interaction'
    if (interaction.resultSummaries.length > 0) {
      summaries.push(`${toolLabel} [${key}] -> ${interaction.resultSummaries.join(' / ')}`)
      continue
    }

    if (interaction.callSummary) {
      summaries.push(`${interaction.callSummary} [${key}]`)
    }
  }

  return summaries
}
