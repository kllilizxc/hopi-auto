import {
  goalAttentionReference,
  normalizeInboxAttentionReferences,
  workspaceAttentionReference,
} from '../domain/attentionReference'
import { inboxEventReference } from '../domain/inboxEventReference'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import { acknowledgeGoalAttention } from './attentionDelivery'

export async function migrateLegacyAttentionOwnership(input: {
  workspace: AssistantWorkspaceStore
  projects: ReadonlyMap<string, { store: GoalPackageStore }>
}) {
  const workspace = await input.workspace.readWorkspace()
  const requestEvents = new Map<string, string>()
  const orderedEvents = [...workspace.events.values()].sort((left, right) =>
    left.attributes.receivedAt.localeCompare(right.attributes.receivedAt),
  )
  for (const event of orderedEvents) {
    if (
      event.attributes.source !== 'reflection' ||
      event.attributes.visibility !== 'public' ||
      event.attributes.status !== 'handled' ||
      !event.attributes.context
    ) {
      continue
    }
    const eventReference = inboxEventReference(workspace.homeId, event.attributes.id)
    for (const attentionReference of normalizeInboxAttentionReferences(event.attributes.context)) {
      requestEvents.set(attentionReference, eventReference)
    }
  }

  let migrated = 0
  for (const attention of workspace.attentions.values()) {
    if (
      attention.attributes.resolvedAt !== null ||
      attention.attributes.notifiedAt === null ||
      attention.attributes.operatorRequest !== undefined
    ) {
      continue
    }
    const request = requestEvents.get(
      workspaceAttentionReference(workspace.homeId, attention.attributes.id),
    )
    if (!request) continue
    await input.workspace.markAttentionNotified(
      attention.attributes.id,
      new Date(attention.attributes.notifiedAt),
      request,
    )
    migrated += 1
  }

  for (const [projectId, project] of input.projects) {
    let goalIds: string[]
    try {
      goalIds = await project.store.listGoalIds()
    } catch {
      continue
    }
    for (const goalId of goalIds) {
      let goalPackage: Awaited<ReturnType<GoalPackageStore['readPackage']>>
      try {
        goalPackage = await project.store.readPackage(goalId)
      } catch {
        continue
      }
      for (const attention of goalPackage.attentions.values()) {
        if (
          attention.attributes.target === null ||
          attention.attributes.resolvedAt !== null ||
          attention.attributes.notifiedAt === null ||
          attention.attributes.operatorRequest !== undefined
        ) {
          continue
        }
        const request = requestEvents.get(
          goalAttentionReference(projectId, goalId, attention.attributes.id),
        )
        if (!request) continue
        if (
          await acknowledgeGoalAttention(
            project.store,
            goalId,
            attention.attributes.id,
            new Date(attention.attributes.notifiedAt),
            request,
          )
        ) {
          migrated += 1
        }
      }
    }
  }
  return migrated
}
