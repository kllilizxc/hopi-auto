import { mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { TodoBoard } from '../domain/board'
import { stringifyBoardYaml } from '../domain/validation'
import { createBoardStore } from '../storage/boardStore'
import { createProjectPaths } from '../storage/paths'
import { createPlanningRequestStore } from '../storage/planningRequestStore'
import { requestGoalPlanning } from './planningRequest'

export interface CreateGoalInput {
  goalKey: string
  title: string
  objective: string
  successCriteria?: string[]
}

export interface GoalSummary {
  goalKey: string
  title: string
  objective?: string
  createdAt?: string
}

export class GoalScaffoldError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const INITIAL_PLANNING_TASK_REF = 'plan-goal'
const INITIAL_PLANNING_TITLE = 'Plan goal'
const INITIAL_PLANNING_ACCEPTANCE_CRITERIA = [
  'Goal objective is decomposed into actionable work.',
  'Design.md is updated with a durable implementation plan.',
]
const INITIAL_PLANNING_REQUESTED_UPDATES = ['design.md', 'todo.yml']

export async function createGoalScaffold(rootDir: string, input: CreateGoalInput): Promise<GoalSummary> {
  const paths = createProjectPaths(rootDir)
  const goalKey = input.goalKey.trim()
  const goalDir = paths.goalDir(goalKey)

  try {
    await stat(goalDir)
    throw new GoalScaffoldError(409, `Goal already exists: ${goalKey}`)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  await mkdir(goalDir, { recursive: true })
  await Bun.write(paths.goalMarkdownPath(goalKey), renderGoalMarkdown(input))
  await Bun.write(paths.designMarkdownPath(goalKey), renderDesignMarkdown(input))
  await Bun.write(paths.todoPath(goalKey), renderInitialBoardYaml(input))
  await seedInitialPlanningRequest(rootDir, input)

  return {
    goalKey,
    title: input.title.trim(),
    objective: input.objective.trim(),
    createdAt: new Date().toISOString(),
  }
}

export async function listProjectGoals(rootDir: string): Promise<GoalSummary[]> {
  const goalRoot = join(rootDir, '.hopi', 'docs', 'goals')

  let entries: string[]
  try {
    entries = await readdir(goalRoot)
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }
    throw error
  }

  const goals = await Promise.all(
    entries.map(async (goalKey) => {
      const summary = await readGoalSummary(rootDir, goalKey)
      return summary
    }),
  )

  return goals
    .filter((goal): goal is GoalSummary => Boolean(goal))
    .toSorted((left, right) => {
      return Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? '')
    })
}

export async function readGoalSummary(rootDir: string, goalKey: string): Promise<GoalSummary | null> {
  const paths = createProjectPaths(rootDir)
  const goalDir = paths.goalDir(goalKey)
  const goalDirStats = await stat(goalDir).catch(() => null)
  if (!goalDirStats?.isDirectory()) {
    return null
  }

  const goalMarkdown = await Bun.file(paths.goalMarkdownPath(goalKey))
    .text()
    .catch(() => '')
  const boardYaml = await Bun.file(paths.todoPath(goalKey))
    .text()
    .catch(() => '')

  const title =
    extractHeading(goalMarkdown) ||
    extractBoardTitle(boardYaml) ||
    `Goal: ${goalKey}`

  return {
    goalKey,
    title,
    objective: extractBulletValue(goalMarkdown, 'Objective'),
    createdAt: goalDirStats.birthtime.toISOString(),
  }
}

function renderGoalMarkdown(input: CreateGoalInput) {
  const successCriteria =
    input.successCriteria && input.successCriteria.length > 0
      ? input.successCriteria.map((criterion) => criterion.trim()).filter(Boolean).join('; ')
      : 'Not yet recorded.'

  return `# ${input.title.trim()}

- Goal Key: ${input.goalKey.trim()}
- Objective: ${input.objective.trim()}
- Success Criteria: ${successCriteria}
- Current Strategy: Start with the seeded planning task and let the planner replace this bootstrap.
- Open Questions: none recorded yet.
`
}

function renderDesignMarkdown(input: CreateGoalInput) {
  return `# Design: ${input.title.trim()}

## Problem

${input.objective.trim()}

## Goals

- Pending planner output.

## Non-Goals

- This bootstrap file does not claim the design is complete.

## User / Workflow

Pending planner output.

## Architecture

Pending planner output.

## Data Model

Pending planner output.

## Edge Cases

Pending planner output.

## Testing / Acceptance

Pending planner output.

## Open Questions

- Planner should replace this bootstrap content with durable design detail.
`
}

function renderInitialBoardYaml(input: CreateGoalInput) {
  const board: TodoBoard = {
    version: 1,
    goal: {
      goalKey: input.goalKey.trim(),
      title: input.title.trim(),
    },
    items: [
      {
        ref: INITIAL_PLANNING_TASK_REF,
        kind: 'planning',
        status: 'planned',
        title: INITIAL_PLANNING_TITLE,
        description: input.objective.trim(),
        acceptanceCriteria: [...INITIAL_PLANNING_ACCEPTANCE_CRITERIA],
        blockedBy: [],
      },
    ],
  }

  return stringifyBoardYaml(board)
}

async function seedInitialPlanningRequest(rootDir: string, input: CreateGoalInput) {
  await requestGoalPlanning(
    {
      boardStore: createBoardStore(rootDir),
      planningRequests: createPlanningRequestStore(rootDir),
    },
    {
      goalKey: input.goalKey.trim(),
      title: INITIAL_PLANNING_TITLE,
      description: input.objective.trim(),
      acceptanceCriteria: [...INITIAL_PLANNING_ACCEPTANCE_CRITERIA],
      requestedUpdates: [...INITIAL_PLANNING_REQUESTED_UPDATES],
      reuseTaskRef: INITIAL_PLANNING_TASK_REF,
      writer: 'goal_scaffold',
      reason: 'seed bootstrap planning request',
    },
  )
}

function extractHeading(content: string) {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim()
}

function extractBulletValue(content: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = content.match(new RegExp(`^- ${escapedLabel}:\\s+(.+)$`, 'm'))
  return match?.[1]?.trim()
}

function extractBoardTitle(content: string) {
  const match = content.match(/title:\s+(.+)/)
  return match?.[1]?.trim()
}

function isMissingFileError(error: unknown): error is { code: 'ENOENT' } {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
