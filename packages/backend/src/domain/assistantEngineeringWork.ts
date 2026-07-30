import type { WorkContextRef, WorkDocument } from './canonicalDocuments'
import type { InboxEventReference } from './inboxEventReference'

export interface AssistantEngineeringWorkInput {
  id: string
  title: string
  objective: string
  acceptanceCriteria: readonly string[]
  dependsOn?: readonly string[]
  contractRevision: number
  assistantDispatch: InboxEventReference
  acceptedInputPath: string
  references?: readonly WorkContextRef[]
}

export function createAssistantEngineeringWork(input: AssistantEngineeringWorkInput): WorkDocument {
  return {
    attributes: {
      id: input.id,
      title: input.title.trim(),
      kind: 'engineering',
      stage: 'generate',
      notBefore: null,
      dependsOn: [...(input.dependsOn ?? [])],
      contractRevision: input.contractRevision,
      evidenceRefs: [],
      contextRefs: mergeContextRefs([
        { path: input.acceptedInputPath, purpose: 'Accepted Inbox input' },
        ...(input.references ?? []),
      ]),
      ownerMessages: [],
      assistantDispatch: input.assistantDispatch,
    },
    body: [
      '## Objective',
      '',
      input.objective.trim(),
      '',
      '## Acceptance Criteria',
      '',
      ...input.acceptanceCriteria.map((criterion) => `- ${criterion.trim()}`),
      '',
    ].join('\n'),
  }
}

function mergeContextRefs(references: readonly WorkContextRef[]) {
  return [...new Map(references.map((reference) => [reference.path, reference])).values()]
}
