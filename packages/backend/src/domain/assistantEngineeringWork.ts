import type { WorkDocument } from './canonicalDocuments'
import type { InboxEventReference } from './inboxEventReference'

export interface AssistantEngineeringWorkInput {
  id: string
  title: string
  objective: string
  acceptanceCriteria: readonly string[]
  repos: readonly string[]
  dependsOn?: readonly string[]
  contractRevision: number
  assistantDispatch: InboxEventReference
  acceptedInputPath: string
  references?: readonly { path: string; purpose: string }[]
}

export function createAssistantEngineeringWork(input: AssistantEngineeringWorkInput): WorkDocument {
  return {
    attributes: {
      id: input.id,
      title: input.title.trim(),
      kind: 'engineering',
      stage: 'generate',
      repos: [...input.repos],
      notBefore: null,
      dependsOn: [...(input.dependsOn ?? [])],
      contractRevision: input.contractRevision,
      evidenceRefs: [],
      attempts: 0,
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
      '## Accepted Inputs',
      '',
      `- ${input.acceptedInputPath}`,
      '',
      ...(input.references?.length
        ? [
            '## Reference Images',
            '',
            ...input.references.map(
              (reference) => `- \`${reference.path}\` - ${reference.purpose.trim()}`,
            ),
            '',
          ]
        : []),
    ].join('\n'),
  }
}
