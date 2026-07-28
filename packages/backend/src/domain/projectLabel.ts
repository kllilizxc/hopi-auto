import { z } from 'zod'

export const PROJECT_LABEL_MAX_LENGTH = 80

export const projectLabelSchema = z.string().trim().min(1).max(PROJECT_LABEL_MAX_LENGTH)

export const optionalProjectLabelSchema = z.preprocess(
  (label) => (typeof label === 'string' && label.trim() === '' ? undefined : label),
  projectLabelSchema.optional(),
)

export function normalizeProjectLabel(label: string | undefined) {
  const normalized = label?.trim()
  return normalized ? projectLabelSchema.parse(normalized) : undefined
}
