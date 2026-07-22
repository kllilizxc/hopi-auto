import { createAssistantEngineeringWork } from '../domain/assistantEngineeringWork'
import {
  type GoalDocument,
  type InputDocument,
  type WorkDocument,
  parseGoalDocument,
  parseWorkDocument,
  renderGoalDocument,
  renderInputDocument,
  renderWorkDocument,
} from '../domain/canonicalDocuments'
import {
  type GoalPackage,
  readAndValidateGoalPackage,
  validateGoalPackageTransition,
} from '../domain/goalPackage'
import type { InboxEventReference } from '../domain/inboxEventReference'
import type { PublicationCoordinator } from '../publication/publisher'
import { publicationCandidateFromSnapshot } from '../publication/snapshotCandidate'
import type {
  PublicationCandidate,
  PublicationResult,
  PublicationSnapshotFile,
  PublicationWrite,
} from '../publication/types'
import { createGoalPackagePaths } from './goalPackagePaths'
import { migrateLegacyGoals } from './legacyGoalMigration'

export interface CreateCanonicalGoalInput {
  goalId: string
  title: string
  objective: string
  constraints?: string[]
  nonGoals?: string[]
  successCriteria?: string[]
  priority?: number
  acceptedInput?: InputDocument
  supportingWrites?: PublicationWrite[]
  planningReferences?: readonly PlanningReference[]
  firstPlanningWork?: {
    title: string
    objective: string
    acceptanceCriteria: readonly string[]
  }
  initialEngineeringWork?: {
    id: string
    title: string
    objective: string
    acceptanceCriteria: readonly string[]
    assistantDispatch: InboxEventReference
  }
}

export interface PlanningReference {
  path: string
  purpose: string
}

export interface GoalPackageStore {
  paths: ReturnType<typeof createGoalPackagePaths>
  createGoal(input: CreateCanonicalGoalInput): Promise<GoalPackage>
  createGoalFromProposal(
    goalId: string,
    files: readonly { path: string; content: Uint8Array }[],
  ): Promise<GoalPackage>
  listGoalIds(): Promise<string[]>
  readGoal(goalId: string): Promise<GoalDocument | null>
  readPackage(goalId: string): Promise<GoalPackage>
  readReconciliationSnapshot(): Promise<ReadonlyMap<string, GoalPackage>>
  invalidateCache(): Promise<void>
  migrateLegacyGoals(): Promise<readonly { goalId: string; kind: string }[]>
  publishGoal(
    goalId: string,
    publication: {
      supportingWrites: PublicationWrite[]
      gateWrite?: PublicationWrite
      bootstrapAgentsWrite?: PublicationWrite
      projectContextWrites?: PublicationWrite[]
      validateTransition?(
        current: GoalPackage,
        candidate: GoalPackage,
        currentAuthority: PublicationCandidate,
      ): Promise<void> | void
    },
  ): Promise<PublicationResult>
}

export function createGoalPackageStore(
  projectRoot: string,
  projectId: string,
  publisher: PublicationCoordinator,
  projectPath?: string,
): GoalPackageStore {
  const paths = createGoalPackagePaths(projectRoot, projectId, projectPath)
  let cacheGeneration: number | null = null
  let cachedReconciliation: ReadonlyMap<string, GoalPackage> | null = null

  function alignCache(generation: number) {
    if (cacheGeneration === generation) return
    cacheGeneration = generation
    cachedReconciliation = null
  }

  return {
    paths,
    async createGoal(input) {
      const goal = initialGoalDocument(input)
      const goalId = goal.attributes.id
      const acceptedInputPath = input.acceptedInput
        ? paths.inputDocument(
            goalId,
            input.acceptedInput.attributes.sourceHomeId,
            input.acceptedInput.attributes.sourceEventId,
          )
        : null
      if (input.initialEngineeringWork && !acceptedInputPath) {
        throw new Error('Initial Assistant Engineering Work requires accepted Goal Input')
      }
      if (input.firstPlanningWork && input.initialEngineeringWork) {
        throw new Error('Goal creation requires exactly one first Work contract')
      }
      const initialWork = input.initialEngineeringWork
        ? createAssistantEngineeringWork({
            ...input.initialEngineeringWork,
            dependsOn: [],
            contractRevision: 1,
            acceptedInputPath: acceptedInputPath ?? '',
            references: input.planningReferences,
          })
        : createInitialPlanningWork(input, acceptedInputPath)

      await publisher.publish({
        root: paths.publicationRoot,
        supportingWrites: [
          {
            path: paths.goalDocument(goalId),
            expectedHash: null,
            content: renderGoalDocument(goal),
          },
          {
            path: paths.designIndex(goalId),
            expectedHash: null,
            content: initialDesign(input),
          },
          ...(input.acceptedInput && acceptedInputPath
            ? [
                {
                  path: acceptedInputPath,
                  expectedHash: null,
                  content: renderInputDocument(input.acceptedInput),
                },
              ]
            : []),
          ...(input.supportingWrites ?? []),
        ],
        gateWrite: {
          path: paths.workDocument(goalId, initialWork.attributes.id),
          expectedHash: null,
          content: renderWorkDocument(initialWork),
        },
        validateCandidate: (candidate, current) =>
          validateGoalPackageTransition(current, candidate, paths, goalId).then(() => undefined),
      })

      return this.readPackage(goalId)
    },
    async createGoalFromProposal(goalId, files) {
      const goalRoot = `${paths.goalRoot(goalId)}/`
      const allowed = files.filter((file) => file.path.startsWith(goalRoot))
      if (allowed.length !== files.length) {
        throw new Error(`New Goal proposal writes outside ${paths.goalRoot(goalId)}`)
      }
      const unknown = allowed.filter(
        (file) =>
          file.path !== paths.goalDocument(goalId) &&
          !isDesignMarkdownPath(paths.designRoot(goalId), file.path) &&
          !isDirectMarkdownPath(paths.workRoot(goalId), file.path),
      )
      if (unknown.length > 0) {
        throw new Error(
          `New Goal proposal contains unsupported files: ${unknown.map((file) => file.path).join(', ')}`,
        )
      }
      const planningFiles = allowed.filter((file) =>
        isDirectMarkdownPath(paths.workRoot(goalId), file.path),
      )
      if (
        planningFiles.length !== 1 ||
        allowed.some(
          (file) =>
            file.path.startsWith(`${paths.inputsRoot(goalId)}/`) ||
            file.path.startsWith(`${paths.attentionRoot(goalId)}/`) ||
            file.path.startsWith(`${paths.evidenceRoot(goalId)}/`),
        )
      ) {
        throw new Error('New Goal proposal requires exactly one Planning Work and no history')
      }
      const planningFile = planningFiles[0]
      if (!planningFile) throw new Error('New Goal proposal has no Planning Work')
      const planning = parseWorkDocument(new TextDecoder().decode(planningFile.content))
      if (planning.attributes.kind !== 'planning' || planning.attributes.stage !== 'plan') {
        throw new Error('New Goal proposal Work must be Planning at plan')
      }
      if (
        !allowed.some((file) => file.path === paths.goalDocument(goalId)) ||
        !allowed.some((file) => file.path === paths.designIndex(goalId))
      ) {
        throw new Error('New Goal proposal requires goal.md and design/index.md')
      }
      await publisher.publish({
        root: paths.publicationRoot,
        supportingWrites: allowed
          .filter((file) => file.path !== planningFile.path)
          .map((file) => ({ ...file, expectedHash: null })),
        gateWrite: { ...planningFile, expectedHash: null },
        validateCandidate: (candidate, current) =>
          validateGoalPackageTransition(current, candidate, paths, goalId).then(() => undefined),
      })
      return this.readPackage(goalId)
    },
    async listGoalIds() {
      const snapshot = await publisher.snapshotTree(paths.publicationRoot, paths.goalsRoot)
      return goalIdsFromSnapshot(snapshot.files, paths.goalsRoot)
    },
    async readGoal(goalId) {
      const snapshot = await publisher.snapshot(paths.publicationRoot, [paths.goalDocument(goalId)])
      const source = snapshot.files[0]?.content
      return source ? parseGoalDocument(new TextDecoder().decode(source)) : null
    },
    async readPackage(goalId) {
      const snapshot = await publisher.snapshotTree(paths.publicationRoot, paths.goalRoot(goalId))
      return readAndValidateGoalPackage(publicationCandidateFromSnapshot(snapshot), paths, goalId)
    },
    async readReconciliationSnapshot() {
      const generation = await publisher.generation(paths.publicationRoot)
      alignCache(generation)
      if (cachedReconciliation) return cachedReconciliation

      const snapshot = await publisher.snapshotTreeAtGeneration(
        paths.publicationRoot,
        paths.goalsRoot,
      )
      alignCache(snapshot.generation)
      const candidate = publicationCandidateFromSnapshot(snapshot)
      const goalPackages = new Map<string, GoalPackage>()
      for (const goalId of goalIdsFromSnapshot(snapshot.files, paths.goalsRoot)) {
        goalPackages.set(goalId, await readAndValidateGoalPackage(candidate, paths, goalId))
      }
      cachedReconciliation = goalPackages
      return goalPackages
    },
    async invalidateCache() {
      alignCache(await publisher.invalidate(paths.publicationRoot))
    },
    async migrateLegacyGoals() {
      return migrateLegacyGoals(paths, publisher)
    },
    async publishGoal(goalId, publication) {
      const goalRoot = `${paths.goalRoot(goalId)}/`
      for (const write of [
        ...publication.supportingWrites,
        ...(publication.gateWrite ? [publication.gateWrite] : []),
      ]) {
        if (!write.path.startsWith(goalRoot)) {
          throw new Error(
            `Goal publication path is outside ${paths.goalRoot(goalId)}: ${write.path}`,
          )
        }
      }
      if (
        publication.bootstrapAgentsWrite &&
        (publication.bootstrapAgentsWrite.path !== paths.agentsPath ||
          publication.bootstrapAgentsWrite.expectedHash !== null)
      ) {
        throw new Error(
          `Planner bootstrap may only create the missing Project AGENTS.md at ${paths.agentsPath}`,
        )
      }
      for (const write of publication.projectContextWrites ?? []) {
        if (write.path !== '.hopi/docs/repos.md') {
          throw new Error(`Planner Project context write is unsupported: ${write.path}`)
        }
      }
      return publisher.publish({
        root: paths.publicationRoot,
        supportingWrites: [
          ...publication.supportingWrites,
          ...(publication.bootstrapAgentsWrite ? [publication.bootstrapAgentsWrite] : []),
          ...(publication.projectContextWrites ?? []),
        ],
        gateWrite: publication.gateWrite,
        validateCandidate: async (candidate, current) => {
          const nextPackage = await validateGoalPackageTransition(current, candidate, paths, goalId)
          if (publication.validateTransition) {
            const currentPackage = await readAndValidateGoalPackage(current, paths, goalId)
            await publication.validateTransition(currentPackage, nextPackage, current)
          }
        },
      })
    },
  }
}

function goalIdsFromSnapshot(files: readonly PublicationSnapshotFile[], goalsRoot: string) {
  const prefix = `${goalsRoot}/`
  return [
    ...new Set(
      files.flatMap((file) => {
        if (!file.path.startsWith(prefix)) return []
        const goalId = file.path.slice(prefix.length).split('/')[0]
        return goalId ? [goalId] : []
      }),
    ),
  ].sort()
}

function initialGoalDocument(input: CreateCanonicalGoalInput): GoalDocument {
  return {
    attributes: {
      id: input.goalId,
      title: input.title.trim(),
      lifecycle: 'active',
      priority: input.priority ?? 0,
      contractRevision: 1,
      completionAttentionId: null,
    },
    body: [
      '## Objective',
      '',
      input.objective.trim(),
      '',
      ...optionalMarkdownList('Constraints', input.constraints),
      ...optionalMarkdownList('Non-Goals', input.nonGoals),
      ...optionalMarkdownList('Success Criteria', input.successCriteria),
    ].join('\n'),
  }
}

function createInitialPlanningWork(
  input: CreateCanonicalGoalInput,
  acceptedInputPath: string | null,
): WorkDocument {
  const contract = input.firstPlanningWork ?? {
    title: 'Clarify and plan the Goal',
    objective:
      'Clarify the current Goal contract and accepted Inputs, then update design and the sparse Engineering Work DAG.',
    acceptanceCriteria: [
      'Material ambiguity is resolved or raised through targeted Attention.',
      'The design documents and sparse Engineering Work DAG are current.',
    ],
  }
  return {
    attributes: {
      id: 'plan-initial',
      title: contract.title.trim(),
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
      contract.objective.trim(),
      '',
      '## Acceptance Criteria',
      '',
      ...contract.acceptanceCriteria.map((criterion) => `- ${criterion.trim()}`),
      '',
      ...(acceptedInputPath ? ['## Accepted Inputs', '', `- ${acceptedInputPath}`, ''] : []),
      ...(input.planningReferences?.length
        ? [
            '## Reference Images',
            '',
            ...input.planningReferences.map(
              (reference) => `- \`${reference.path}\` - ${reference.purpose.trim()}`,
            ),
            '',
          ]
        : []),
    ].join('\n'),
  }
}

function initialDesign(input: CreateCanonicalGoalInput) {
  return [
    `# ${input.title.trim()} Design`,
    '',
    '## Problem',
    '',
    input.objective.trim(),
    '',
    '## Current Design',
    '',
    'Planner will record established decisions here before exposing Engineering Work.',
    '',
  ].join('\n')
}

function optionalMarkdownList(title: string, values: string[] | undefined) {
  const normalized = values?.map((value) => value.trim()).filter(Boolean) ?? []
  return normalized.length > 0
    ? [`## ${title}`, '', ...normalized.map((value) => `- ${value}`), '']
    : []
}

function isDirectMarkdownPath(root: string, path: string) {
  const prefix = `${root}/`
  const remainder = path.startsWith(prefix) ? path.slice(prefix.length) : ''
  return remainder.endsWith('.md') && !remainder.slice(0, -3).includes('/')
}

function isDesignMarkdownPath(root: string, path: string) {
  return path.startsWith(`${root}/`) && path.endsWith('.md')
}
