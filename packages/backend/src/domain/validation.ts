import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { BLOCKER_KINDS, TASK_KINDS, TASK_STATUSES, type TaskStatus, type TodoBoard } from './board'
import { normalizeGoalAttachmentAssetPath } from '../storage/goalAttachmentStore'

const LEGACY_TASK_STATUS_ALIASES: ReadonlyMap<string, TaskStatus> = new Map([
  ['pending', 'planned'],
])

const RESERVED_PLAIN_SCALAR_START = /^[`@]/
const BLOCK_SCALAR_HEADER = /^(\s*(?:-\s+)?[^:#][^:]*:\s*[>|][+-]?)\s*$/
const BLOCK_SCALAR_SEQUENCE_HEADER = /^(\s*-\s*[>|][+-]?)\s*$/
const STRING_LIST_HEADER = /^(\s*)(acceptanceCriteria|attachmentAssetPaths):\s*$/

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
  return parseBoardYamlWithRecovery(source).board
}

export function parseBoardYamlWithRecovery(source: string): {
  board: TodoBoard
  repaired: boolean
} {
  try {
    return {
      board: validateBoard(parse(source)),
      repaired: false,
    }
  } catch (error) {
    const repairedSource = repairReservedPlainScalarStarts(source)
    if (repairedSource === source) {
      throw error
    }

    try {
      return {
        board: validateBoard(parse(repairedSource)),
        repaired: true,
      }
    } catch {
      throw error
    }
  }
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

function repairReservedPlainScalarStarts(source: string) {
  const lines = source.split('\n')
  let changed = false
  let blockScalarIndent: number | null = null
  let stringListIndent: number | null = null

  const repairedLines = lines.map((line) => {
    const indent = leadingWhitespaceWidth(line)

    if (blockScalarIndent !== null) {
      if (line.trim() === '' || indent > blockScalarIndent) {
        return line
      }
      blockScalarIndent = null
    }

    if (stringListIndent !== null) {
      if (line.trim() === '') {
        return line
      }

      if (indent > stringListIndent) {
        if (BLOCK_SCALAR_SEQUENCE_HEADER.test(line)) {
          blockScalarIndent = indent
          return line
        }

        const repairedStringListLine = repairStringListItemLine(line)
        if (repairedStringListLine !== line) {
          changed = true
        }
        return repairedStringListLine
      }

      stringListIndent = null
    }

    if (BLOCK_SCALAR_HEADER.test(line) || BLOCK_SCALAR_SEQUENCE_HEADER.test(line)) {
      blockScalarIndent = indent
      return line
    }

    if (STRING_LIST_HEADER.test(line)) {
      stringListIndent = indent
      return line
    }

    const repairedLine = repairReservedPlainScalarLine(line)
    if (repairedLine !== line) {
      changed = true
    }
    return repairedLine
  })

  return changed ? repairedLines.join('\n') : source
}

function repairReservedPlainScalarLine(line: string) {
  const sequenceMatch = line.match(/^(\s*-\s+)(.+)$/)
  if (sequenceMatch) {
    return quoteReservedLeadingScalar(sequenceMatch[1], sequenceMatch[2])
  }

  const mappingMatch = line.match(/^(\s*(?:-\s+)?[^:#][^:]*:\s+)(.+)$/)
  if (mappingMatch) {
    return quoteReservedLeadingScalar(mappingMatch[1], mappingMatch[2])
  }

  return line
}

function repairStringListItemLine(line: string) {
  const sequenceMatch = line.match(/^(\s*-\s+)(.+)$/)
  if (!sequenceMatch) {
    return line
  }

  const leadingWhitespace = sequenceMatch[2].match(/^\s*/)?.[0] ?? ''
  const value = sequenceMatch[2].slice(leadingWhitespace.length)
  if (
    value.startsWith('"') ||
    value.startsWith("'") ||
    value.startsWith('|') ||
    value.startsWith('>')
  ) {
    return line
  }

  return `${sequenceMatch[1]}${leadingWhitespace}${JSON.stringify(value)}`
}

function quoteReservedLeadingScalar(prefix: string, rawValue: string) {
  const leadingWhitespace = rawValue.match(/^\s*/)?.[0] ?? ''
  const value = rawValue.slice(leadingWhitespace.length)
  if (!RESERVED_PLAIN_SCALAR_START.test(value)) {
    return `${prefix}${rawValue}`
  }

  return `${prefix}${leadingWhitespace}${JSON.stringify(value)}`
}

function leadingWhitespaceWidth(value: string) {
  return value.match(/^\s*/)?.[0].length ?? 0
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
