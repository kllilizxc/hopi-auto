import { mkdir, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { assertStableId } from '../domain/stableId'
import {
  type AssistantConversationScope,
  assistantConversationScopeKey,
} from './assistantConversationScope'

const epochSchema = z
  .object({
    streamId: z.string().min(1),
    resetAt: z.string().datetime({ offset: true }),
    removedFeedEntryIds: z.array(z.string().min(1)),
  })
  .strict()

export interface AssistantConversationEpoch {
  streamId: string
  resetAt: string | null
  removedFeedEntryIds: string[]
}

export async function readAssistantConversationEpoch(
  homeRoot: string,
  scope: AssistantConversationScope,
): Promise<AssistantConversationEpoch> {
  const path = assistantConversationEpochPath(homeRoot, scope)
  if (!path) {
    return {
      streamId: `initial:${assistantConversationScopeKey(scope)}`,
      resetAt: null,
      removedFeedEntryIds: [],
    }
  }
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return {
      streamId: `initial:${assistantConversationScopeKey(scope)}`,
      resetAt: null,
      removedFeedEntryIds: [],
    }
  }
  return epochSchema.parse(await file.json())
}

export async function resetProjectAssistantConversationEpoch(input: {
  homeRoot: string
  projectId: string
  removedFeedEntryIds: readonly string[]
  now?: Date
}) {
  assertStableId(input.projectId, 'projectId')
  const epoch = epochSchema.parse({
    streamId: `assistant-stream-${crypto.randomUUID()}`,
    resetAt: (input.now ?? new Date()).toISOString(),
    removedFeedEntryIds: [...new Set(input.removedFeedEntryIds)].toSorted(),
  })
  const path = assistantConversationEpochPath(input.homeRoot, {
    kind: 'project',
    projectId: input.projectId,
  })
  if (!path) throw new Error('Project Assistant conversation epoch path is missing')
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  await Bun.write(temporary, `${JSON.stringify(epoch, null, 2)}\n`)
  await rename(temporary, path)
  return epoch
}

function assistantConversationEpochPath(homeRoot: string, scope: AssistantConversationScope) {
  if (scope.kind === 'home') return null
  assertStableId(scope.projectId, 'projectId')
  return join(
    resolve(homeRoot),
    '.hopi',
    'runtime',
    'assistant',
    'conversation-epochs',
    'projects',
    `${scope.projectId}.json`,
  )
}
