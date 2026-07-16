import { join, resolve } from 'node:path'
import { normalizeProjectPath, scopedProjectPath } from '../domain/projectPath'
import type { PublicationRoot } from '../publication/types'

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface GoalPackagePaths {
  projectId: string
  projectRoot: string
  projectPath: string
  agentsPath: string
  preparePath: string
  publicationRoot: PublicationRoot
  goalsRoot: string
  goalRoot(goalId: string): string
  goalDocument(goalId: string): string
  assetsRoot(goalId: string): string
  asset(goalId: string, contentHash: string, fileName: string): string
  designRoot(goalId: string): string
  designIndex(goalId: string): string
  workRoot(goalId: string): string
  workDocument(goalId: string, workId: string): string
  attentionRoot(goalId: string): string
  attentionDocument(goalId: string, attentionId: string): string
  evidenceRoot(goalId: string): string
  evidenceDocument(goalId: string, evidenceId: string): string
  inputsRoot(goalId: string): string
  inputDocument(goalId: string, sourceHomeId: string, eventId: string): string
  absolute(relativePath: string): string
}

export function createGoalPackagePaths(
  projectRoot: string,
  projectId: string,
  projectPath?: string,
): GoalPackagePaths {
  assertStableId(projectId, 'projectId')
  const absoluteProjectRoot = resolve(projectRoot)
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  const goalsRoot = '.hopi/docs/goals'

  return {
    projectId,
    projectRoot: absoluteProjectRoot,
    projectPath: normalizedProjectPath,
    agentsPath: scopedProjectPath(normalizedProjectPath, 'AGENTS.md'),
    preparePath: scopedProjectPath(normalizedProjectPath, 'scripts/hopi/prepare'),
    publicationRoot: { id: `project:${projectId}`, path: absoluteProjectRoot },
    goalsRoot,
    goalRoot(goalId) {
      assertStableId(goalId, 'goalId')
      return `${goalsRoot}/${goalId}`
    },
    goalDocument(goalId) {
      return `${this.goalRoot(goalId)}/goal.md`
    },
    assetsRoot(goalId) {
      return `${this.goalRoot(goalId)}/assets`
    },
    asset(goalId, contentHash, fileName) {
      if (!contentHash.match(/^[a-f0-9]{64}$/))
        throw new Error(`Invalid contentHash: ${contentHash}`)
      if (!fileName.match(/^[A-Za-z0-9][A-Za-z0-9._-]*$/))
        throw new Error(`Invalid fileName: ${fileName}`)
      return `${this.assetsRoot(goalId)}/${contentHash}/${fileName}`
    },
    designRoot(goalId) {
      return `${this.goalRoot(goalId)}/design`
    },
    designIndex(goalId) {
      return `${this.designRoot(goalId)}/index.md`
    },
    workRoot(goalId) {
      return `${this.goalRoot(goalId)}/work`
    },
    workDocument(goalId, workId) {
      assertStableId(workId, 'workId')
      return `${this.workRoot(goalId)}/${workId}.md`
    },
    attentionRoot(goalId) {
      return `${this.goalRoot(goalId)}/attention`
    },
    attentionDocument(goalId, attentionId) {
      assertStableId(attentionId, 'attentionId')
      return `${this.attentionRoot(goalId)}/${attentionId}.md`
    },
    evidenceRoot(goalId) {
      return `${this.goalRoot(goalId)}/evidence`
    },
    evidenceDocument(goalId, evidenceId) {
      assertStableId(evidenceId, 'evidenceId')
      return `${this.evidenceRoot(goalId)}/${evidenceId}.md`
    },
    inputsRoot(goalId) {
      return `${this.goalRoot(goalId)}/inputs`
    },
    inputDocument(goalId, sourceHomeId, eventId) {
      assertStableId(sourceHomeId, 'sourceHomeId')
      assertStableId(eventId, 'eventId')
      return `${this.inputsRoot(goalId)}/${sourceHomeId}/${eventId}.md`
    },
    absolute(relativePath) {
      return join(absoluteProjectRoot, ...relativePath.split('/'))
    },
  }
}

function assertStableId(value: string, label: string) {
  if (!STABLE_ID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
}
