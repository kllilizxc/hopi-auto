import {
  type WorkDocument,
  isWorkTerminal,
  parseAttentionDocument,
  parseInputDocument,
  renderAttentionDocument,
  renderInputDocument,
} from '../domain/canonicalDocuments'
import { findNonPortableGoalImageReference } from '../domain/goalImageReference'
import { workCancellationClosure } from '../domain/workCancellation'
import { hashBytes } from '../publication/publisher'
import type { PublicationWrite } from '../publication/types'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import { AssistantToolRequestError } from './assistantToolRequestError'
import type { AssistantToolProject } from './assistantToolTypes'

type InboxEvent = NonNullable<Awaited<ReturnType<AssistantWorkspaceStore['readEvent']>>>

export function initialGoalBody(objective: string) {
  return ['## Objective', '', objective.trim(), ''].join('\n')
}

export async function prepareGoalReferences(
  workspace: AssistantWorkspaceStore,
  store: GoalPackageStore,
  goalId: string,
  requested: readonly { attachmentRef: string; purpose: string }[],
) {
  const writes: PublicationWrite[] = []
  const references: Array<{ path: string; purpose: string }> = []
  const seen = new Set<string>()
  const workspaceState = requested.length > 0 ? await workspace.readWorkspace() : null

  for (const reference of requested) {
    if (seen.has(reference.attachmentRef)) continue
    seen.add(reference.attachmentRef)
    const sourceEvent = workspaceState
      ? [...workspaceState.events.values()]
          .filter(
            (candidate) =>
              candidate.attributes.source === 'user' &&
              candidate.attributes.visibility === 'public' &&
              candidate.attributes.attachments.includes(reference.attachmentRef),
          )
          .toSorted((left, right) =>
            left.attributes.receivedAt.localeCompare(right.attributes.receivedAt),
          )[0]
      : null
    if (!sourceEvent) {
      throw new AssistantToolRequestError(
        `Attachment is not owned by a public Inbox turn: ${reference.attachmentRef}`,
      )
    }
    const attachment = await workspace.resolveAttachment(reference.attachmentRef)
    if (!attachment) {
      throw new AssistantToolRequestError(
        `Attachment is not a supported durable image: ${reference.attachmentRef}`,
      )
    }
    const assetPath = store.paths.asset(goalId, attachment.contentHash, attachment.fileName)
    const currentAsset = await currentBytes(store, assetPath)
    if (currentAsset) {
      if ((await hashBytes(currentAsset)) !== attachment.contentHash) {
        throw new AssistantToolRequestError(`Immutable Goal image content mismatch: ${assetPath}`)
      }
    } else {
      writes.push({
        path: assetPath,
        expectedHash: null,
        content: new Uint8Array(await Bun.file(attachment.absolutePath).arrayBuffer()),
      })
    }
    const purpose = reference.purpose.trim().replace(/\s+/g, ' ')
    assertPortableGoalText('Goal reference purpose', purpose)
    references.push({ path: assetPath, purpose })
  }
  return { writes, references }
}

export async function publishInput(
  workspace: AssistantWorkspaceStore,
  store: GoalPackageStore,
  goalId: string,
  event: InboxEvent,
) {
  const write = await newInputWrite(workspace, store, goalId, event)
  if (!write) return false
  await store.publishGoal(goalId, { supportingWrites: [], gateWrite: write })
  return true
}

export async function newInputWrite(
  workspace: AssistantWorkspaceStore,
  store: GoalPackageStore,
  goalId: string,
  event: InboxEvent,
) {
  return (await goalInputAdmission(workspace, store, goalId, event)).write
}

export async function goalInputAdmission(
  workspace: AssistantWorkspaceStore,
  store: GoalPackageStore,
  goalId: string,
  event: InboxEvent,
  requireExistingGoal = true,
) {
  if (requireExistingGoal) await requireGoal(store, goalId)
  const state = await workspace.readWorkspace()
  const path = store.paths.inputDocument(goalId, state.homeId, event.attributes.id)
  const document = {
    attributes: {
      sourceHomeId: state.homeId,
      sourceEventId: event.attributes.id,
      sourceDigest: event.attributes.sourceDigest,
      attachments: [...event.attributes.attachments],
    },
    body: event.body,
  }
  const expected = renderInputDocument(document)
  const file = Bun.file(store.paths.absolute(path))
  if (await file.exists()) {
    const current = parseInputDocument(await file.text())
    const rendered = renderInputDocument(current)
    if (rendered !== expected) {
      throw new AssistantToolRequestError(
        `Goal Input conflicts with Inbox turn ${event.attributes.id}`,
      )
    }
    return { path, document, write: null }
  }
  return {
    path,
    document,
    write: { path, expectedHash: null, content: expected } satisfies PublicationWrite,
  }
}

export async function resolveGoalAttention(
  store: GoalPackageStore,
  goalId: string,
  attentionId: string,
  resolution: string,
  admission: Awaited<ReturnType<typeof goalInputAdmission>>,
  resolvedAt: Date,
) {
  const path = store.paths.attentionDocument(goalId, attentionId)
  const absolutePath = store.paths.absolute(path)
  const file = Bun.file(absolutePath)
  if (!(await file.exists())) {
    throw new AssistantToolRequestError(`Goal Attention not found: ${attentionId}`)
  }
  const source = await file.text()
  const attention = parseAttentionDocument(source)
  if (attention.attributes.resolvedAt !== null) return false
  attention.attributes.resolvedAt = resolvedAt.toISOString()
  attention.attributes.resolutionInput = admission.path
  attention.body = [
    attention.body.trimEnd(),
    '',
    '## Resolution',
    '',
    `Answer Input: \`${admission.path}\``,
    '',
    resolution.trim(),
    '',
  ].join('\n')
  await store.publishGoal(goalId, {
    supportingWrites: admission.write ? [admission.write] : [],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderAttentionDocument(attention),
    },
  })
  return true
}

export function requireProject(
  projects: ReadonlyMap<string, AssistantToolProject>,
  projectId: string,
) {
  const project = projects.get(projectId)
  if (!project) throw new AssistantToolRequestError(`Project not found: ${projectId}`)
  return project
}

export function dependentWorkIds(
  goalPackage: Awaited<ReturnType<GoalPackageStore['readPackage']>>,
  rootId: string,
) {
  return workCancellationClosure(goalPackage, [rootId])
}

export function isTerminalWork(work: WorkDocument | undefined) {
  return Boolean(work && isWorkTerminal(work.attributes))
}

export async function requireGoal(store: GoalPackageStore, goalId: string) {
  const goal = await store.readGoal(goalId)
  if (!goal) throw new AssistantToolRequestError(`Goal not found: ${goalId}`)
  return goal
}

export function designPath(path: string, goalId: string) {
  const canonicalPrefix = `.hopi/docs/goals/${goalId}/design/`
  const portable = path.replaceAll('\\', '/')
  const normalized = portable.startsWith(canonicalPrefix)
    ? portable.slice(canonicalPrefix.length)
    : portable.replace(/^design\//, '')
  if (
    !normalized.endsWith('.md') ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('.hopi') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new AssistantToolRequestError(`Invalid Goal design path: ${path}`)
  }
  return normalized
}

export function normalizeMarkdown(content: string) {
  const normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

export function assertPortableGoalText(label: string, content: string) {
  const reference = findNonPortableGoalImageReference(content)
  if (reference) {
    throw new AssistantToolRequestError(
      `${label} cannot cite non-portable image path ${reference}; adopt the image through references and cite the returned Goal-local asset path`,
    )
  }
}

export async function currentBytes(store: GoalPackageStore, path: string) {
  const file = Bun.file(store.paths.absolute(path))
  return (await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : null
}

export function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
