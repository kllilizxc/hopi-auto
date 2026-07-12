import { parseAttentionDocument, renderAttentionDocument } from '../domain/canonicalDocuments'
import { hashBytes } from '../publication/publisher'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'

export interface AttentionDeliveryMessage {
  key: string
  target: string | null
  body: string
  projectId?: string
  goalId?: string
  attentionId: string
}

export interface AttentionTransport {
  send(message: AttentionDeliveryMessage): Promise<void>
}

export interface AttentionDeliveryProject {
  projectId: string
  store: GoalPackageStore
}

export interface AttentionDeliveryWorker {
  deliverOnce(projects: readonly AttentionDeliveryProject[]): Promise<number>
}

export interface AttentionDeliveryOptions {
  now?: () => Date
  beforeAcknowledgement?(message: AttentionDeliveryMessage): Promise<void> | void
  retryBaseMs?: number
  retryMaxMs?: number
}

export function createAttentionDeliveryWorker(
  workspace: AssistantWorkspaceStore,
  transport: AttentionTransport,
  options: AttentionDeliveryOptions = {},
): AttentionDeliveryWorker {
  const now = options.now ?? (() => new Date())
  const retryBaseMs = options.retryBaseMs ?? 1_000
  const retryMaxMs = options.retryMaxMs ?? 60_000
  const retries = new Map<string, { failures: number; nextAt: number }>()

  async function send(
    message: AttentionDeliveryMessage,
    acknowledge: (acknowledgedAt: Date) => Promise<void>,
  ) {
    const currentTime = now()
    const retry = retries.get(message.key)
    if (retry && retry.nextAt > currentTime.getTime()) return false
    try {
      await transport.send(message)
    } catch {
      const failures = (retry?.failures ?? 0) + 1
      const delay = Math.min(retryBaseMs * 2 ** Math.min(failures - 1, 20), retryMaxMs)
      retries.set(message.key, { failures, nextAt: currentTime.getTime() + delay })
      return false
    }
    retries.delete(message.key)
    await options.beforeAcknowledgement?.(message)
    await acknowledge(now())
    return true
  }

  return {
    async deliverOnce(projects) {
      let delivered = 0
      const workspaceState = await workspace.readWorkspace()
      for (const attention of workspaceState.attentions.values()) {
        if (attention.attributes.resolvedAt !== null || attention.attributes.notifiedAt !== null) {
          continue
        }
        const message: AttentionDeliveryMessage = {
          key: `${workspaceState.homeId}/${attention.attributes.id}`,
          target: attention.attributes.target,
          body: attention.body,
          attentionId: attention.attributes.id,
        }
        if (
          await send(message, (acknowledgedAt) =>
            workspace
              .markAttentionNotified(attention.attributes.id, acknowledgedAt)
              .then(() => undefined),
          )
        ) {
          delivered += 1
        }
      }

      for (const project of projects) {
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
              attention.attributes.resolvedAt !== null ||
              attention.attributes.notifiedAt !== null
            ) {
              continue
            }
            const completion = attention.attributes.target === null
            if (
              completion &&
              (goalPackage.goal.attributes.lifecycle !== 'done' ||
                goalPackage.goal.attributes.completionAttentionId !== attention.attributes.id)
            ) {
              continue
            }
            const message: AttentionDeliveryMessage = {
              key: `${project.projectId}/${goalId}/${attention.attributes.id}`,
              target: attention.attributes.target,
              body: attention.body,
              projectId: project.projectId,
              goalId,
              attentionId: attention.attributes.id,
            }
            if (
              await send(message, (acknowledgedAt) =>
                acknowledgeGoalAttention(
                  project.store,
                  goalId,
                  attention.attributes.id,
                  acknowledgedAt,
                ).then(() => undefined),
              )
            ) {
              delivered += 1
            }
          }
        }
      }
      return delivered
    },
  }
}

export function createWebhookAttentionTransport(
  webhookUrl: string,
  request: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
): AttentionTransport {
  const endpoint = new URL(webhookUrl)
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('Attention webhook must use http or https')
  }
  return {
    async send(message) {
      const response = await request(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': message.key,
        },
        body: JSON.stringify(message),
      })
      if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 512)
        throw new Error(
          `Attention webhook returned ${response.status}${detail ? `: ${detail}` : ''}`,
        )
      }
    },
  }
}

export async function acknowledgeGoalAttention(
  store: GoalPackageStore,
  goalId: string,
  attentionId: string,
  acknowledgedAt: Date,
) {
  const goalPackage = await store.readPackage(goalId)
  const current = goalPackage.attentions.get(attentionId)
  if (
    !current ||
    current.attributes.resolvedAt !== null ||
    current.attributes.notifiedAt !== null
  ) {
    return false
  }
  const completion = current.attributes.target === null
  if (
    completion &&
    (goalPackage.goal.attributes.lifecycle !== 'done' ||
      goalPackage.goal.attributes.completionAttentionId !== attentionId)
  ) {
    return false
  }
  const path = store.paths.attentionDocument(goalId, attentionId)
  const source = await Bun.file(store.paths.absolute(path)).text()
  const attention = parseAttentionDocument(source)
  attention.attributes.notifiedAt = acknowledgedAt.toISOString()
  if (completion) {
    attention.attributes.resolvedAt = acknowledgedAt.toISOString()
    attention.body += '\n## Resolution\n\nCompletion update delivered.\n'
  }
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderAttentionDocument(attention),
    },
    validateTransition(currentPackage) {
      const currentGoal = currentPackage.goal.attributes
      if (
        completion &&
        (currentGoal.lifecycle !== 'done' || currentGoal.completionAttentionId !== attentionId)
      ) {
        throw new Error('Completion Attention is no longer deliverable')
      }
    },
  })
  return true
}
