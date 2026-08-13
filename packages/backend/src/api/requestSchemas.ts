import { z } from 'zod'
import { WORKFLOW_ROLE_KEYS } from '../agent/adapterConfig'
import {
  normalizeInboxAttentionReferences,
  parseAttentionReference,
} from '../domain/attentionReference'
import { inboxEventReferenceSchema } from '../domain/inboxEventReference'
import { projectCodingDefaultsInputSchema } from '../domain/projectCodingDefaults'
import { optionalProjectLabelSchema, projectLabelSchema } from '../domain/projectLabel'
import { isNormalizedProjectPath } from '../domain/projectPath'
import { stableIdSchema } from '../domain/stableId'
import { previewRuntimeInputsSchema } from '../runtime/previewRuntimeInputs'
import { ApiError } from './http'

const projectIdentitySchema = z.object({
  projectId: stableIdSchema.optional(),
  label: optionalProjectLabelSchema,
})

export const projectLabelUpdateSchema = z
  .object({
    label: projectLabelSchema.nullable(),
  })
  .strict()

export const projectRepoSchema = z.object({
  repoId: stableIdSchema,
  repoPath: z.string().min(1),
  projectPath: z.string().refine(isNormalizedProjectPath).optional(),
})

export const repoPathSchema = z
  .object({
    repoPath: z.string().min(1),
    projectPath: z.string().refine(isNormalizedProjectPath).optional(),
  })
  .strict()

const previewStartSchema = z
  .object({
    runtimeInputs: previewRuntimeInputsSchema.optional(),
  })
  .strict()

export const projectSchema = projectIdentitySchema
  .extend({
    primaryRepoId: stableIdSchema,
    repos: z.array(projectRepoSchema).min(1),
  })
  .strict()

export const rebindProjectSchema = z.object({ repos: z.array(projectRepoSchema).min(1) }).strict()

export const agentRoleSettingsSchema = z
  .object({ codingDefaults: projectCodingDefaultsInputSchema.nullable() })
  .strict()

export const projectAgentAccessSchema = z.object({ fullAccess: z.boolean() }).strict()

export const CONFIGURABLE_AGENT_ROLES = ['assistant', ...WORKFLOW_ROLE_KEYS] as const
export const configurableAgentRoleSchema = z.enum(CONFIGURABLE_AGENT_ROLES)

export const goalSchema = z.object({
  goalId: stableIdSchema.optional(),
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  priority: z.number().int().optional(),
})

export const inboxSchema = z
  .object({
    content: z.string(),
    context: z
      .object({
        projectId: z.string().min(1).optional(),
        goalId: z.string().min(1).optional(),
        attentionRefs: z
          .array(z.string().refine((value) => Boolean(parseAttentionReference(value))))
          .optional(),
        replyTo: inboxEventReferenceSchema.optional(),
      })
      .superRefine((context, refinement) => {
        if (context.goalId && !context.projectId) {
          refinement.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'goalId requires projectId',
          })
        }
        if (!context.projectId && !context.attentionRefs?.length && !context.replyTo) {
          refinement.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'context requires a Project location, Attention reference, or reply target',
          })
        }
      })
      .optional(),
  })
  .strict()

export async function parsePreviewStartRequest(request: Request) {
  const body = await request.text()
  if (!body.trim()) return {}
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new ApiError(400, 'Invalid Preview start request')
  }
  const parsed = previewStartSchema.safeParse(value)
  if (!parsed.success) throw new ApiError(400, 'Invalid Preview start request')
  return parsed.data
}

export async function parseInboxRequest(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) {
    const parsed = inboxSchema.parse(await request.json())
    if (!parsed.content.trim()) throw new ApiError(400, 'Inbox message is empty')
    return { ...parsed, images: [] as File[] }
  }
  const form = await request.formData()
  const rawContext = form.get('context')
  let context: unknown
  if (typeof rawContext === 'string' && rawContext.trim()) {
    try {
      context = JSON.parse(rawContext)
    } catch {
      throw new ApiError(400, 'Invalid Inbox context')
    }
  }
  const parsed = inboxSchema.parse({ content: form.get('content'), context })
  const images = form.getAll('images').filter((value): value is File => value instanceof File)
  if (!parsed.content.trim() && images.length === 0) {
    throw new ApiError(400, 'Inbox message is empty')
  }
  return { ...parsed, images }
}

export function canonicalInboxContext(context: z.infer<typeof inboxSchema>['context']) {
  if (!context) return undefined
  const attentionRefs = normalizeInboxAttentionReferences(context)
  return {
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.goalId ? { goalId: context.goalId } : {}),
    ...(attentionRefs.length ? { attentionRefs } : {}),
    ...(context.replyTo ? { replyTo: context.replyTo } : {}),
  }
}
