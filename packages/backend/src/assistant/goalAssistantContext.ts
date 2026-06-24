import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stringifyBoardYaml } from '../domain/validation'
import {
  type AssistantThreadStore,
  createAssistantThreadStore,
} from '../runtime/assistantThreadStore'
import { type GoalDocsStore, createGoalDocsStore } from '../runtime/goalDocsStore'
import type { RoleProcessContextBundle } from '../runtime/roleProcessContext'
import { type RunHistoryStore, createRunHistoryStore } from '../runtime/runHistoryStore'
import { type WriteTraceStore, createWriteTraceStore } from '../runtime/writeTraceStore'
import { type BoardStore, createBoardStore } from '../storage/boardStore'
import { type DecisionStore, createDecisionStore } from '../storage/decisionStore'
import type { GoalAttachmentRef } from '../storage/goalAttachmentStore'
import { createProjectPaths } from '../storage/paths'
import {
  type PlanningRequestStore,
  createPlanningRequestStore,
} from '../storage/planningRequestStore'
import { type PreferenceStore, createPreferenceStore } from '../storage/preferenceStore'
import { renderAssistantContext, renderAssistantPrompt } from './goalAssistantRendering'

export interface PrepareGoalAssistantBundleOptions {
  goalKey: string
  assistantRunId: string
  attachments?: GoalAttachmentRef[]
}

export interface GoalAssistantContextBuilder {
  prepareBundle(options: PrepareGoalAssistantBundleOptions): Promise<RoleProcessContextBundle>
}

export function createGoalAssistantContextBuilder(
  rootDir = process.cwd(),
  boardStore: BoardStore = createBoardStore(rootDir),
  decisions: DecisionStore = createDecisionStore(rootDir),
  planningRequests: PlanningRequestStore = createPlanningRequestStore(rootDir),
  preferences: PreferenceStore = createPreferenceStore(rootDir),
  threadStore: AssistantThreadStore = createAssistantThreadStore(rootDir),
  goalDocs: GoalDocsStore = createGoalDocsStore(rootDir),
  history: RunHistoryStore = createRunHistoryStore(rootDir),
  writeTraces: WriteTraceStore = createWriteTraceStore(rootDir),
): GoalAssistantContextBuilder {
  const paths = createProjectPaths(rootDir)

  return {
    async prepareBundle(options) {
      const board = await boardStore.readBoard(options.goalKey)
      const docs = await goalDocs.ensureGoalDocs(options.goalKey, board.goal.title)
      await decisions.ensureGoalDecisions(options.goalKey)
      await planningRequests.ensureGoalPlanningRequests(options.goalKey)
      const preferenceDocument = await preferences.readPreferences()
      const thread = await threadStore.readThread(options.goalKey)
      const runs = await history.listRuns(options.goalKey)
      const traces = await writeTraces.listEntries(options.goalKey, { limit: 8 })
      const contextFile = paths.assistantContextPath(options.goalKey, options.assistantRunId)
      const promptFile = paths.assistantPromptPath(options.goalKey, options.assistantRunId)
      const outcomeFile = paths.assistantOutcomePath(options.goalKey, options.assistantRunId)
      const browserHarnessDir = 'scripts/hopi/browser-harness'
      const browserHarnessArtifactDir = join(
        paths.assistantRunDir(options.goalKey, options.assistantRunId),
        'browser-harness',
      )

      await mkdir(dirname(contextFile), { recursive: true })
      const context = renderAssistantContext({
        goalKey: options.goalKey,
        boardYaml: stringifyBoardYaml(board),
        goalFile: docs.goalFile,
        designFile: docs.designFile,
        todoFile: paths.todoPath(options.goalKey),
        decisionsFile: paths.decisionsPath(options.goalKey),
        decisionsContent: await Bun.file(paths.decisionsPath(options.goalKey)).text(),
        planningRequestsFile: paths.planningRequestsPath(options.goalKey),
        planningRequestsContent: await Bun.file(paths.planningRequestsPath(options.goalKey)).text(),
        preferenceFile: preferenceDocument.path,
        preferenceContent: preferenceDocument.content,
        preferenceEntries: preferenceDocument.entries,
        threadEntries: thread.entries.slice(-12),
        runSummaries: runs.slice(0, 6),
        traces,
        attachments: options.attachments ?? [],
        outcomeFile,
      })

      await Bun.write(contextFile, context)
      await Bun.write(
        promptFile,
        renderAssistantPrompt({
          context,
          outcomeFile,
        }),
      )
      await Bun.write(outcomeFile, '')

      return {
        projectRoot: rootDir,
        goalFile: docs.goalFile,
        designFile: docs.designFile,
        contextFile,
        promptFile,
        outcomeFile,
        canonicalOutcomeFile: outcomeFile,
        browserHarnessDir,
        browserHarnessArtifactDir,
        canonicalBrowserHarnessArtifactDir: browserHarnessArtifactDir,
        imageFiles: (options.attachments ?? []).map((attachment) =>
          paths.goalAssetPath(options.goalKey, attachment.assetPath),
        ),
      }
    },
  }
}
