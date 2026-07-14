import type { PublicationCandidate } from '../publication/types'
import type { GoalPackagePaths } from '../storage/goalPackagePaths'
import { goalAttentionTarget, matchGoalAttentionTarget } from './attentionTarget'
import {
  type AttentionDocument,
  type EvidenceDocument,
  type GoalDocument,
  type InputDocument,
  type WorkDocument,
  isEngineeringWork,
  isPlanningWork,
  isWorkTerminal,
  parseAttentionDocument,
  parseEvidenceDocument,
  parseGoalDocument,
  parseInputDocument,
  parseWorkDocument,
} from './canonicalDocuments'

export interface GoalPackage {
  goal: GoalDocument
  works: ReadonlyMap<string, WorkDocument>
  attentions: ReadonlyMap<string, AttentionDocument>
  evidence: ReadonlyMap<string, EvidenceDocument>
  inputs: readonly InputDocument[]
}

export class GoalPackageValidationError extends Error {}

export async function readAndValidateGoalPackage(
  candidate: PublicationCandidate,
  paths: GoalPackagePaths,
  goalId: string,
): Promise<GoalPackage> {
  const goalRoot = paths.goalRoot(goalId)
  const filePaths = await candidate.listFiles(goalRoot)
  const goalSource = await candidate.readText(paths.goalDocument(goalId))
  if (goalSource === null) {
    throw invalid(goalId, 'goal.md is missing')
  }

  const goal = parseWithContext(goalId, 'goal.md', () => parseGoalDocument(goalSource))
  if (goal.attributes.id !== goalId) {
    throw invalid(goalId, `goal.md owns ID ${goal.attributes.id}`)
  }
  if (!(await candidate.exists(paths.designIndex(goalId)))) {
    throw invalid(goalId, 'design/index.md is missing')
  }

  const works = new Map<string, WorkDocument>()
  const attentions = new Map<string, AttentionDocument>()
  const evidence = new Map<string, EvidenceDocument>()
  const inputs: InputDocument[] = []

  for (const path of filePaths) {
    const source = await candidate.readText(path)
    if (source === null) continue

    const workId = matchLocalDocumentId(path, paths.workRoot(goalId))
    if (workId) {
      const document = parseWithContext(goalId, path, () => parseWorkDocument(source))
      assertPathIdentity(goalId, path, workId, document.attributes.id)
      works.set(workId, document)
      continue
    }

    const attentionId = matchLocalDocumentId(path, paths.attentionRoot(goalId))
    if (attentionId) {
      const document = parseWithContext(goalId, path, () => parseAttentionDocument(source))
      assertPathIdentity(goalId, path, attentionId, document.attributes.id)
      attentions.set(attentionId, document)
      continue
    }

    const evidenceId = matchLocalDocumentId(path, paths.evidenceRoot(goalId))
    if (evidenceId) {
      const document = parseWithContext(goalId, path, () => parseEvidenceDocument(source))
      assertPathIdentity(goalId, path, evidenceId, document.attributes.id)
      evidence.set(evidenceId, document)
      continue
    }

    const inputIdentity = matchInputIdentity(path, paths.inputsRoot(goalId))
    if (inputIdentity) {
      const document = parseWithContext(goalId, path, () => parseInputDocument(source))
      if (
        document.attributes.sourceHomeId !== inputIdentity.sourceHomeId ||
        document.attributes.sourceEventId !== inputIdentity.eventId
      ) {
        throw invalid(goalId, `Input identity does not match its path: ${path}`)
      }
      inputs.push(document)
    }
  }

  validateWorkGraph(paths.projectId, goalId, goal, works, evidence)
  validateAttentions(paths.projectId, goalId, goal, works, attentions)
  validateEvidenceOwnership(paths.projectId, goalId, works, evidence)

  return { goal, works, attentions, evidence, inputs }
}

export async function validateGoalPackageTransition(
  current: PublicationCandidate,
  candidate: PublicationCandidate,
  paths: GoalPackagePaths,
  goalId: string,
) {
  const next = await readAndValidateGoalPackage(candidate, paths, goalId)
  if (!(await current.exists(paths.goalDocument(goalId)))) {
    validateNewGoal(goalId, next)
    return next
  }

  const previous = await readAndValidateGoalPackage(current, paths, goalId)
  validateGoalTransition(goalId, previous, next)
  await validateImmutableDocuments(current, candidate, paths, goalId, previous, next)
  return next
}

function validateNewGoal(goalId: string, goalPackage: GoalPackage) {
  const goal = goalPackage.goal.attributes
  const planning = [...goalPackage.works.values()].filter(
    (work) => isPlanningWork(work.attributes) && work.attributes.stage === 'plan',
  )
  if (
    goal.lifecycle !== 'active' ||
    goal.contractRevision !== 1 ||
    goal.completionAttentionId !== null ||
    planning.length !== 1 ||
    [...goalPackage.works.values()].some((work) => isEngineeringWork(work.attributes))
  ) {
    throw invalid(goalId, 'new Goal must start active at revision 1 with one Planning Work')
  }
}

function validateGoalTransition(goalId: string, previous: GoalPackage, next: GoalPackage) {
  const before = previous.goal
  const after = next.goal
  if (after.attributes.id !== before.attributes.id) {
    throw invalid(goalId, 'Goal identity is immutable')
  }
  if (
    after.attributes.contractRevision < before.attributes.contractRevision ||
    after.attributes.contractRevision > before.attributes.contractRevision + 1
  ) {
    throw invalid(goalId, 'contractRevision may only stay current or increment once')
  }
  if (
    after.body !== before.body &&
    after.attributes.contractRevision === before.attributes.contractRevision
  ) {
    throw invalid(goalId, 'Goal contract content changed without a contractRevision increment')
  }
  if (!legalGoalLifecycleTransition(before.attributes.lifecycle, after.attributes.lifecycle)) {
    throw invalid(
      goalId,
      `illegal Goal lifecycle transition ${before.attributes.lifecycle} -> ${after.attributes.lifecycle}`,
    )
  }
  if (
    before.attributes.lifecycle !== 'active' &&
    after.attributes.lifecycle === 'active' &&
    after.attributes.contractRevision !== before.attributes.contractRevision + 1 &&
    before.attributes.lifecycle !== 'paused'
  ) {
    throw invalid(goalId, 'reopening a terminal Goal must increment contractRevision')
  }

  for (const [workId, previousWork] of previous.works) {
    const nextWork = next.works.get(workId)
    if (!nextWork) {
      throw invalid(goalId, `historical Work ${workId} was removed`)
    }
    validateWorkTransition(goalId, previousWork, nextWork)
  }
}

function validateWorkTransition(goalId: string, previous: WorkDocument, next: WorkDocument) {
  const before = previous.attributes
  const after = next.attributes
  if (before.id !== after.id || before.kind !== after.kind) {
    throw invalid(goalId, `Work identity or kind changed: ${before.id}`)
  }
  if (isWorkTerminal(before)) {
    if (JSON.stringify(before) !== JSON.stringify(after) || previous.body !== next.body) {
      throw invalid(goalId, `terminal Work is immutable: ${before.id}`)
    }
    return
  }
  if (after.contractRevision < before.contractRevision) {
    throw invalid(goalId, `Work contractRevision moved backwards: ${before.id}`)
  }
  if (!before.dependsOn.every((dependencyId) => after.dependsOn.includes(dependencyId))) {
    throw invalid(goalId, `Work dependency history was removed: ${before.id}`)
  }
  if (before.evidenceRefs.some((evidenceId, index) => after.evidenceRefs[index] !== evidenceId)) {
    throw invalid(goalId, `Work Evidence history is not append-only: ${before.id}`)
  }
}

async function validateImmutableDocuments(
  current: PublicationCandidate,
  candidate: PublicationCandidate,
  paths: GoalPackagePaths,
  goalId: string,
  previous: GoalPackage,
  next: GoalPackage,
) {
  for (const evidenceId of previous.evidence.keys()) {
    await assertSameBytes(
      current,
      candidate,
      paths.evidenceDocument(goalId, evidenceId),
      `Evidence is immutable: ${evidenceId}`,
    )
  }

  for (const input of previous.inputs) {
    await assertSameBytes(
      current,
      candidate,
      paths.inputDocument(goalId, input.attributes.sourceHomeId, input.attributes.sourceEventId),
      `Input is immutable: ${input.attributes.sourceHomeId}/${input.attributes.sourceEventId}`,
    )
  }

  for (const [attentionId, previousAttention] of previous.attentions) {
    const nextAttention = next.attentions.get(attentionId)
    if (!nextAttention) {
      throw invalid(goalId, `historical Attention ${attentionId} was removed`)
    }
    const before = previousAttention.attributes
    const after = nextAttention.attributes
    if (
      before.id !== after.id ||
      before.target !== after.target ||
      before.createdAt !== after.createdAt
    ) {
      throw invalid(goalId, `Attention identity or target changed: ${attentionId}`)
    }
    if (before.resolvedAt !== null && before.resolvedAt !== after.resolvedAt) {
      throw invalid(goalId, `Attention resolution changed after publication: ${attentionId}`)
    }
    if (before.notifiedAt !== null && before.notifiedAt !== after.notifiedAt) {
      throw invalid(goalId, `Attention delivery acknowledgement changed: ${attentionId}`)
    }
    if (!nextAttention.body.startsWith(previousAttention.body)) {
      throw invalid(goalId, `Attention notification body was rewritten: ${attentionId}`)
    }
  }
}

async function assertSameBytes(
  current: PublicationCandidate,
  candidate: PublicationCandidate,
  path: string,
  message: string,
) {
  const [before, after] = await Promise.all([current.readBytes(path), candidate.readBytes(path)])
  if (!before || !after || before.length !== after.length) {
    throw new GoalPackageValidationError(message)
  }
  for (const [index, value] of before.entries()) {
    if (after[index] !== value) {
      throw new GoalPackageValidationError(message)
    }
  }
}

function legalGoalLifecycleTransition(
  before: GoalDocument['attributes']['lifecycle'],
  after: GoalDocument['attributes']['lifecycle'],
) {
  const legal = {
    active: new Set(['active', 'paused', 'done', 'cancelled']),
    paused: new Set(['paused', 'active', 'cancelled']),
    done: new Set(['done', 'active']),
    cancelled: new Set(['cancelled', 'active']),
  } as const
  return legal[before].has(after)
}

function validateWorkGraph(
  projectId: string,
  goalId: string,
  goal: GoalDocument,
  works: Map<string, WorkDocument>,
  evidence: Map<string, EvidenceDocument>,
) {
  const openPlanning = [...works.values()].filter(
    (work) => isPlanningWork(work.attributes) && work.attributes.stage === 'plan',
  )
  if (openPlanning.length > 1) {
    throw invalid(goalId, 'more than one nonterminal Planning Work exists')
  }

  const consumedRuns = new Map<string, string>()
  for (const [workId, work] of works) {
    const attributes = work.attributes
    if (
      !isWorkTerminal(attributes) &&
      attributes.contractRevision !== goal.attributes.contractRevision
    ) {
      const isGuardedFutureSupport =
        openPlanning.length === 1 &&
        (goal.attributes.lifecycle === 'active' || goal.attributes.lifecycle === 'paused') &&
        attributes.contractRevision === goal.attributes.contractRevision + 1
      if (!isGuardedFutureSupport) {
        throw invalid(goalId, `nonterminal Work ${workId} uses an invalid contractRevision`)
      }
    }

    if (
      isEngineeringWork(attributes) &&
      attributes.stage === 'done' &&
      attributes.evidenceRefs.length === 0
    ) {
      throw invalid(goalId, `done Engineering Work ${workId} has no Evidence`)
    }

    for (const dependencyId of attributes.dependsOn) {
      const dependency = works.get(dependencyId)
      if (!dependency || !isEngineeringWork(dependency.attributes)) {
        throw invalid(goalId, `Work ${workId} depends on missing Engineering Work ${dependencyId}`)
      }
      if (!isWorkTerminal(attributes) && dependency.attributes.stage === 'cancelled') {
        throw invalid(
          goalId,
          `nonterminal Work ${workId} depends on cancelled Work ${dependencyId}`,
        )
      }
    }

    for (const evidenceId of attributes.evidenceRefs) {
      const document = evidence.get(evidenceId)
      if (!document) {
        throw invalid(goalId, `Work ${workId} references missing Evidence ${evidenceId}`)
      }
      const producerRun = document.attributes.producerRun
      if (producerRun) {
        const expectedPrefix = `${goalAttentionTarget(projectId, goalId)}/work:`
        if (!producerRun.startsWith(expectedPrefix)) {
          throw invalid(goalId, `Evidence ${evidenceId} has a producerRun outside the Goal`)
        }
        const consumedBy = consumedRuns.get(producerRun)
        if (consumedBy && consumedBy !== workId) {
          throw invalid(goalId, `producerRun ${producerRun} is consumed by more than one Work`)
        }
        consumedRuns.set(producerRun, workId)
      }
    }
  }

  assertAcyclicEngineeringGraph(goalId, works)

  if (
    goal.attributes.lifecycle === 'done' &&
    [...works.values()].some((work) => !isWorkTerminal(work.attributes))
  ) {
    throw invalid(goalId, 'done Goal still has nonterminal Work')
  }
}

function validateAttentions(
  projectId: string,
  goalId: string,
  goal: GoalDocument,
  works: Map<string, WorkDocument>,
  attentions: Map<string, AttentionDocument>,
) {
  const openUnclaimedCompletion: string[] = []
  let openTargeted = 0

  for (const [attentionId, attention] of attentions) {
    const { target, resolvedAt } = attention.attributes
    if (target === null) {
      if (resolvedAt === null && attentionId !== goal.attributes.completionAttentionId) {
        openUnclaimedCompletion.push(attentionId)
      }
      continue
    }

    const match = matchGoalAttentionTarget(projectId, goalId, target)
    if (!match) {
      throw invalid(goalId, `Attention ${attentionId} targets outside its Goal`)
    }
    if (match.scope === 'work' && !works.has(match.workId)) {
      throw invalid(goalId, `Attention ${attentionId} targets missing Work`)
    }
    if (resolvedAt === null) openTargeted += 1
  }

  if (openUnclaimedCompletion.length > 1) {
    throw invalid(goalId, 'more than one open unclaimed completion Attention exists')
  }

  const completionId = goal.attributes.completionAttentionId
  if (completionId) {
    const completion = attentions.get(completionId)
    if (!completion || completion.attributes.target !== null) {
      throw invalid(goalId, 'completionAttentionId does not reference targetless Attention')
    }
  }

  if (goal.attributes.lifecycle === 'done' && openTargeted > 0) {
    throw invalid(goalId, 'done Goal still has open targeted Attention')
  }
}

function validateEvidenceOwnership(
  projectId: string,
  goalId: string,
  works: Map<string, WorkDocument>,
  evidence: Map<string, EvidenceDocument>,
) {
  const goalOwner = goalAttentionTarget(projectId, goalId)
  for (const [evidenceId, document] of evidence) {
    const owner = document.attributes.owner
    if (owner === goalOwner) continue
    const target = matchGoalAttentionTarget(projectId, goalId, owner)
    if (target?.scope !== 'work' || !works.has(target.workId)) {
      throw invalid(goalId, `Evidence ${evidenceId} has an invalid owner`)
    }
  }
}

function assertAcyclicEngineeringGraph(goalId: string, works: Map<string, WorkDocument>) {
  const visited = new Set<string>()
  const visiting = new Set<string>()

  const visit = (workId: string) => {
    if (visiting.has(workId)) {
      throw invalid(goalId, `Engineering Work dependency cycle includes ${workId}`)
    }
    if (visited.has(workId)) return

    visiting.add(workId)
    const work = works.get(workId)
    if (work && isEngineeringWork(work.attributes)) {
      for (const dependencyId of work.attributes.dependsOn) visit(dependencyId)
    }
    visiting.delete(workId)
    visited.add(workId)
  }

  for (const [workId, work] of works) {
    if (isEngineeringWork(work.attributes)) visit(workId)
  }
}

function matchLocalDocumentId(path: string, root: string) {
  const prefix = `${root}/`
  if (!path.startsWith(prefix)) return null
  const remainder = path.slice(prefix.length)
  return remainder.endsWith('.md') && !remainder.slice(0, -3).includes('/')
    ? remainder.slice(0, -3)
    : null
}

function matchInputIdentity(path: string, root: string) {
  const prefix = `${root}/`
  if (!path.startsWith(prefix) || !path.endsWith('.md')) return null
  const parts = path.slice(prefix.length, -3).split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { sourceHomeId: parts[0], eventId: parts[1] }
}

function assertPathIdentity(goalId: string, path: string, pathId: string, documentId: string) {
  if (pathId !== documentId) {
    throw invalid(goalId, `${path} owns ID ${documentId}`)
  }
}

function parseWithContext<T>(goalId: string, path: string, parse: () => T) {
  try {
    return parse()
  } catch (error) {
    throw invalid(
      goalId,
      `${path} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function invalid(goalId: string, reason: string) {
  return new GoalPackageValidationError(`Invalid Goal ${goalId}: ${reason}`)
}
