import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  type GoalAssistantAction,
  type GoalAssistantActionResult,
  assistantActionResultSchema,
  assistantActionSchema,
} from '../assistant/assistantRun'
import {
  type GoalAttachmentRef,
  goalAttachmentRefArraySchema,
} from '../storage/goalAttachmentStore'
import { withFileLock } from '../storage/lock'
import { createProjectPaths } from '../storage/paths'
import {
  type ActionRequiredNotification,
  ActionRequiredNotificationSchema,
} from './actionRequiredNotificationTypes'

const ASSISTANT_THREAD_ENTRY_KINDS = [
  'user_message',
  'assistant_message',
  'system_message',
  'action',
  'action_result',
] as const

export type AssistantThreadEntryKind = (typeof ASSISTANT_THREAD_ENTRY_KINDS)[number]

export type AssistantThreadEntryInput =
  | { kind: 'user_message'; content: string; attachments?: GoalAttachmentRef[] }
  | { kind: 'assistant_message'; content: string; mergeKey?: string }
  | {
      kind: 'system_message'
      label: string
      content: string
      details?: string[]
      dedupeKey?: string
      collapsedByDefault?: boolean
      notification?: ActionRequiredNotification
    }
  | { kind: 'action'; actionType: string; summary: string; action?: GoalAssistantAction }
  | {
      kind: 'action_result'
      actionType: string
      summary: string
      result?: GoalAssistantActionResult
    }

export type AssistantThreadEntry =
  | {
      entryId: string
      createdAt: string
      kind: 'user_message'
      content: string
      attachments: GoalAttachmentRef[]
    }
  | {
      entryId: string
      createdAt: string
      kind: 'assistant_message'
      content: string
      mergeKey?: string
    }
  | {
      entryId: string
      createdAt: string
      kind: 'system_message'
      label: string
      content: string
      details: string[]
      dedupeKey?: string
      collapsedByDefault?: boolean
      notification?: ActionRequiredNotification
    }
  | {
      entryId: string
      createdAt: string
      kind: 'action'
      actionType: string
      summary: string
      action?: GoalAssistantAction
    }
  | {
      entryId: string
      createdAt: string
      kind: 'action_result'
      actionType: string
      summary: string
      result?: GoalAssistantActionResult
    }

export interface GoalAssistantThread {
  goalKey: string
  entries: AssistantThreadEntry[]
}

export interface AssistantThreadStoreObserver {
  onEntry(goalKey: string, entry: AssistantThreadEntry): Promise<void> | void
}

export interface AssistantThreadStore {
  readThread(goalKey: string): Promise<GoalAssistantThread>
  appendEntry(goalKey: string, input: AssistantThreadEntryInput): Promise<AssistantThreadEntry>
  appendSystemMessage(
    goalKey: string,
    input: {
      label: string
      content: string
      details?: string[]
      dedupeKey?: string
      collapsedByDefault?: boolean
      notification?: ActionRequiredNotification
    },
  ): Promise<AssistantThreadEntry>
  appendUserMessage(
    goalKey: string,
    content: string,
    attachments?: GoalAttachmentRef[],
  ): Promise<AssistantThreadEntry>
}

const AssistantThreadEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    entryId: z.string().min(1),
    createdAt: z.string().datetime(),
    kind: z.literal('user_message'),
    content: z.string().min(1),
    attachments: goalAttachmentRefArraySchema,
  }),
  z.object({
    entryId: z.string().min(1),
    createdAt: z.string().datetime(),
    kind: z.literal('assistant_message'),
    content: z.string().min(1),
    mergeKey: z.string().min(1).optional(),
  }),
  z.object({
    entryId: z.string().min(1),
    createdAt: z.string().datetime(),
    kind: z.literal('system_message'),
    label: z.string().min(1),
    content: z.string().min(1),
    details: z.array(z.string().min(1)).default([]),
    dedupeKey: z.string().min(1).optional(),
    collapsedByDefault: z.boolean().optional(),
    notification: ActionRequiredNotificationSchema.optional(),
  }),
  z.object({
    entryId: z.string().min(1),
    createdAt: z.string().datetime(),
    kind: z.literal('action'),
    actionType: z.string().min(1),
    summary: z.string().min(1),
    action: assistantActionSchema.optional(),
  }),
  z.object({
    entryId: z.string().min(1),
    createdAt: z.string().datetime(),
    kind: z.literal('action_result'),
    actionType: z.string().min(1),
    summary: z.string().min(1),
    result: assistantActionResultSchema.optional(),
  }),
])

const GoalAssistantThreadSchema = z.object({
  goalKey: z.string().min(1),
  entries: z.array(AssistantThreadEntrySchema).default([]),
})

export function createAssistantThreadStore(
  rootDir = process.cwd(),
  observer?: AssistantThreadStoreObserver,
): AssistantThreadStore {
  const paths = createProjectPaths(rootDir)

  return {
    async readThread(goalKey) {
      return readThreadAtPath(paths.assistantThreadPath(goalKey), goalKey)
    },
    async appendEntry(goalKey, input) {
      const threadPath = paths.assistantThreadPath(goalKey)
      const lockPath = `${threadPath}.lock`
      return withFileLock(lockPath, async () => {
        const thread = await readThreadAtPath(threadPath, goalKey)
        if (input.kind === 'system_message' && input.dedupeKey) {
          const existing = thread.entries.find(
            (entry) =>
              entry.kind === 'system_message' && entry.dedupeKey === input.dedupeKey,
          )
          if (existing) {
            return existing
          }
        }
        const entry = createThreadEntry(input)
        thread.entries.push(entry)
        await writeThread(threadPath, thread)
        await observer?.onEntry(goalKey, entry)
        return entry
      })
    },
    async appendSystemMessage(goalKey, input) {
      return this.appendEntry(goalKey, {
        kind: 'system_message',
        ...input,
      })
    },
    async appendUserMessage(goalKey, content, attachments) {
      return this.appendEntry(goalKey, {
        kind: 'user_message',
        content,
        attachments,
      })
    },
  }
}

function createThreadEntry(input: AssistantThreadEntryInput): AssistantThreadEntry {
  const base = {
    entryId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }

  if (input.kind === 'user_message') {
    return {
      ...base,
      kind: 'user_message',
      content: input.content,
      attachments: input.attachments ? [...input.attachments] : [],
    }
  }

  if (input.kind === 'assistant_message') {
    return {
      ...base,
      kind: 'assistant_message',
      content: input.content,
      ...(input.mergeKey ? { mergeKey: input.mergeKey } : {}),
    }
  }

  if (input.kind === 'system_message') {
    return {
      ...base,
      kind: 'system_message',
      label: input.label,
      content: input.content,
      details: input.details ? [...input.details] : [],
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      ...(typeof input.collapsedByDefault === 'boolean'
        ? { collapsedByDefault: input.collapsedByDefault }
        : {}),
      ...(input.notification ? { notification: input.notification } : {}),
    }
  }

  return {
    ...base,
    kind: input.kind,
    actionType: input.actionType,
    summary: input.summary,
    ...(input.kind === 'action' && input.action ? { action: input.action } : {}),
    ...(input.kind === 'action_result' && input.result ? { result: input.result } : {}),
  }
}

async function readThreadAtPath(threadPath: string, goalKey: string): Promise<GoalAssistantThread> {
  const file = Bun.file(threadPath)
  if (!(await file.exists())) {
    return {
      goalKey,
      entries: [],
    }
  }

  const raw = await file.text()
  if (raw.trim() === '') {
    return {
      goalKey,
      entries: [],
    }
  }

  const parsed = GoalAssistantThreadSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid assistant-thread.json format: ${issues}`)
  }

  return parsed.data
}

async function writeThread(threadPath: string, thread: GoalAssistantThread) {
  await mkdir(dirname(threadPath), { recursive: true })
  const tmpPath = `${threadPath}.tmp.${crypto.randomUUID()}`
  await Bun.write(tmpPath, `${JSON.stringify(thread, null, 2)}\n`)
  await rename(tmpPath, threadPath)
}
