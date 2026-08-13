import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { stableIdSchema } from '../domain/stableId'
import { writeJsonAtomically } from '../storage/atomicFile'

export const DELIVERY_OPERATION_STATUSES = [
  'proposed',
  'executing',
  'succeeded',
  'failed',
  'cancelled',
] as const

const commitSchema = z.string().regex(/^[a-f0-9]{40,64}$/)
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const deliveryOperationIntentSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('baseline_integration'),
      changeSetId: stableIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('archive'),
      changeSetId: stableIdSchema,
      outputName: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.zip$/),
    })
    .strict(),
])

const observedRepoSchema = z
  .object({
    repoId: stableIdSchema,
    expectedBase: commitSchema,
    resultCommit: commitSchema,
    observedCommit: commitSchema,
  })
  .strict()

export const deliveryOperationResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('baseline_integrated'),
      changeSetId: stableIdSchema,
      repos: z.array(observedRepoSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('baseline_conflict'),
      changeSetId: stableIdSchema,
      summary: z.string().trim().min(1),
      repos: z.array(observedRepoSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('archive_created'),
      changeSetId: stableIdSchema,
      path: z.string().trim().min(1),
      contentHash: hashSchema,
      size: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('operation_failed'),
      summary: z.string().trim().min(1),
    })
    .strict(),
])

export const deliveryOperationSchema = z
  .object({
    id: stableIdSchema,
    projectId: stableIdSchema,
    goalId: stableIdSchema,
    workId: stableIdSchema.nullable(),
    idempotencyKey: z.string().trim().min(1).max(256),
    requiredForGoal: z.boolean(),
    intent: deliveryOperationIntentSchema,
    status: z.enum(DELIVERY_OPERATION_STATUSES),
    proposedByEventId: stableIdSchema,
    approvedByEventId: stableIdSchema.nullable(),
    proposedAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    endedAt: z.string().datetime().nullable(),
    result: deliveryOperationResultSchema.nullable(),
  })
  .strict()

export type DeliveryOperationIntent = z.infer<typeof deliveryOperationIntentSchema>
export type DeliveryOperationResult = z.infer<typeof deliveryOperationResultSchema>
export type DeliveryOperation = z.infer<typeof deliveryOperationSchema>

export interface ProposeDeliveryOperationInput {
  id: string
  projectId: string
  goalId: string
  workId?: string | null
  idempotencyKey: string
  requiredForGoal: boolean
  intent: DeliveryOperationIntent
  proposedByEventId: string
}

export interface DeliveryOperationStore {
  propose(input: ProposeDeliveryOperationInput): Promise<DeliveryOperation>
  begin(id: string, approvedByEventId: string): Promise<DeliveryOperation>
  succeed(id: string, result: DeliveryOperationResult): Promise<DeliveryOperation>
  fail(id: string, result: DeliveryOperationResult): Promise<DeliveryOperation>
  cancel(id: string, eventId: string): Promise<DeliveryOperation>
  read(id: string): Promise<DeliveryOperation | null>
  listGoal(projectId: string, goalId: string): Promise<DeliveryOperation[]>
  operationRoot(id: string): string
}

export function createDeliveryOperationStore(
  homeRoot: string,
  options: { now?: () => Date } = {},
): DeliveryOperationStore {
  const now = options.now ?? (() => new Date())
  const root = join(homeRoot, '.hopi', 'operations')
  let mutationTail: Promise<void> = Promise.resolve()
  const mutate = async <T>(operation: () => Promise<T>) => {
    const previous = mutationTail
    let release!: () => void
    mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
  const operationRoot = (id: string) => join(root, stableIdSchema.parse(id))
  const read = async (id: string) => {
    const file = Bun.file(join(operationRoot(id), 'operation.json'))
    return (await file.exists()) ? deliveryOperationSchema.parse(await file.json()) : null
  }
  const write = async (operation: DeliveryOperation) => {
    const directory = operationRoot(operation.id)
    await mkdir(directory, { recursive: true })
    await writeJsonAtomically(join(directory, 'operation.json'), operation)
    return operation
  }

  return {
    operationRoot,
    read,
    async propose(input) {
      return mutate(async () => {
        const parsed = {
          id: stableIdSchema.parse(input.id),
          projectId: stableIdSchema.parse(input.projectId),
          goalId: stableIdSchema.parse(input.goalId),
          workId: input.workId ? stableIdSchema.parse(input.workId) : null,
          idempotencyKey: input.idempotencyKey.trim(),
          requiredForGoal: input.requiredForGoal,
          intent: deliveryOperationIntentSchema.parse(input.intent),
          proposedByEventId: stableIdSchema.parse(input.proposedByEventId),
        }
        const existingById = await read(parsed.id)
        const all = await listOperations(root)
        const existingByKey = all.find(
          (candidate) =>
            candidate.projectId === parsed.projectId &&
            candidate.idempotencyKey === parsed.idempotencyKey,
        )
        const existing = existingById ?? existingByKey
        if (existing) {
          const comparable = {
            projectId: existing.projectId,
            goalId: existing.goalId,
            workId: existing.workId,
            idempotencyKey: existing.idempotencyKey,
            requiredForGoal: existing.requiredForGoal,
            intent: existing.intent,
            proposedByEventId: existing.proposedByEventId,
          }
          const { id: _parsedId, ...parsedComparable } = parsed
          if (
            existing.id !== parsed.id ||
            JSON.stringify(comparable) !== JSON.stringify(parsedComparable)
          ) {
            throw new Error(`Delivery Operation idempotency conflict: ${parsed.idempotencyKey}`)
          }
          return existing
        }
        return write(
          deliveryOperationSchema.parse({
            ...parsed,
            status: 'proposed',
            approvedByEventId: null,
            proposedAt: now().toISOString(),
            startedAt: null,
            endedAt: null,
            result: null,
          }),
        )
      })
    },
    async begin(id, approvedByEventId) {
      return mutate(async () => {
        const current = await requiredOperation(read, id)
        if (current.status !== 'proposed' && current.status !== 'executing') return current
        if (current.status === 'executing') return current
        return write(
          deliveryOperationSchema.parse({
            ...current,
            status: 'executing',
            approvedByEventId: stableIdSchema.parse(approvedByEventId),
            startedAt: now().toISOString(),
          }),
        )
      })
    },
    async succeed(id, result) {
      return settle(read, write, mutate, now, id, 'succeeded', result)
    },
    async fail(id, result) {
      return settle(read, write, mutate, now, id, 'failed', result)
    },
    async cancel(id, eventId) {
      return mutate(async () => {
        const current = await requiredOperation(read, id)
        if (current.status === 'cancelled') return current
        if (current.status !== 'proposed') {
          throw new Error(`Only a proposed Delivery Operation can be cancelled: ${id}`)
        }
        return write(
          deliveryOperationSchema.parse({
            ...current,
            status: 'cancelled',
            approvedByEventId: stableIdSchema.parse(eventId),
            endedAt: now().toISOString(),
          }),
        )
      })
    },
    async listGoal(projectId, goalId) {
      const normalizedProjectId = stableIdSchema.parse(projectId)
      const normalizedGoalId = stableIdSchema.parse(goalId)
      return (await listOperations(root))
        .filter(
          (operation) =>
            operation.projectId === normalizedProjectId && operation.goalId === normalizedGoalId,
        )
        .toSorted((left, right) => right.proposedAt.localeCompare(left.proposedAt))
    },
  }
}

async function settle(
  read: (id: string) => Promise<DeliveryOperation | null>,
  write: (operation: DeliveryOperation) => Promise<DeliveryOperation>,
  mutate: <T>(operation: () => Promise<T>) => Promise<T>,
  now: () => Date,
  id: string,
  status: 'succeeded' | 'failed',
  result: DeliveryOperationResult,
) {
  return mutate(async () => {
    const current = await requiredOperation(read, id)
    if (current.status === status) return current
    if (current.status !== 'executing') {
      throw new Error(`Cannot settle Delivery Operation ${id} from ${current.status}`)
    }
    return write(
      deliveryOperationSchema.parse({
        ...current,
        status,
        endedAt: now().toISOString(),
        result: deliveryOperationResultSchema.parse(result),
      }),
    )
  })
}

async function requiredOperation(
  read: (id: string) => Promise<DeliveryOperation | null>,
  id: string,
) {
  const operation = await read(id)
  if (!operation) throw new Error(`Delivery Operation not found: ${id}`)
  return operation
}

async function listOperations(root: string) {
  const operations: DeliveryOperation[] = []
  await mkdir(root, { recursive: true })
  for await (const path of new Bun.Glob('*/operation.json').scan({ cwd: root, onlyFiles: true })) {
    try {
      operations.push(deliveryOperationSchema.parse(await Bun.file(join(root, path)).json()))
    } catch (error) {
      console.error(`[hopi ignored corrupt Delivery Operation] ${join(root, path)}:`, error)
    }
  }
  return operations
}
