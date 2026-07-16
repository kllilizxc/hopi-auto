import { STABLE_ID_SOURCE } from './stableId'

const projectTargetPattern = new RegExp(`^project:(${STABLE_ID_SOURCE})$`, 'u')
const workTargetPattern = new RegExp(
  `^project:(${STABLE_ID_SOURCE})/goal:(${STABLE_ID_SOURCE})/work:(${STABLE_ID_SOURCE})$`,
  'u',
)

export type GoalAttentionTargetMatch = { scope: 'goal' } | { scope: 'work'; workId: string }

export function projectAttentionTarget(projectId: string) {
  return `project:${projectId}`
}

export function parseProjectAttentionTarget(target: string) {
  const match = projectTargetPattern.exec(target)
  if (!match?.[1]) return null
  return { projectId: match[1] }
}

export function goalAttentionTarget(projectId: string, goalId: string) {
  return `${projectAttentionTarget(projectId)}/goal:${goalId}`
}

export function workAttentionTarget(projectId: string, goalId: string, workId: string) {
  return `${goalAttentionTarget(projectId, goalId)}/work:${workId}`
}

export function matchGoalAttentionTarget(
  projectId: string,
  goalId: string,
  target: string,
): GoalAttentionTargetMatch | null {
  const goalTarget = goalAttentionTarget(projectId, goalId)
  if (target === goalTarget) return { scope: 'goal' }
  const work = parseWorkAttentionTarget(target)
  if (!work || work.projectId !== projectId || work.goalId !== goalId) return null
  return { scope: 'work', workId: work.workId }
}

export function parseWorkAttentionTarget(target: string) {
  const match = workTargetPattern.exec(target)
  if (!match?.[1] || !match[2] || !match[3]) return null
  return { projectId: match[1], goalId: match[2], workId: match[3] }
}
