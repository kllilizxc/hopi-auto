export const ASSISTANT_PREFERENCE_PATH = '.hopi/preference.md'
export const DEFAULT_ASSISTANT_PREFERENCE = '# Preferences\n'
export const MAX_ASSISTANT_PREFERENCE_BYTES = 16_000

export interface AssistantPreferenceDocument {
  content: string
  digest: string
}

export class AssistantPreferenceValidationError extends Error {}

export function normalizeAssistantPreference(source: string) {
  const content = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  if (content.includes('\0')) {
    throw new AssistantPreferenceValidationError('Preference document contains a NUL byte')
  }
  const normalized = !content || content.endsWith('\n') ? content : `${content}\n`
  if (new TextEncoder().encode(normalized).byteLength > MAX_ASSISTANT_PREFERENCE_BYTES) {
    throw new AssistantPreferenceValidationError(
      `Preference document exceeds ${MAX_ASSISTANT_PREFERENCE_BYTES} bytes`,
    )
  }
  return normalized
}

export async function readAssistantPreference(
  source: string | null,
): Promise<AssistantPreferenceDocument> {
  const content = normalizeAssistantPreference(source ?? DEFAULT_ASSISTANT_PREFERENCE)
  const bytes = new TextEncoder().encode(content)
  const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))
  const digest = [...digestBytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return { content, digest }
}
