import { z } from 'zod'
import { projectCodingDefaultsInputSchema } from './agent/projectCodingDefaults'
import type { TodoBoard } from './domain/board'
import { goalAttachmentRefArraySchema } from './storage/goalAttachmentStore'

export const assistantMessageSchema = z.object({
  content: z.string().min(1),
  attachments: goalAttachmentRefArraySchema,
})

export const assistantRunSchema = z.object({
  content: z.string().min(1),
  attachments: goalAttachmentRefArraySchema,
  appendUserMessage: z.boolean().default(true),
})

export const createProjectSchema = z.object({
  projectKey: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  rootDir: z.string().min(1),
  codingDefaults: projectCodingDefaultsInputSchema.optional(),
})

export const updateProjectSettingsSchema = z.object({
  codingDefaults: projectCodingDefaultsInputSchema.optional(),
})

export const createProjectGoalSchema = z.object({
  goalKey: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  successCriteria: z.array(z.string().min(1)).default([]),
})

const laneParallelismSchema = z
  .object({
    in_progress: z.number().int().positive().max(10).optional(),
    in_review: z.number().int().positive().max(10).optional(),
    merging: z.number().int().positive().max(10).optional(),
  })
  .partial()
  .optional()

export const automationStartSchema = z.object({
  maxSteps: z.number().int().positive().max(100).optional(),
  maxParallel: z.number().int().positive().max(10).optional(),
  laneParallelism: laneParallelismSchema,
})

export type BoardResponse = Omit<TodoBoard, 'items'> & {
  items: Array<TodoBoard['items'][number] & { running?: boolean }>
}
