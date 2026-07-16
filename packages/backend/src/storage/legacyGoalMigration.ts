import { parse } from 'yaml'
import { z } from 'zod'
import { workAttentionTarget } from '../domain/attentionTarget'
import {
  type AttentionDocument,
  type GoalDocument,
  type WorkDocument,
  parseGoalDocument,
  renderAttentionDocument,
  renderGoalDocument,
  renderWorkDocument,
} from '../domain/canonicalDocuments'
import { readAndValidateGoalPackage } from '../domain/goalPackage'
import { stableIdSchema } from '../domain/stableId'
import type { PublicationCoordinator } from '../publication/publisher'
import { hashBytes } from '../publication/publisher'
import { publicationCandidateFromSnapshot } from '../publication/snapshotCandidate'
import type { PublicationFaultHooks, PublicationWrite } from '../publication/types'
import type { GoalPackagePaths } from './goalPackagePaths'

const legacyItemSchema = z
  .object({
    ref: stableIdSchema,
    kind: z.string().optional(),
    status: z.string(),
    title: z.string().min(1),
    description: z.string().optional().default(''),
    acceptanceCriteria: z.array(z.string()).optional().default([]),
    dependencyTaskList: z.array(z.unknown()).optional().default([]),
    blockedBy: z.array(z.unknown()).optional().default([]),
  })
  .passthrough()
const legacyTodoSchema = z
  .object({
    goal: z
      .object({
        goalKey: z.string().optional(),
        title: z.string().min(1),
      })
      .passthrough(),
    items: z.array(legacyItemSchema),
  })
  .passthrough()

type LegacyItem = z.infer<typeof legacyItemSchema>

export interface LegacyGoalMigrationResult {
  goalId: string
  kind: 'migrated' | 'already_canonical'
}

export async function migrateLegacyGoals(
  paths: GoalPackagePaths,
  publisher: PublicationCoordinator,
  faultHooks: PublicationFaultHooks = {},
): Promise<LegacyGoalMigrationResult[]> {
  const projectSnapshot = await publisher.snapshotTree(paths.publicationRoot, paths.goalsRoot)
  const goalIds = discoverGoalIds(
    paths,
    projectSnapshot.files.map((file) => file.path),
  )
  const results: LegacyGoalMigrationResult[] = []

  for (const goalId of goalIds) {
    const snapshot = await publisher.snapshotTree(paths.publicationRoot, paths.goalRoot(goalId))
    const candidate = publicationCandidateFromSnapshot(snapshot)
    try {
      const goalPackage = await readAndValidateGoalPackage(candidate, paths, goalId)
      const interruptedMigration =
        (await candidate.exists(`${paths.designRoot(goalId)}/legacy-work.md`)) &&
        !goalPackage.works.has('plan-migration')
      if (!interruptedMigration) {
        results.push({ goalId, kind: 'already_canonical' })
        continue
      }
    } catch {
      // A legacy or interrupted migration is handled below from its durable todo.yml source.
    }

    const sourceByPath = new Map(
      snapshot.files.map((file) => [
        file.path,
        file.content ? new TextDecoder().decode(file.content) : null,
      ]),
    )
    const todoPath = `${paths.goalRoot(goalId)}/todo.yml`
    const todoSource = sourceByPath.get(todoPath)
    if (!todoSource) continue
    const legacy = parseLegacyTodo(goalId, todoSource)
    const migration = await buildMigration(paths, goalId, legacy, sourceByPath)

    await publisher.publish(
      {
        root: paths.publicationRoot,
        supportingWrites: migration.supportingWrites,
        gateWrite: migration.gateWrite,
        validateCandidate: (next) =>
          readAndValidateGoalPackage(next, paths, goalId).then(() => undefined),
      },
      faultHooks,
    )
    results.push({ goalId, kind: 'migrated' })
  }

  return results
}

function discoverGoalIds(paths: GoalPackagePaths, files: readonly string[]) {
  const prefix = `${paths.goalsRoot}/`
  return [
    ...new Set(
      files.flatMap((path) => {
        const relative = path.startsWith(prefix) ? path.slice(prefix.length) : ''
        const goalId = relative.split('/')[0]
        return goalId && stableIdSchema.safeParse(goalId).success ? [goalId] : []
      }),
    ),
  ].sort()
}

function parseLegacyTodo(goalId: string, source: string) {
  let parsed: unknown
  try {
    parsed = parse(source)
  } catch (error) {
    throw new Error(`Legacy Goal ${goalId} has invalid todo.yml: ${errorMessage(error)}`)
  }
  const result = legacyTodoSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Legacy Goal ${goalId} is unsupported: ${result.error.message}`)
  }
  const refs = result.data.items.map((item) => item.ref)
  if (new Set(refs).size !== refs.length) {
    throw new Error(`Legacy Goal ${goalId} has duplicate Work refs`)
  }
  return result.data
}

async function buildMigration(
  paths: GoalPackagePaths,
  goalId: string,
  legacy: z.infer<typeof legacyTodoSchema>,
  sourceByPath: ReadonlyMap<string, string | null>,
) {
  const oldGoalPath = paths.goalDocument(goalId)
  const oldGoalSource = sourceByPath.get(oldGoalPath) ?? ''
  const designSource =
    sourceByPath.get(`${paths.goalRoot(goalId)}/design.md`) ??
    `# ${legacy.goal.title} Design\n\nNo legacy design document was recorded.\n`
  const activeEngineering = legacy.items.filter(
    (item) => item.kind !== 'planning' && !isLegacyTerminal(item.status),
  )
  const activeIds = new Set(activeEngineering.map((item) => item.ref))
  const parsedCurrentGoal = parseCanonicalGoal(sourceByPath.get(oldGoalPath))
  const goal: GoalDocument = parsedCurrentGoal ?? {
    attributes: {
      id: goalId,
      title: legacy.goal.title.trim(),
      lifecycle: 'active',
      priority: 0,
      contractRevision: 1,
      completionAttentionId: null,
    },
    body: renderMigratedGoalBody(oldGoalSource),
  }
  const planning: WorkDocument = {
    attributes: {
      id: 'plan-migration',
      title: 'Reconcile the migrated Goal',
      kind: 'planning',
      stage: 'plan',
      notBefore: null,
      dependsOn: [],
      contractRevision: 1,
      evidenceRefs: [],
      attempts: 0,
    },
    body: [
      '## Objective',
      '',
      'Reassess the imported contract, design, unfinished Work, and current repository state.',
      '',
      '## Acceptance Criteria',
      '',
      '- The design reflects current facts rather than legacy workflow state.',
      '- Remaining Engineering Work and its permanent dependency edges are explicit.',
      '- Completed legacy entries are treated as history, not fabricated Run Evidence.',
      '',
    ].join('\n'),
  }
  const goalSource = renderGoalDocument(goal)
  const supportingWrites: PublicationWrite[] = [
    {
      path: oldGoalPath,
      expectedHash: parsedCurrentGoal
        ? await hashBytes(new TextEncoder().encode(goalSource))
        : await hashOptional(oldGoalSource),
      content: goalSource,
    },
    {
      path: paths.designIndex(goalId),
      expectedHash: null,
      content: ensureTrailingNewline(designSource),
    },
    {
      path: `${paths.designRoot(goalId)}/legacy-work.md`,
      expectedHash: null,
      content: renderLegacyHistory(legacy.items),
    },
  ]

  for (const item of activeEngineering) {
    supportingWrites.push({
      path: paths.workDocument(goalId, item.ref),
      expectedHash: null,
      content: renderWorkDocument(migrateEngineeringWork(item, activeIds)),
    })
    if (item.blockedBy.length > 0) {
      const attention = migrateBlocker(paths, goalId, item)
      supportingWrites.push({
        path: paths.attentionDocument(goalId, attention.attributes.id),
        expectedHash: null,
        content: renderAttentionDocument(attention),
      })
    }
  }

  return {
    supportingWrites,
    gateWrite: {
      path: paths.workDocument(goalId, planning.attributes.id),
      expectedHash: null,
      content: renderWorkDocument(planning),
    },
  }
}

function migrateEngineeringWork(item: LegacyItem, activeIds: ReadonlySet<string>): WorkDocument {
  const dependsOn = [...new Set(readDependencyRefs(item).filter((ref) => activeIds.has(ref)))]
  return {
    attributes: {
      id: item.ref,
      title: item.title.trim(),
      kind: 'engineering',
      stage: 'generate',
      notBefore: null,
      dependsOn,
      contractRevision: 1,
      evidenceRefs: [],
      attempts: 0,
    },
    body: [
      '## Objective',
      '',
      item.description.trim() || item.title.trim(),
      '',
      '## Acceptance Criteria',
      '',
      markdownList(item.acceptanceCriteria, 'Planner must make acceptance measurable.'),
      '',
      `Legacy status: \`${item.status}\`. Any prior partial output is untrusted and must be inspected.`,
      '',
    ].join('\n'),
  }
}

function migrateBlocker(
  paths: GoalPackagePaths,
  goalId: string,
  item: LegacyItem,
): AttentionDocument {
  return {
    attributes: {
      id: `legacy-blocker-${item.ref}`,
      target: workAttentionTarget(paths.projectId, goalId, item.ref),
      createdAt: '1970-01-01T00:00:00.000Z',
      resolvedAt: null,
      notifiedAt: null,
    },
    body: [
      `Legacy Work \`${item.ref}\` had unresolved blockers when imported.`,
      '',
      '```yaml',
      stringifyUnknown(item.blockedBy),
      '```',
      '',
      'The legacy source did not retain a reliable creation timestamp.',
      '',
    ].join('\n'),
  }
}

function renderMigratedGoalBody(source: string) {
  const content = source.trim()
  return [
    '## Imported Contract',
    '',
    content || 'The legacy Goal had no goal.md content.',
    '',
    '## Migration Note',
    '',
    'This contract was imported from the pre-MVP document layout and requires Planning review.',
    '',
  ].join('\n')
}

function renderLegacyHistory(items: readonly LegacyItem[]) {
  const sections = items.map((item) =>
    [
      `## ${item.title.trim()}`,
      '',
      `- Legacy ref: \`${item.ref}\``,
      `- Legacy kind: \`${item.kind ?? 'unspecified'}\``,
      `- Legacy status: \`${item.status}\``,
      '',
      item.description.trim() || 'No description was recorded.',
      '',
      '### Acceptance Criteria',
      '',
      markdownList(item.acceptanceCriteria, 'None recorded.'),
      '',
    ].join('\n'),
  )
  return [
    '# Legacy Work History',
    '',
    'Imported for provenance only. This file is not workflow authority.',
    '',
    ...sections,
  ].join('\n')
}

function readDependencyRefs(item: LegacyItem) {
  return [...item.dependencyTaskList, ...item.blockedBy].flatMap((value) => {
    if (typeof value === 'string') return stableIdSchema.safeParse(value).success ? [value] : []
    if (!value || typeof value !== 'object') return []
    const record = value as Record<string, unknown>
    if (record.kind === 'intervention') return []
    return typeof record.ref === 'string' && stableIdSchema.safeParse(record.ref).success
      ? [record.ref]
      : []
  })
}

function isLegacyTerminal(status: string) {
  return status === 'done' || status === 'cancelled'
}

function parseCanonicalGoal(source: string | null | undefined) {
  if (!source) return null
  try {
    return parseGoalDocument(source)
  } catch {
    return null
  }
}

async function hashOptional(source: string) {
  return source ? hashBytes(new TextEncoder().encode(source)) : null
}

function markdownList(values: readonly string[], fallback: string) {
  return values.length > 0 ? values.map((value) => `- ${value.trim()}`).join('\n') : `- ${fallback}`
}

function stringifyUnknown(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function ensureTrailingNewline(value: string) {
  return `${value.trimEnd()}\n`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
