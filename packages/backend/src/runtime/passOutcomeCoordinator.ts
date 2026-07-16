import type { PassResultKind, RoleRunResult } from '../agent/RoleRunner'
import { goalAttentionTarget, workAttentionTarget } from '../domain/attentionTarget'
import {
  type AttentionDocument,
  type EvidenceDocument,
  type WorkDocument,
  isEngineeringWork,
  isPlanningWork,
  isWorkTerminal,
  parseAttentionDocument,
  parseWorkDocument,
  renderAttentionDocument,
  renderEvidenceDocument,
  renderWorkDocument,
} from '../domain/canonicalDocuments'
import { type GoalPackage, GoalPackageValidationError } from '../domain/goalPackage'
import { MarkdownDocumentError } from '../domain/markdownDocument'
import { HOPI_RELEASE_REF } from '../domain/project'
import { PublicationError, hashBytes } from '../publication/publisher'
import type { PublicationCoordinator } from '../publication/publisher'
import type { PublicationCandidate, PublicationWrite } from '../publication/types'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import type { Responsibility, RoleContextBundle } from './roleContextStager'

export interface ApplyPassOutcomeInput {
  goalId: string
  workId: string
  runId: string
  responsibility: Responsibility
  context: RoleContextBundle
  outcome: RoleRunResult
}

export type PassOutcomeApplication =
  | { kind: 'published'; evidenceId: string; result: PassResultKind }
  | { kind: 'attention'; evidenceId: string; attentionId: string }
  | { kind: 'integration_required'; evidence: EvidenceDocument; work: WorkDocument }
  | { kind: 'already_applied'; evidenceId: string }
  | { kind: 'stale'; evidenceId: string; reason: string }

export interface PassOutcomeCoordinator {
  apply(input: ApplyPassOutcomeInput): Promise<PassOutcomeApplication>
}

export interface PassOutcomeCoordinatorOptions {
  now?: () => Date
  primaryRepoId?: string
  projectRepoIds?: readonly string[]
}

export class PassProposalError extends Error {}
export class StalePassResultError extends Error {}

export function createPassOutcomeCoordinator(
  store: GoalPackageStore,
  publisher: PublicationCoordinator,
  options: PassOutcomeCoordinatorOptions = {},
): PassOutcomeCoordinator {
  const now = options.now ?? (() => new Date())

  return {
    async apply(initialInput) {
      let input = initialInput
      assertInputRole(input)
      const current = await store.readPackage(input.goalId)
      const evidence = createRunEvidence(store, input, now())
      const alreadyConsumed = findConsumedEvidence(current, evidence.attributes.producerRun)
      if (alreadyConsumed) {
        return { kind: 'already_applied', evidenceId: alreadyConsumed }
      }

      let proposal: PassProposal
      try {
        proposal = await readPassProposal(store, publisher, input)
        proposal = normalizeNewAttentionTimestamps(proposal, evidence.attributes.createdAt)
      } catch (error) {
        const invalidProposal = asPassProposalError(error)
        if (!invalidProposal) throw error
        proposal = emptyProposal()
        input = normalizedProposalFailure(input, invalidProposal)
        evidence.body = renderEvidenceBody(input)
      }

      try {
        try {
          return await applyValidatedProposal(store, input, evidence, proposal, current)
        } catch (error) {
          const invalidProposal = asPassProposalError(error)
          if (!invalidProposal || input.outcome.result === 'fail') throw error
          input = normalizedProposalFailure(input, invalidProposal)
          evidence.body = renderEvidenceBody(input)
          return await applyValidatedProposal(store, input, evidence, emptyProposal(), current)
        }
      } catch (error) {
        if (!(error instanceof StalePassResultError)) throw error
        await preserveUnconsumedEvidence(store, input.goalId, evidence)
        return {
          kind: 'stale',
          evidenceId: evidence.attributes.id,
          reason: error.message,
        }
      }
    },
  }

  async function applyValidatedProposal(
    store: GoalPackageStore,
    input: ApplyPassOutcomeInput,
    evidence: EvidenceDocument,
    proposal: PassProposal,
    current: GoalPackage,
  ): Promise<PassOutcomeApplication> {
    const targetedAttentions = proposal.newAttentions.filter(
      (attention) => attention.document.attributes.target !== null,
    )
    if (targetedAttentions.length > 1) {
      throw new PassProposalError('A pass may propose at most one targeted Attention')
    }
    const targetedAttention = targetedAttentions[0]
    if (targetedAttention) {
      if (input.outcome.result !== 'attention') {
        throw new PassProposalError(
          `Targeted Attention requires attention, received ${input.outcome.result}`,
        )
      }
      const application = buildAttentionApplication(
        store,
        input,
        evidence,
        proposal,
        targetedAttention,
      )
      return publishWithStaleRecovery(store, input, evidence, application, {
        kind: 'attention',
        evidenceId: evidence.attributes.id,
        attentionId: targetedAttention.document.attributes.id,
      })
    }

    if (input.responsibility === 'planner') {
      const application = buildPlannerApplication(
        store,
        input,
        evidence,
        proposal,
        current,
        options,
      )
      return publishWithStaleRecovery(store, input, evidence, application, {
        kind: 'published',
        evidenceId: evidence.attributes.id,
        result: input.outcome.result,
      })
    }

    assertEngineeringProposalIsNarrow(proposal)
    if (input.responsibility === 'reviewer' && input.outcome.result === 'success') {
      await validatePassSemanticGuard(store, input, current)
      const work = requireWork(current, input.workId)
      const next = appendEvidence(work, evidence.attributes.id)
      next.attributes.stage = 'done'
      return { kind: 'integration_required', evidence, work: next }
    }

    const application = buildEngineeringApplication(store, input, evidence, current)
    return publishWithStaleRecovery(store, input, evidence, application, {
      kind: 'published',
      evidenceId: evidence.attributes.id,
      result: input.outcome.result,
    })
  }
}

function asPassProposalError(error: unknown) {
  if (error instanceof PassProposalError) return error
  if (error instanceof MarkdownDocumentError || error instanceof GoalPackageValidationError) {
    return new PassProposalError(error.message)
  }
  return null
}

function normalizedProposalFailure(
  input: ApplyPassOutcomeInput,
  error: PassProposalError,
): ApplyPassOutcomeInput {
  return {
    ...input,
    outcome: {
      result: 'fail',
      summary: `Invalid staged proposal: ${error.message}`,
      artifacts: [],
      exitCode: input.outcome.exitCode,
    },
  }
}

interface NewAttentionProposal {
  path: string
  source: string
  document: AttentionDocument
}

interface PassProposal {
  changedWrites: PublicationWrite[]
  bootstrapAgentsWrite?: PublicationWrite
  projectContextWrites: PublicationWrite[]
  newAttentions: NewAttentionProposal[]
}

interface PassPublication {
  supportingWrites: PublicationWrite[]
  gateWrite: PublicationWrite
  projectContextWrites?: PublicationWrite[]
  validateTransition(
    current: GoalPackage,
    candidate: GoalPackage,
    currentAuthority: PublicationCandidate,
  ): Promise<void> | void
}

function normalizeNewAttentionTimestamps(proposal: PassProposal, createdAt: string): PassProposal {
  if (proposal.newAttentions.length === 0) return proposal

  const sources = new Map<string, string>()
  const newAttentions = proposal.newAttentions.map((attention) => {
    const document: AttentionDocument = {
      attributes: { ...attention.document.attributes, createdAt },
      body: attention.document.body,
    }
    const source = renderAttentionDocument(document)
    sources.set(attention.path, source)
    return { ...attention, document, source }
  })
  const changedWrites = proposal.changedWrites.map((write) => {
    const source = sources.get(write.path)
    return source === undefined ? write : { ...write, content: source }
  })

  return { ...proposal, changedWrites, newAttentions }
}

async function readPassProposal(
  store: GoalPackageStore,
  publisher: PublicationCoordinator,
  input: ApplyPassOutcomeInput,
): Promise<PassProposal> {
  const snapshot = await publisher.snapshotTree(
    { id: `runtime:${input.runId}`, path: input.context.proposalRoot },
    '',
  )
  const baseline = new Map(input.context.authorityFiles.map((file) => [file.path, file.hash]))
  const goalRoot = store.paths.goalRoot(input.goalId)
  const changedWrites: PublicationWrite[] = []
  const newAttentions: NewAttentionProposal[] = []
  const projectContextWrites: PublicationWrite[] = []
  let bootstrapAgentsWrite: PublicationWrite | undefined
  const agentsPath = input.context.agentsPath ?? 'AGENTS.md'

  for (const file of snapshot.files) {
    if (!file.content || !file.hash) continue
    const expectedHash = baseline.get(file.path) ?? null
    if (file.hash === expectedHash) continue
    const source = new TextDecoder().decode(file.content)

    if (
      file.path.startsWith(`${goalRoot}/`) &&
      !file.path.startsWith(`${store.paths.inputsRoot(input.goalId)}/`) &&
      source.includes('.hopi/docs/assistant/attachments/')
    ) {
      throw new PassProposalError(
        `Goal proposal must cite adopted Goal-local assets instead of Assistant-home attachments: ${file.path}`,
      )
    }

    if (file.path === 'AGENTS.md') {
      if (input.responsibility !== 'planner' || baseline.get(agentsPath) !== null) {
        throw new PassProposalError('Only Planner may bootstrap a missing Project AGENTS.md')
      }
      bootstrapAgentsWrite = { path: agentsPath, expectedHash: null, content: file.content }
      continue
    }
    if (file.path === '.hopi/docs/repos.md') {
      if (input.responsibility !== 'planner') {
        throw new PassProposalError('Only Planner may update .hopi/docs/repos.md')
      }
      projectContextWrites.push({
        path: file.path,
        expectedHash,
        content: file.content,
      })
      continue
    }
    if (!file.path.startsWith(`${goalRoot}/`)) {
      throw new PassProposalError(`Proposal writes outside the owning Goal: ${file.path}`)
    }
    if (input.responsibility !== 'planner') {
      if (!isNewAttentionPath(store, input.goalId, file.path, expectedHash)) {
        throw new PassProposalError(
          `${input.responsibility} may only stage a new targeted Attention document`,
        )
      }
    } else {
      assertPlannerProposalPath(store, input.goalId, file.path, expectedHash, source)
    }

    const write = { path: file.path, expectedHash, content: file.content }
    changedWrites.push(write)
    if (isAttentionPath(store, input.goalId, file.path) && expectedHash === null) {
      const document = parseAttentionDocument(source)
      validateNewAttention(store, input, file.path, document)
      newAttentions.push({ path: file.path, source, document })
    }
  }

  return {
    changedWrites,
    bootstrapAgentsWrite,
    projectContextWrites,
    newAttentions,
  }
}

function buildAttentionApplication(
  store: GoalPackageStore,
  input: ApplyPassOutcomeInput,
  evidence: EvidenceDocument,
  proposal: PassProposal,
  attention: NewAttentionProposal,
): PassPublication {
  const supportingWrites = proposal.changedWrites.filter((write) => write.path !== attention.path)
  supportingWrites.push(evidenceWrite(store, input.goalId, evidence))
  return {
    supportingWrites,
    gateWrite: {
      path: attention.path,
      expectedHash: null,
      content: attention.source,
    },
    async validateTransition(current, candidate, currentAuthority) {
      await validatePassSemanticGuard(store, input, current, supportingWrites, {
        currentAuthority,
      })
      assertOnlyAllowedAttentionTransition(
        current,
        candidate,
        input,
        evidence.attributes.id,
        attention,
      )
    },
  }
}

function buildPlannerApplication(
  store: GoalPackageStore,
  input: ApplyPassOutcomeInput,
  evidence: EvidenceDocument,
  proposal: PassProposal,
  current: GoalPackage,
  options: PassOutcomeCoordinatorOptions,
): PassPublication {
  const currentWork = requireWork(current, input.workId)
  if (!isPlanningWork(currentWork.attributes) || currentWork.attributes.stage !== 'plan') {
    throw new PassProposalError('Planner result does not own current Planning Work')
  }

  if (input.outcome.result === 'fail') {
    const failed = appendEvidence(currentWork, evidence.attributes.id)
    failed.attributes.attempts += 1
    return {
      supportingWrites: [evidenceWrite(store, input.goalId, evidence)],
      gateWrite: workWrite(store, input.goalId, failed, input.context.workHash),
      async validateTransition(before, candidate, currentAuthority) {
        await validatePassSemanticGuard(
          store,
          input,
          before,
          [evidenceWrite(store, input.goalId, evidence)],
          { currentAuthority },
        )
        assertOnlyOwningWorkAndEvidenceChanged(
          before,
          candidate,
          input.workId,
          evidence.attributes.id,
        )
      },
    }
  }

  const completedWork = appendEvidence(currentWork, evidence.attributes.id)
  completedWork.attributes.stage = 'done'
  const supportingWrites = [...proposal.changedWrites]
  supportingWrites.push(evidenceWrite(store, input.goalId, evidence))

  return {
    supportingWrites,
    projectContextWrites: proposal.projectContextWrites,
    gateWrite: workWrite(store, input.goalId, completedWork, input.context.workHash),
    async validateTransition(before, candidate, currentAuthority) {
      await validatePassSemanticGuard(
        store,
        input,
        before,
        [...supportingWrites, ...proposal.projectContextWrites],
        {
          currentAuthority,
        },
      )
      validatePlannerTransition(before, candidate, input, evidence.attributes.id)
      validatePlannerRepoScopes(before, candidate, options)
    },
  }
}

function validatePlannerRepoScopes(
  before: GoalPackage,
  candidate: GoalPackage,
  options: PassOutcomeCoordinatorOptions,
) {
  if (!options.projectRepoIds) return
  const allowed = new Set(options.projectRepoIds)
  const primaryRepoId = options.primaryRepoId ?? 'primary'
  for (const [workId, work] of candidate.works) {
    if (!isEngineeringWork(work.attributes)) continue
    if (!before.works.has(workId) && !work.attributes.repos) {
      throw new PassProposalError(`New Engineering Work ${workId} must declare repos`)
    }
    for (const repoId of work.attributes.repos ?? [primaryRepoId]) {
      if (!allowed.has(repoId)) {
        throw new PassProposalError(`Engineering Work ${workId} references unlinked Repo ${repoId}`)
      }
    }
  }
}

function buildEngineeringApplication(
  store: GoalPackageStore,
  input: ApplyPassOutcomeInput,
  evidence: EvidenceDocument,
  current: GoalPackage,
): PassPublication {
  const currentWork = requireWork(current, input.workId)
  if (!isEngineeringWork(currentWork.attributes)) {
    throw new PassProposalError('Engineering pass requires Engineering Work')
  }
  const next = appendEvidence(currentWork, evidence.attributes.id)
  const evidenceSupport = evidenceWrite(store, input.goalId, evidence)

  if (input.responsibility === 'generator' && input.outcome.result === 'success') {
    next.attributes.stage = 'review'
  } else if (input.responsibility === 'reviewer' && input.outcome.result === 'reject') {
    next.attributes.stage = 'generate'
    next.attributes.attempts += 1
  } else if (input.outcome.result === 'fail') {
    next.attributes.attempts += 1
  } else {
    throw new PassProposalError(
      `Unsupported ${input.responsibility} outcome: ${input.outcome.result}`,
    )
  }

  return {
    supportingWrites: [evidenceSupport],
    gateWrite: workWrite(store, input.goalId, next, input.context.workHash),
    async validateTransition(before, candidate, currentAuthority) {
      await validatePassSemanticGuard(store, input, before, [evidenceSupport], {
        currentAuthority,
      })
      assertOnlyOwningWorkAndEvidenceChanged(
        before,
        candidate,
        input.workId,
        evidence.attributes.id,
      )
    },
  }
}

async function publishWithStaleRecovery<T extends PassOutcomeApplication>(
  store: GoalPackageStore,
  input: ApplyPassOutcomeInput,
  evidence: EvidenceDocument,
  publication: PassPublication,
  success: T,
): Promise<T | Extract<PassOutcomeApplication, { kind: 'stale' }>> {
  try {
    await store.publishGoal(input.goalId, {
      ...publication,
      bootstrapAgentsWrite:
        input.responsibility === 'planner' ? await plannerBootstrapWrite(input) : undefined,
      projectContextWrites: publication.projectContextWrites,
    })
    return success
  } catch (error) {
    if (
      !(error instanceof StalePassResultError) &&
      !(error instanceof PublicationError && error.code === 'conflict')
    ) {
      throw error
    }
    await preserveUnconsumedEvidence(store, input.goalId, evidence)
    return {
      kind: 'stale',
      evidenceId: evidence.attributes.id,
      reason: error.message,
    }
  }
}

async function plannerBootstrapWrite(input: ApplyPassOutcomeInput) {
  const path = `${input.context.proposalRoot}/AGENTS.md`
  const file = Bun.file(path)
  if (!(await file.exists())) return undefined
  const agentsPath = input.context.agentsPath ?? 'AGENTS.md'
  if (input.context.guardFiles[agentsPath] !== null) {
    throw new PassProposalError(
      'Existing Project AGENTS.md cannot be replaced by Planner bootstrap',
    )
  }
  return {
    path: agentsPath,
    expectedHash: null,
    content: new Uint8Array(await file.arrayBuffer()),
  }
}

async function preserveUnconsumedEvidence(
  store: GoalPackageStore,
  goalId: string,
  evidence: EvidenceDocument,
) {
  await store.publishGoal(goalId, {
    supportingWrites: [evidenceWrite(store, goalId, evidence)],
  })
}

export async function validatePassSemanticGuard(
  store: GoalPackageStore,
  input: ApplyPassOutcomeInput,
  current: GoalPackage,
  allowedSupportingWrites: readonly PublicationWrite[] = [],
  options: {
    allowReleaseHeadChange?: boolean
    currentAuthority?: PublicationCandidate
  } = {},
) {
  const bootstrapWrite =
    input.responsibility === 'planner' ? await plannerBootstrapWrite(input) : undefined
  const allowedWrites = bootstrapWrite
    ? [...allowedSupportingWrites, bootstrapWrite]
    : allowedSupportingWrites
  const goal = current.goal.attributes
  const work = current.works.get(input.workId)?.attributes
  const expectedStage =
    input.responsibility === 'planner'
      ? 'plan'
      : input.responsibility === 'generator'
        ? 'generate'
        : 'review'
  if (goal.lifecycle !== 'active') stale(`Goal is ${goal.lifecycle}`)
  if (!work || isWorkTerminal(work) || work.stage !== expectedStage) {
    stale(`Work is no longer at ${expectedStage}`)
  }
  if (work.contractRevision !== goal.contractRevision) stale('Work contract revision is stale')
  if (input.responsibility !== 'planner') {
    if (!isEngineeringWork(work)) stale('Engineering responsibility no longer owns the Work')
    for (const dependencyId of work.dependsOn) {
      if (current.works.get(dependencyId)?.attributes.stage !== 'done') {
        stale(`Dependency ${dependencyId} is no longer done`)
      }
    }
  }
  const goalTarget = goalAttentionTarget(store.paths.projectId, input.goalId)
  const workTarget = workAttentionTarget(store.paths.projectId, input.goalId, input.workId)
  if (
    [...current.attentions.values()].some(
      (attention) =>
        attention.attributes.resolvedAt === null &&
        (attention.attributes.target === goalTarget || attention.attributes.target === workTarget),
    )
  ) {
    stale('Targeted Attention now blocks the result')
  }
  await validateGuardSnapshot(
    store,
    input.context.guardFiles,
    input.context.guardPrefixes,
    allowedWrites,
    options.currentAuthority,
  )
  const releaseHead = gitOutputSync(store.paths.projectRoot, ['rev-parse', HOPI_RELEASE_REF])
  const allowReleaseHeadChange =
    options.allowReleaseHeadChange ?? input.responsibility !== 'planner'
  if (!allowReleaseHeadChange && releaseHead !== input.context.releaseHead) {
    stale('Integration target changed since staging')
  }
}

async function validateGuardSnapshot(
  store: GoalPackageStore,
  expected: Readonly<Record<string, string | null>>,
  protectedPrefixes: readonly string[],
  allowedSupportingWrites: readonly PublicationWrite[],
  currentAuthority?: PublicationCandidate,
) {
  const allowed = new Map<string, string>()
  for (const write of allowedSupportingWrites) {
    const content =
      typeof write.content === 'string' ? new TextEncoder().encode(write.content) : write.content
    allowed.set(write.path, await hashBytes(content))
  }
  for (const [path, expectedHash] of Object.entries(expected)) {
    const bytes = currentAuthority
      ? await currentAuthority.readBytes(path)
      : await readCanonicalBytes(store, path)
    const actualHash = bytes ? await hashBytes(bytes) : null
    if (actualHash !== expectedHash && actualHash !== allowed.get(path)) {
      stale(`Canonical context changed: ${path}`)
    }
  }

  if (!currentAuthority) return
  for (const prefix of protectedPrefixes) {
    for (const path of await currentAuthority.listFiles(prefix)) {
      if (Object.hasOwn(expected, path)) continue
      const allowedHash = allowed.get(path)
      const bytes = await currentAuthority.readBytes(path)
      const actualHash = bytes ? await hashBytes(bytes) : null
      if (!allowedHash || actualHash !== allowedHash) {
        stale(`Canonical context added selected file: ${path}`)
      }
    }
  }
}

async function readCanonicalBytes(store: GoalPackageStore, path: string) {
  const file = Bun.file(store.paths.absolute(path))
  return (await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : null
}

function validatePlannerTransition(
  before: GoalPackage,
  after: GoalPackage,
  input: ApplyPassOutcomeInput,
  evidenceId: string,
) {
  assertGoalUnchanged(before, after)
  assertHistoricalAttentionUnchanged(before, after)
  assertOnlyGeneratedEvidenceAdded(before, after, evidenceId)
  const planning = requireWork(after, input.workId)
  if (!isPlanningWork(planning.attributes) || planning.attributes.stage !== 'done') {
    throw new PassProposalError('Planner gate must finish its Planning Work')
  }
  if (!planning.attributes.evidenceRefs.includes(evidenceId)) {
    throw new PassProposalError('Planner gate must consume its Run Evidence')
  }
  for (const [workId, work] of after.works) {
    const previous = before.works.get(workId)
    if (!previous) {
      if (!isEngineeringWork(work.attributes) || work.attributes.stage !== 'generate') {
        throw new PassProposalError('Planner may create only Engineering Work at generate')
      }
      continue
    }
    if (workId === input.workId || isWorkTerminal(previous.attributes)) continue
    if (
      previous.attributes.stage !== work.attributes.stage &&
      work.attributes.stage !== 'generate'
    ) {
      throw new PassProposalError('Planner may only reset existing Engineering Work to generate')
    }
    if (
      work.attributes.attempts !== previous.attributes.attempts &&
      work.attributes.attempts !== 0
    ) {
      throw new PassProposalError('Planner may only preserve or reset Work attempts')
    }
  }

  const newTargetless = [...after.attentions.entries()].filter(
    ([attentionId, attention]) =>
      !before.attentions.has(attentionId) && attention.attributes.target === null,
  )
  const hasNonterminalEngineering = [...after.works.values()].some(
    (work) => isEngineeringWork(work.attributes) && !isWorkTerminal(work.attributes),
  )
  if (newTargetless.length > 0) {
    if (hasNonterminalEngineering) {
      throw new PassProposalError('Completion proposal requires no nonterminal Engineering Work')
    }
  }
  const hasOpenCompletion = [...after.attentions.values()].some(
    (attention) => attention.attributes.target === null && attention.attributes.resolvedAt === null,
  )
  if (!hasNonterminalEngineering && !hasOpenCompletion) {
    throw new PassProposalError(
      'Planner success without nonterminal Engineering Work requires completion Attention',
    )
  }
}

function assertOnlyAllowedAttentionTransition(
  before: GoalPackage,
  after: GoalPackage,
  input: ApplyPassOutcomeInput,
  evidenceId: string,
  attention: NewAttentionProposal,
) {
  assertGoalUnchanged(before, after)
  assertHistoricalAttentionUnchanged(before, after)
  assertOnlyGeneratedEvidenceAdded(before, after, evidenceId)
  const addedAttention = after.attentions.get(attention.document.attributes.id)
  if (!addedAttention || addedAttention.attributes.target === null) {
    throw new PassProposalError('Attention gate must install the staged targeted Attention')
  }
  const currentWork = requireWork(before, input.workId)
  const nextWork = requireWork(after, input.workId)
  if (currentWork.attributes.stage !== nextWork.attributes.stage) {
    throw new PassProposalError('Attention-producing result may not advance Work')
  }
  if (input.responsibility !== 'planner') {
    assertDocumentsEqualExcept(before, after, {
      workIds: [],
      attentionIds: [attention.document.attributes.id],
      evidenceIds: [evidenceId],
    })
  }
}

function assertOnlyOwningWorkAndEvidenceChanged(
  before: GoalPackage,
  after: GoalPackage,
  workId: string,
  evidenceId: string,
) {
  assertDocumentsEqualExcept(before, after, {
    workIds: [workId],
    attentionIds: [],
    evidenceIds: [evidenceId],
  })
  const work = requireWork(after, workId)
  if (!work.attributes.evidenceRefs.includes(evidenceId)) {
    throw new PassProposalError('Work gate must consume the Run Evidence')
  }
}

function assertDocumentsEqualExcept(
  before: GoalPackage,
  after: GoalPackage,
  allowed: { workIds: string[]; attentionIds: string[]; evidenceIds: string[] },
) {
  assertGoalUnchanged(before, after)
  assertMapEqualExcept(before.works, after.works, new Set(allowed.workIds), 'Work')
  assertMapEqualExcept(
    before.attentions,
    after.attentions,
    new Set(allowed.attentionIds),
    'Attention',
  )
  assertMapEqualExcept(before.evidence, after.evidence, new Set(allowed.evidenceIds), 'Evidence')
  if (JSON.stringify(before.inputs) !== JSON.stringify(after.inputs)) {
    throw new PassProposalError('Pass may not change Goal Inputs')
  }
}

function assertMapEqualExcept<T>(
  before: ReadonlyMap<string, T>,
  after: ReadonlyMap<string, T>,
  allowed: ReadonlySet<string>,
  label: string,
) {
  const keys = new Set([...before.keys(), ...after.keys()])
  for (const key of keys) {
    if (allowed.has(key)) continue
    if (JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))) {
      throw new PassProposalError(`${label} ${key} changed outside pass authorization`)
    }
  }
}

function assertGoalUnchanged(before: GoalPackage, after: GoalPackage) {
  if (JSON.stringify(before.goal) !== JSON.stringify(after.goal)) {
    throw new PassProposalError('Responsibility pass may not change Goal control or contract')
  }
}

function assertHistoricalAttentionUnchanged(before: GoalPackage, after: GoalPackage) {
  for (const [attentionId, attention] of before.attentions) {
    if (JSON.stringify(attention) !== JSON.stringify(after.attentions.get(attentionId))) {
      throw new PassProposalError(`Planner may not rewrite Attention ${attentionId}`)
    }
  }
}

function assertOnlyGeneratedEvidenceAdded(
  before: GoalPackage,
  after: GoalPackage,
  evidenceId: string,
) {
  assertMapEqualExcept(before.evidence, after.evidence, new Set([evidenceId]), 'Evidence')
}

function assertEngineeringProposalIsNarrow(proposal: PassProposal) {
  if (proposal.changedWrites.some((write) => !write.path.includes('/attention/'))) {
    throw new PassProposalError('Engineering proposal contains a non-Attention canonical write')
  }
}

function assertPlannerProposalPath(
  store: GoalPackageStore,
  goalId: string,
  path: string,
  expectedHash: string | null,
  source: string,
) {
  if (path === store.paths.goalDocument(goalId)) {
    throw new PassProposalError('Planner pass may not directly change the Goal contract')
  }
  if (path.startsWith(`${store.paths.designRoot(goalId)}/`) && path.endsWith('.md')) return
  if (isWorkPath(store, goalId, path)) {
    if (isPlanningWork(parseWorkDocument(source).attributes)) {
      throw new PassProposalError(
        'Planner may propose Engineering Work but may not write Planning Work',
      )
    }
    return
  }
  if (isAttentionPath(store, goalId, path) && expectedHash === null) return
  throw new PassProposalError(`Planner proposal path is not authorized: ${path}`)
}

function isNewAttentionPath(
  store: GoalPackageStore,
  goalId: string,
  path: string,
  expectedHash: string | null,
) {
  return expectedHash === null && isAttentionPath(store, goalId, path)
}

function isAttentionPath(store: GoalPackageStore, goalId: string, path: string) {
  const prefix = `${store.paths.attentionRoot(goalId)}/`
  const remainder = path.startsWith(prefix) ? path.slice(prefix.length) : ''
  return remainder.endsWith('.md') && !remainder.slice(0, -3).includes('/')
}

function isWorkPath(store: GoalPackageStore, goalId: string, path: string) {
  const prefix = `${store.paths.workRoot(goalId)}/`
  const remainder = path.startsWith(prefix) ? path.slice(prefix.length) : ''
  return remainder.endsWith('.md') && !remainder.slice(0, -3).includes('/')
}

function validateNewAttention(
  store: GoalPackageStore,
  input: ApplyPassOutcomeInput,
  path: string,
  document: AttentionDocument,
) {
  if (path !== store.paths.attentionDocument(input.goalId, document.attributes.id)) {
    throw new PassProposalError(`Attention identity does not match proposal path: ${path}`)
  }
  if (document.attributes.resolvedAt !== null || document.attributes.notifiedAt !== null) {
    throw new PassProposalError('New Attention must be open and unnotified')
  }
  if (document.attributes.target !== null) {
    const expectedTarget = workRef(store, input.goalId, input.workId)
    if (document.attributes.target !== expectedTarget) {
      throw new PassProposalError(
        `Targeted Attention must use owning Work target: ${expectedTarget}`,
      )
    }
  }
}

function createRunEvidence(
  store: GoalPackageStore,
  input: ApplyPassOutcomeInput,
  createdAt: Date,
): EvidenceDocument {
  return {
    attributes: {
      id: `E-${input.runId}`,
      createdAt: createdAt.toISOString(),
      producerRun: producerRunRef(store, input),
      coordinatorCheck: null,
      owner: workRef(store, input.goalId, input.workId),
      artifacts: [...input.outcome.artifacts],
    },
    body: renderEvidenceBody(input),
  }
}

function renderEvidenceBody(input: ApplyPassOutcomeInput) {
  return [
    '## Responsibility Result',
    '',
    `- Responsibility: ${input.responsibility}`,
    `- Result: ${input.outcome.result}`,
    `- Integration target snapshot: ${input.context.releaseHead}`,
    '',
    '## Summary',
    '',
    input.outcome.summary.trim(),
    '',
  ].join('\n')
}

function evidenceWrite(store: GoalPackageStore, goalId: string, evidence: EvidenceDocument) {
  return {
    path: store.paths.evidenceDocument(goalId, evidence.attributes.id),
    expectedHash: null,
    content: renderEvidenceDocument(evidence),
  }
}

function workWrite(
  store: GoalPackageStore,
  goalId: string,
  work: WorkDocument,
  expectedHash: string | null,
) {
  return {
    path: store.paths.workDocument(goalId, work.attributes.id),
    expectedHash,
    content: renderWorkDocument(work),
  }
}

function appendEvidence(work: WorkDocument, evidenceId: string): WorkDocument {
  return {
    attributes: {
      ...work.attributes,
      dependsOn: [...work.attributes.dependsOn],
      evidenceRefs: appendUnique(work.attributes.evidenceRefs, evidenceId),
    },
    body: work.body,
  }
}

function requireWork(goalPackage: GoalPackage, workId: string) {
  const work = goalPackage.works.get(workId)
  if (!work) throw new StalePassResultError(`Work no longer exists: ${workId}`)
  return work
}

function findConsumedEvidence(goalPackage: GoalPackage, producerRun: string | null) {
  if (!producerRun) return null
  for (const [workId, work] of goalPackage.works) {
    for (const evidenceId of work.attributes.evidenceRefs) {
      if (goalPackage.evidence.get(evidenceId)?.attributes.producerRun === producerRun) {
        return evidenceId
      }
    }
    if (!goalPackage.works.has(workId)) return null
  }
  return null
}

function producerRunRef(store: GoalPackageStore, input: ApplyPassOutcomeInput) {
  return `${workRef(store, input.goalId, input.workId)}/run:${input.runId}`
}

function workRef(store: GoalPackageStore, goalId: string, workId: string) {
  return workAttentionTarget(store.paths.projectId, goalId, workId)
}

function appendUnique(values: readonly string[], value: string) {
  return values.includes(value) ? [...values] : [...values, value]
}

function assertInputRole(input: ApplyPassOutcomeInput) {
  const allowed =
    input.responsibility === 'planner'
      ? new Set<PassResultKind>(['success', 'attention', 'fail'])
      : input.responsibility === 'generator'
        ? new Set<PassResultKind>(['success', 'attention', 'fail'])
        : new Set<PassResultKind>(['success', 'reject', 'attention', 'fail'])
  if (!allowed.has(input.outcome.result)) {
    throw new PassProposalError(`${input.responsibility} cannot return ${input.outcome.result}`)
  }
}

function emptyProposal(): PassProposal {
  return {
    changedWrites: [],
    projectContextWrites: [],
    newAttentions: [],
  }
}

function stale(message: string): never {
  throw new StalePassResultError(message)
}

function gitOutputSync(cwd: string, args: string[]) {
  const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) {
    stale(`Cannot validate integration target: ${result.stderr.toString().trim()}`)
  }
  return result.stdout.toString().trim()
}
