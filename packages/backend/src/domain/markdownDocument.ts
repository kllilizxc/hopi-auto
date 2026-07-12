import { parse, stringify } from 'yaml'
import type { z } from 'zod'

export interface MarkdownDocument<T> {
  attributes: T
  body: string
}

export class MarkdownDocumentError extends Error {}

export function parseMarkdownDocument<T, Input>(
  source: string,
  schema: z.ZodType<T, z.ZodTypeDef, Input>,
  label: string,
): MarkdownDocument<T> {
  const normalized = source.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) {
    throw new MarkdownDocumentError(`${label} is missing YAML front matter`)
  }

  const delimiterIndex = normalized.indexOf('\n---\n', 4)
  if (delimiterIndex < 0) {
    throw new MarkdownDocumentError(`${label} has unterminated YAML front matter`)
  }

  let rawAttributes: unknown
  try {
    rawAttributes = parse(normalized.slice(4, delimiterIndex))
  } catch (error) {
    throw new MarkdownDocumentError(
      `${label} front matter is invalid YAML: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  const result = schema.safeParse(rawAttributes)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new MarkdownDocumentError(`${label} front matter is invalid: ${issues}`)
  }

  return {
    attributes: result.data,
    body: normalized.slice(delimiterIndex + 5),
  }
}

export function renderMarkdownDocument<T>(document: MarkdownDocument<T>) {
  const frontMatter = stringify(document.attributes, { indent: 2 }).trimEnd()
  return `---\n${frontMatter}\n---\n${document.body}`
}
