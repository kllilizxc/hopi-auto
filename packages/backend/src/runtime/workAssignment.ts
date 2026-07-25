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
