import { z } from 'zod'
import { BLOCKER_KINDS, type BlockerRef } from '../domain/board'

export const ACTION_REQUIRED_NOTIFICATION_KINDS = [
  'task_blocked_intervention',
  'task_blocked_merge_conflict',
  'task_blocked_decision',
  'open_decision',
  'automation_failed',
] as const

export const ACTION_REQUIRED_NOTIFICATION_ACTIONS = [
  'retry_task',
  'answer_decision',
  'inspect_task',
  'open_run',
] as const

export type ActionRequiredNotificationKind =
  (typeof ACTION_REQUIRED_NOTIFICATION_KINDS)[number]
export type ActionRequiredNotificationAction =
  (typeof ACTION_REQUIRED_NOTIFICATION_ACTIONS)[number]

export interface ActionRequiredNotification {
  kind: ActionRequiredNotificationKind
  taskRef?: string
  blocker?: BlockerRef
  decisionKey?: string
  actions: ActionRequiredNotificationAction[]
}

export const ActionRequiredNotificationSchema = z.object({
  kind: z.enum(ACTION_REQUIRED_NOTIFICATION_KINDS),
  taskRef: z.string().min(1).optional(),
  blocker: z
    .object({
      kind: z.enum(BLOCKER_KINDS),
      ref: z.string().min(1),
    })
    .optional(),
  decisionKey: z.string().min(1).optional(),
  actions: z.array(z.enum(ACTION_REQUIRED_NOTIFICATION_ACTIONS)).default([]),
})
