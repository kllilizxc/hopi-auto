import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { withFileLock } from '../storage/lock'
import { createProjectPaths } from '../storage/paths'

const ASSISTANT_THREAD_ENTRY_KINDS = [
  'user_message',
  'assistant_message',
  'action',
  'action_result',
] as const

export type AssistantThreadEntryKind = (typeof ASSISTANT_THREAD_ENTRY_KINDS)[number]

export type AssistantThreadEntryInput =
  | { kind: 'user_message'; content: string }
  | { kind: 'assistant_message'; content: string }
  | { kind: 'action'; actionType: string; summary: string }
  | { kind: 'action_result'; actionType: string; summary: string }

export type AssistantThreadEntry =
  | {
      entryId: string
      createdAt: string
      kind: 'user_message' | 'assistant_message'
      content: string
    }
  | {
      entryId: string
      createdAt: string
      kind: 'action' | 'action_result'
      actionType: string
      summary: string
    }

export interface GoalAssistantThread {
  goalKey: string
  entries: AssistantThreadEntry[]
}

export interface AssistantThreadStore {
  readThread(goalKey: string): Promise<GoalAssistantThread>
  appendEntry(goalKey: string, input: AssistantThreadEntryInput): Promise<AssistantThreadEntry>
  appendUserMessage(goalKey: string, content: string): Promise<AssistantThreadEntry>
}

const AssistantThreadEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    entryId: z.string().min(1),
    createdAt: z.string().datetime(),
    kind: z.enum(['user_message', 'assistant_message']),
    content: z.string().min(1),
  }),
  z.object({
    entryId: z.string().min(1),
    createdAt: z.string().datetime(),
    kind: z.enum(['action', 'action_result']),
    actionType: z.string().min(1),
    summary: z.string().min(1),
  }),
])

const GoalAssistantThreadSchema = z.object({
  goalKey: z.string().min(1),
  entries: z.array(AssistantThreadEntrySchema).default([]),
})

export function createAssistantThreadStore(rootDir = process.cwd()): AssistantThreadStore {
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
        const entry = createThreadEntry(input)
        thread.entries.push(entry)
        await writeThread(threadPath, thread)
        return entry
      })
    },
    async appendUserMessage(goalKey, content) {
      return this.appendEntry(goalKey, {
        kind: 'user_message',
        content,
      })
    },
  }
}

function createThreadEntry(input: AssistantThreadEntryInput): AssistantThreadEntry {
  const base = {
    entryId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }

  if (input.kind === 'user_message' || input.kind === 'assistant_message') {
    return {
      ...base,
      kind: input.kind,
      content: input.content,
    }
  }

  return {
    ...base,
    kind: input.kind,
    actionType: input.actionType,
    summary: input.summary,
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
