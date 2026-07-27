import type { WorkDocument } from '../domain/canonicalDocuments'
import { renderWorkDocument } from '../domain/canonicalDocuments'
import { hashBytes } from '../publication/publisher'

const PROJECT_OWNER_MESSAGES_HEADING = '## HOPI Project Owner Messages'

export async function workAssignmentHash(work: WorkDocument) {
  const assignment = {
    ...work,
    body: workBodyWithoutProjectOwnerMessages(work.body),
    attributes: {
      ...work.attributes,
      evidenceRefs: [],
    },
  }
  return hashBytes(new TextEncoder().encode(renderWorkDocument(assignment)))
}

export function appendProjectOwnerMessage(
  body: string,
  input: { recordedAt: string; sourceEventId: string; content: string },
) {
  const normalized = body.trimEnd()
  const sourceMarker = `Source event: ${input.sourceEventId}`
  const existingSource = normalized.indexOf(sourceMarker)
  if (existingSource !== -1) {
    const contentStart = existingSource + sourceMarker.length
    const nextMessage = normalized.indexOf('\n### ', contentStart)
    const existingContent = normalized
      .slice(contentStart, nextMessage === -1 ? undefined : nextMessage)
      .trim()
    if (existingContent !== input.content.trim()) {
      throw new Error(`Project Owner message already exists for ${input.sourceEventId}`)
    }
    return body
  }
  const hasMessages = normalized.includes(`\n${PROJECT_OWNER_MESSAGES_HEADING}\n`)
  return [
    normalized,
    ...(hasMessages ? [] : ['', PROJECT_OWNER_MESSAGES_HEADING]),
    '',
    `### ${input.recordedAt}`,
    '',
    `Source event: ${input.sourceEventId}`,
    '',
    input.content.trim(),
    '',
  ].join('\n')
}

function workBodyWithoutProjectOwnerMessages(body: string) {
  const marker = `\n${PROJECT_OWNER_MESSAGES_HEADING}\n`
  const index = body.indexOf(marker)
  return index === -1 ? body : `${body.slice(0, index).trimEnd()}\n`
}
