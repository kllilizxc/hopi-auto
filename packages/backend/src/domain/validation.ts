import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { BLOCKER_KINDS, TASK_KINDS, TASK_STATUSES, type TaskStatus, type TodoBoard } from './board'
import { normalizeGoalAttachmentAssetPath } from '../storage/goalAttachmentStore'

const LEGACY_TASK_STATUS_ALIASES: ReadonlyMap<string, TaskStatus> = new Map([
  ['pending', 'planned'],
])

const BlockerRefSchema = z.object({
  kind: z.enum(BLOCKER_KINDS),
  ref: z.string().min(1),
})

const TaskAttachmentAssetPathsSchema = z
  .array(z.string().min(1))
  .optional()
  .transform((values, ctx) => {
    if (!values) {
      return undefined
    }

    const normalized: string[] = []
    const seen = new Set<string>()
    for (const value of values) {
      try {
        const assetPath = normalizeGoalAttachmentAssetPath(value)
        if (seen.has(assetPath)) {
          continue
        }
        normalized.push(assetPath)
        seen.add(assetPath)
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            error instanceof Error ? error.message : 'Invalid Goal attachment asset path',
        })
        return z.NEVER
      }
    }
    return normalized
  })

const TaskItemSchema = z.object({
  ref: z.string().min(1),
  kind: z.enum(TASK_KINDS),
  status: z.preprocess(
    (value) =>
      typeof value === 'string' ? LEGACY_TASK_STATUS_ALIASES.get(value.trim()) ?? value : value,
    z.enum(TASK_STATUSES),
  ),
  title: z.string().min(1),
  description: z.string().default(''),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  blockedBy: z.array(BlockerRefSchema).default([]),
  attachmentAssetPaths: TaskAttachmentAssetPathsSchema,
})

const TodoBoardSchema = z.object({
  version: z.literal(1).default(1),
  goal: z.object({
    goalKey: z.string().min(1),
    title: z.string().min(1),
  }),
  items: z.array(TaskItemSchema).default([]),
})

export function parseBoardYaml(source: string): TodoBoard {
  const raw = parse(source)
  return validateBoard(raw)
}

export function validateBoard(input: unknown): TodoBoard {
  const result = TodoBoardSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid todo.yml format: ${issues}`)
  }

  const refs = new Set<string>()
  for (const item of result.data.items) {
    if (refs.has(item.ref)) {
      throw new Error(`Duplicate task ref found: ${item.ref}`)
    }
    refs.add(item.ref)
  }

  for (const item of result.data.items) {
    for (const blocker of item.blockedBy) {
      if (blocker.kind === 'task' && !refs.has(blocker.ref)) {
        throw new Error(`Task '${item.ref}' is blocked by unknown task '${blocker.ref}'`)
      }
    }
  }

  assertNoTaskBlockerCycles(result.data)
  return result.data
}

export function stringifyBoardYaml(board: TodoBoard): string {
  return stringify(validateBoard(board), { indent: 2 })
}

function assertNoTaskBlockerCycles(board: TodoBoard) {
  const byRef = new Map(board.items.map((item) => [item.ref, item]))

  const visit = (ref: string, path: string[]) => {
    if (path.includes(ref)) {
      throw new Error(`Task blocker cycle detected: ${[...path, ref].join(' -> ')}`)
    }

    const item = byRef.get(ref)
    if (!item) return

    for (const blocker of item.blockedBy) {
      if (blocker.kind === 'task') {
        visit(blocker.ref, [...path, ref])
      }
    }
  }

  for (const item of board.items) {
    visit(item.ref, [])
  }
}
