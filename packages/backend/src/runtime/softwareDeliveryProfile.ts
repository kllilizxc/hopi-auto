import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'

const profileSchema = z
  .object({
    version: z.literal(1),
    id: z.literal('software-delivery-v1'),
    dispatch: z.tuple([
      z
        .object({
          when: z.object({ kind: z.literal('planning'), stage: z.literal('plan') }).strict(),
          pass: z.literal('planner'),
          on: z.object({ success: z.literal('done') }).strict(),
        })
        .strict(),
      z
        .object({
          when: z.object({ kind: z.literal('engineering'), stage: z.literal('generate') }).strict(),
          pass: z.literal('generator'),
          on: z.object({ success: z.literal('review') }).strict(),
        })
        .strict(),
      z
        .object({
          when: z.object({ kind: z.literal('engineering'), stage: z.literal('review') }).strict(),
          pass: z.literal('reviewer'),
          on: z.object({ success: z.literal('done'), reject: z.literal('generate') }).strict(),
        })
        .strict(),
    ]),
    retry: z
      .object({
        maxAttempts: z.literal(3),
        exhausted: z.literal('create_attention'),
      })
      .strict(),
    concurrency: z
      .object({
        planner: z.number().int().positive(),
        generator: z.number().int().positive(),
        reviewer: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()

export type SoftwareDeliveryProfile = z.infer<typeof profileSchema>

export class SoftwareDeliveryProfileError extends Error {}

export async function readSoftwareDeliveryProfile(
  path = join(import.meta.dir, '..', '..', 'profiles', 'software-delivery.yml'),
): Promise<SoftwareDeliveryProfile> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new SoftwareDeliveryProfileError(`Missing built-in software delivery profile: ${path}`)
  }

  let raw: unknown
  try {
    raw = parse(await file.text())
  } catch (error) {
    throw new SoftwareDeliveryProfileError(
      `Invalid built-in profile YAML: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const result = profileSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new SoftwareDeliveryProfileError(`Invalid built-in software delivery profile: ${issues}`)
  }
  return result.data
}

export function responsibilityFor(kind: 'planning' | 'engineering', stage: string) {
  if (kind === 'planning' && stage === 'plan') return 'planner' as const
  if (kind === 'engineering' && stage === 'generate') return 'generator' as const
  if (kind === 'engineering' && stage === 'review') return 'reviewer' as const
  return null
}
