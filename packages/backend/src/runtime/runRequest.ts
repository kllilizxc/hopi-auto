import { z } from 'zod'
import { RESPONSIBILITIES } from './roleContextStager'

export const RUN_WORKSPACE_MODES = ['none', 'read_only', 'isolated_write'] as const
export const RUN_TERMINATIONS = [
  'normal',
  'cancelled',
  'interrupted',
  'crashed',
  'timed_out',
] as const

export const runRequestSchema = z
  .object({
    profile: z.enum(RESPONSIBILITIES),
    workspaceMode: z.enum(RUN_WORKSPACE_MODES),
    instructionMarkdown: z.string().trim().min(1).max(64_000),
    refs: z.array(z.string().trim().min(1).max(1_000)).max(128).default([]),
  })
  .strict()

export type RunRequest = z.infer<typeof runRequestSchema>
export type RunProfile = RunRequest['profile']
export type RunWorkspaceMode = RunRequest['workspaceMode']
export type RunTermination = (typeof RUN_TERMINATIONS)[number]
