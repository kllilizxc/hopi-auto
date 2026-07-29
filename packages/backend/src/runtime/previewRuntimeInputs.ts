import { z } from 'zod'

export const PREVIEW_RUNTIME_INPUT_MAX_ENTRIES = 32
export const PREVIEW_RUNTIME_INPUT_MAX_KEY_LENGTH = 128
export const PREVIEW_RUNTIME_INPUT_MAX_VALUE_LENGTH = 8_192
export const PREVIEW_RUNTIME_INPUT_MAX_SERIALIZED_BYTES = 32 * 1_024

const previewRuntimeInputKeySchema = z.string().min(1).max(PREVIEW_RUNTIME_INPUT_MAX_KEY_LENGTH)

const previewRuntimeInputValueSchema = z.string().max(PREVIEW_RUNTIME_INPUT_MAX_VALUE_LENGTH)

export const previewRuntimeInputsShapeSchema = z.record(
  previewRuntimeInputKeySchema,
  previewRuntimeInputValueSchema,
)

export const previewRuntimeInputsSchema = previewRuntimeInputsShapeSchema.superRefine(
  (runtimeInputs, context) => {
    if (Object.keys(runtimeInputs).length > PREVIEW_RUNTIME_INPUT_MAX_ENTRIES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Preview runtime inputs may contain at most ${PREVIEW_RUNTIME_INPUT_MAX_ENTRIES} entries`,
      })
    }
    const serializedBytes = new TextEncoder().encode(JSON.stringify(runtimeInputs)).byteLength
    if (serializedBytes > PREVIEW_RUNTIME_INPUT_MAX_SERIALIZED_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Preview runtime inputs may contain at most ${PREVIEW_RUNTIME_INPUT_MAX_SERIALIZED_BYTES} serialized bytes`,
      })
    }
  },
)

export type PreviewRuntimeInputs = z.infer<typeof previewRuntimeInputsShapeSchema>
