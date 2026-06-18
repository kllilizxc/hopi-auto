import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { BlockerRef, TaskItem } from '../domain/board'
import type { BoardStore } from '../storage/boardStore'
import type { DecisionStore, GoalDecision } from '../storage/decisionStore'
import { withFileLock } from '../storage/lock'
import { createProjectPaths } from '../storage/paths'
import type { AssistantThreadStore } from './assistantThreadStore'
import type {
  ActionRequiredNotification,
  ActionRequiredNotificationAction,
  ActionRequiredNotificationKind,
} from './actionRequiredNotificationTypes'

interface ActionRequiredFact {
  fingerprint: string
  notification: ActionRequiredNotification
  label: string
  content: string
  details: string[]
}

interface NotificationRecord {
  active: boolean
  generation: number
  firstSeenAt: string
  lastSeenAt: string
  lastNotifiedAt?: string
  resolvedAt?: string
  threadEntryId?: string
}

interface NotificationState {
  version: 1
  goalKey: string
  records: Record<string, NotificationRecord>
}

export interface ActionRequiredNotifier {
  reconcileGoal(goalKey: string): Promise<void>
  notifyAutomationFailed(goalKey: string, error?: string): Promise<void>
  clearAutomationFailed(goalKey: string): Promise<void>
}

export function createActionRequiredNotifier(
  rootDir = process.cwd(),
  stores: {
    boardStore: BoardStore
    decisions: DecisionStore
    assistantThread: AssistantThreadStore
  },
): ActionRequiredNotifier {
  const paths = createProjectPaths(rootDir)

  return {
    async reconcileGoal(goalKey) {
      const board = await stores.boardStore.readBoard(goalKey)
      const decisionSet = await stores.decisions.readGoalDecisions(goalKey)
      const facts = collectActionRequiredFacts(board.items, decisionSet.decisions)
      await reconcileFacts({
        notificationPath: paths.actionRequiredNotificationsPath(goalKey),
        goalKey,
        facts,
        assistantThread: stores.assistantThread,
        managedPrefixes: [
          'task_blocked_intervention:',
          'task_blocked_merge_conflict:',
          'task_blocked_decision:',
          'open_decision:',
        ],
      })
    },
    async notifyAutomationFailed(goalKey, error) {
      await reconcileFacts({
        notificationPath: paths.actionRequiredNotificationsPath(goalKey),
        goalKey,
        facts: [
          {
            fingerprint: `automation_failed:${stablePart(error ?? 'unknown')}`,
            notification: {
              kind: 'automation_failed',
              actions: ['inspect_task'],
            },
            label: 'Action required',
            content: 'Automation stopped after a system error.',
            details: [
              error ? `Error: ${error}` : 'Error: unknown',
              'Inspect the latest run or server log, then restart automation after the issue is resolved.',
            ],
          },
        ],
        assistantThread: stores.assistantThread,
        managedPrefixes: ['automation_failed:'],
      })
    },
    async clearAutomationFailed(goalKey) {
      await reconcileFacts({
        notificationPath: paths.actionRequiredNotificationsPath(goalKey),
        goalKey,
        facts: [],
        assistantThread: stores.assistantThread,
        managedPrefixes: ['automation_failed:'],
      })
    },
  }
}

function collectActionRequiredFacts(
  tasks: TaskItem[],
  decisions: GoalDecision[],
): ActionRequiredFact[] {
  const facts: ActionRequiredFact[] = []
  const openDecisions = new Map(
    decisions
      .filter((decision) => decision.status === 'open')
      .map((decision) => [decision.decisionKey, decision] as const),
  )
  const referencedOpenDecisionKeys = new Set<string>()

  for (const task of tasks) {
    if (task.status === 'done') {
      continue
    }

    for (const blocker of task.blockedBy) {
      if (blocker.kind === 'intervention') {
        facts.push(taskBlockerFact(task, blocker, 'task_blocked_intervention'))
      } else if (blocker.kind === 'merge_conflict') {
        facts.push(taskBlockerFact(task, blocker, 'task_blocked_merge_conflict'))
      } else if (blocker.kind === 'decision') {
        const decision = openDecisions.get(blocker.ref)
        if (!decision) {
          continue
        }
        referencedOpenDecisionKeys.add(decision.decisionKey)
        facts.push(taskDecisionFact(task, blocker, decision))
      }
    }
  }

  for (const decision of openDecisions.values()) {
    if (referencedOpenDecisionKeys.has(decision.decisionKey)) {
      continue
    }
    facts.push(openDecisionFact(decision))
  }

  return facts
}

function taskBlockerFact(
  task: TaskItem,
  blocker: BlockerRef,
  kind: Extract<
    ActionRequiredNotificationKind,
    'task_blocked_intervention' | 'task_blocked_merge_conflict'
  >,
): ActionRequiredFact {
  const isMergeConflict = kind === 'task_blocked_merge_conflict'
  const actions: ActionRequiredNotificationAction[] = ['inspect_task', 'retry_task']
  return {
    fingerprint: `${kind}:${stablePart(task.ref)}:${stablePart(blocker.ref)}`,
    notification: {
      kind,
      taskRef: task.ref,
      blocker,
      actions,
    },
    label: 'Action required',
    content: `${task.ref} needs intervention: ${task.title}.`,
    details: [
      `Blocker: ${blocker.kind} · ${blocker.ref}`,
      isMergeConflict
        ? `Inspect the latest merger run for ${task.ref}, reconcile the conflicting files, then retry the task.`
        : blocker.ref.endsWith(':reviewer_rejected')
          ? `Inspect the latest reviewer or merger findings for ${task.ref}, address the cited issue, then retry the task.`
          : `Inspect the latest run for ${task.ref}, resolve the cited issue, then retry the task.`,
    ],
  }
}

function taskDecisionFact(
  task: TaskItem,
  blocker: BlockerRef,
  decision: GoalDecision,
): ActionRequiredFact {
  return {
    fingerprint: `task_blocked_decision:${stablePart(task.ref)}:${stablePart(decision.decisionKey)}`,
    notification: {
      kind: 'task_blocked_decision',
      taskRef: task.ref,
      blocker,
      decisionKey: decision.decisionKey,
      actions: ['answer_decision'],
    },
    label: 'Decision needed',
    content: `${task.ref} is waiting for a decision: ${decision.summary}.`,
    details: [
      `Decision: ${decision.decisionKey}`,
      `Question: ${decision.prompt ?? decision.summary}`,
      `Answer the blocking decision for ${task.ref}, then start automation to continue.`,
    ],
  }
}

function openDecisionFact(decision: GoalDecision): ActionRequiredFact {
  return {
    fingerprint: `open_decision:${stablePart(decision.decisionKey)}`,
    notification: {
      kind: 'open_decision',
      ...(decision.taskRef ? { taskRef: decision.taskRef } : {}),
      decisionKey: decision.decisionKey,
      actions: ['answer_decision'],
    },
    label: 'Decision needed',
    content: `Decision needed: ${decision.summary}.`,
    details: [
      `Decision: ${decision.decisionKey}`,
      `Question: ${decision.prompt ?? decision.summary}`,
    ],
  }
}

async function reconcileFacts(options: {
  notificationPath: string
  goalKey: string
  facts: ActionRequiredFact[]
  assistantThread: AssistantThreadStore
  managedPrefixes: string[]
}) {
  const lockPath = `${options.notificationPath}.lock`
  await withFileLock(lockPath, async () => {
    const now = new Date().toISOString()
    const state = await readNotificationState(options.notificationPath, options.goalKey)
    const currentFingerprints = new Set(options.facts.map((fact) => fact.fingerprint))

    for (const [fingerprint, record] of Object.entries(state.records)) {
      if (!options.managedPrefixes.some((prefix) => fingerprint.startsWith(prefix))) {
        continue
      }
      if (!currentFingerprints.has(fingerprint) && record.active) {
        state.records[fingerprint] = {
          ...record,
          active: false,
          resolvedAt: now,
        }
      }
    }

    for (const fact of options.facts) {
      const current = state.records[fact.fingerprint]
      if (current?.active) {
        state.records[fact.fingerprint] = {
          ...current,
          lastSeenAt: now,
        }
        continue
      }

      const generation = (current?.generation ?? 0) + 1
      const entry = await options.assistantThread.appendSystemMessage(options.goalKey, {
        label: fact.label,
        content: fact.content,
        details: fact.details,
        collapsedByDefault: false,
        notification: fact.notification,
        dedupeKey: `${fact.fingerprint}:g${generation}`,
      })
      state.records[fact.fingerprint] = {
        active: true,
        generation,
        firstSeenAt: current?.firstSeenAt ?? now,
        lastSeenAt: now,
        lastNotifiedAt: now,
        threadEntryId: entry.entryId,
      }
    }

    await writeNotificationState(options.notificationPath, state)
  })
}

const NotificationRecordSchema = z.object({
  active: z.boolean(),
  generation: z.number().int().min(0),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  lastNotifiedAt: z.string().datetime().optional(),
  resolvedAt: z.string().datetime().optional(),
  threadEntryId: z.string().min(1).optional(),
})

const NotificationStateSchema = z.object({
  version: z.literal(1),
  goalKey: z.string().min(1),
  records: z.record(NotificationRecordSchema).default({}),
})

async function readNotificationState(path: string, goalKey: string): Promise<NotificationState> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return emptyNotificationState(goalKey)
  }

  const raw = await file.text()
  if (raw.trim() === '') {
    return emptyNotificationState(goalKey)
  }

  const parsed = NotificationStateSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid notifications.json format: ${issues}`)
  }

  return parsed.data
}

async function writeNotificationState(path: string, state: NotificationState) {
  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp.${crypto.randomUUID()}`
  await Bun.write(tmpPath, `${JSON.stringify(state, null, 2)}\n`)
  await rename(tmpPath, path)
}

function emptyNotificationState(goalKey: string): NotificationState {
  return {
    version: 1,
    goalKey,
    records: {},
  }
}

function stablePart(value: string) {
  return encodeURIComponent(value.trim())
}
