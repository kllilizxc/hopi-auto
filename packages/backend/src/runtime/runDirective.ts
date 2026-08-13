import { z } from 'zod'
import type { WorkAttributes } from '../domain/canonicalDocuments'
import { stableIdSchema } from '../domain/stableId'
import { RESPONSIBILITIES } from './roleContextStager'
import { responsibilityFor } from './softwareDelivery'

export const RUN_PROTOCOLS = ['legacy_outcome', 'report'] as const
export const RUN_WORKSPACE_MODES = ['none', 'read_only', 'isolated_write'] as const

export const runDirectiveSchema = z
  .object({
    protocol: z.enum(RUN_PROTOCOLS),
    profile: z.enum(RESPONSIBILITIES),
    workspaceMode: z.enum(RUN_WORKSPACE_MODES),
    instructionMarkdown: z.string().trim().min(1).max(64_000),
    refs: z.array(z.string().trim().min(1).max(1_000)).max(128).default([]),
    baseChangeSetId: stableIdSchema.nullable().default(null),
  })
  .strict()

export type RunDirective = z.infer<typeof runDirectiveSchema>
export type RunProtocol = RunDirective['protocol']
export type RunWorkspaceMode = RunDirective['workspaceMode']
export type RunProfile = RunDirective['profile']

export function legacyRunDirective(work: WorkAttributes): RunDirective | null {
  const profile = responsibilityFor(work.kind, work.stage)
  if (!profile) return null
  return runDirectiveSchema.parse({
    protocol: 'legacy_outcome',
    profile,
    workspaceMode:
      profile === 'generator' ? 'isolated_write' : profile === 'reviewer' ? 'read_only' : 'none',
    instructionMarkdown: `Execute the current ${profile} compatibility contract for Work ${work.id}.`,
    refs: [],
    baseChangeSetId: null,
  })
}

export function defaultLegacyRunDirective(profile: RunProfile): RunDirective {
  return runDirectiveSchema.parse({
    protocol: 'legacy_outcome',
    profile,
    workspaceMode:
      profile === 'generator' ? 'isolated_write' : profile === 'reviewer' ? 'read_only' : 'none',
    instructionMarkdown: `Execute the current ${profile} compatibility contract.`,
    refs: [],
    baseChangeSetId: null,
  })
}
