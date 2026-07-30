import type { WorkDocument, WorkOwnerMessage } from '../domain/canonicalDocuments'
import { renderWorkDocument } from '../domain/canonicalDocuments'
import { hashBytes } from '../publication/publisher'

export async function workAssignmentHash(work: WorkDocument) {
  const assignment = {
    ...work,
    attributes: {
      ...work.attributes,
      evidenceRefs: [],
      ownerMessages: [],
    },
  }
  return hashBytes(new TextEncoder().encode(renderWorkDocument(assignment)))
}

export function appendProjectOwnerMessage(
  messages: readonly WorkOwnerMessage[],
  input: WorkOwnerMessage,
) {
  const existing = messages.find((message) => message.sourceEventId === input.sourceEventId)
  if (existing) {
    if (existing.content !== input.content.trim()) {
      throw new Error(`Project Owner message already exists for ${input.sourceEventId}`)
    }
    return messages
  }
  return [...messages, { ...input, content: input.content.trim() }]
}
