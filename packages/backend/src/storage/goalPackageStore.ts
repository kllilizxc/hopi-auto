import {
  type DecisionWorkAttributes,
  type GoalDocument,
  type InputDocument,
  type WorkContextRef,
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
import type { PublicationCoordinator } from '../publication/publisher'
import { publicationCandidateFromSnapshot } from '../publication/snapshotCandidate'
import type {
  PublicationCandidate,
  PublicationResult,
  PublicationSnapshotFile,
  PublicationWrite,
} from '../publication/types'
import { createGoalPackagePaths } from './goalPackagePaths'

export interface CanonicalReference extends WorkContextRef {}

interface InitialWorkBase {
  id: string
  title: string
  dependsOn?: readonly string[]
}

export type InitialWorkInput =
  | (InitialWorkBase & {
      kind: 'decision'
      decisionType: DecisionWorkAttributes['decisionType']
      taskMode?: DecisionWorkAttributes['taskMode']
      question: string
    })
  | (InitialWorkBase & {
      kind: 'engineering'
      objective: string
      acceptanceCriteria: readonly string[]
    })

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
  references?: readonly CanonicalReference[]
  mapMarkdown?: string
  firstWork: InitialWorkInput
  createdAt?: string
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
  let reconciliationRead: {
    generation: number
    promise: Promise<ReadonlyMap<string, GoalPackage>>
  } | null = null

  function alignCache(generation: number) {
    if (cacheGeneration === generation) return
    cacheGeneration = generation
    cachedReconciliation = null
    if (reconciliationRead?.generation !== generation) reconciliationRead = null
  }

  return {
    paths,
    async createGoal(input) {
      if (input.firstWork.kind === 'decision' && !input.mapMarkdown?.trim()) {
        throw new Error('A Goal starting with Decision Work requires mapMarkdown')
      }
      if (input.firstWork.kind === 'engineering' && input.mapMarkdown !== undefined) {
        throw new Error('A clear Goal starting with Engineering Work does not create a Map')
      }
      const goal = initialGoalDocument(input)
      const goalId = goal.attributes.id
      const acceptedInputPath = input.acceptedInput
        ? paths.inputDocument(
            goalId,
            input.acceptedInput.attributes.sourceHomeId,
            input.acceptedInput.attributes.sourceEventId,
          )
        : null
      const initialWork = createInitialWork(
        input,
        acceptedInputPath,
        input.createdAt ?? new Date().toISOString(),
      )
      await publisher.publish({
        root: paths.publicationRoot,
        supportingWrites: [
          {
            path: paths.goalDocument(goalId),
            expectedHash: null,
            content: renderGoalDocument(goal),
          },
          ...(input.mapMarkdown
            ? [
                {
                  path: paths.designIndex(goalId),
                  expectedHash: null,
                  content: normalizeMarkdown(input.mapMarkdown),
                },
              ]
            : []),
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
      const workFiles = allowed.filter((file) =>
        isDirectMarkdownPath(paths.workRoot(goalId), file.path),
      )
      if (workFiles.length !== 1) {
        throw new Error('New Goal proposal requires exactly one first Work')
      }
      const workFile = workFiles[0]
      if (!workFile) throw new Error('New Goal proposal has no Work')
      const work = parseWorkDocument(new TextDecoder().decode(workFile.content))
      if (work.attributes.status !== 'open') {
        throw new Error('New Goal proposal Work must be open')
      }
      if (!allowed.some((file) => file.path === paths.goalDocument(goalId))) {
        throw new Error('New Goal proposal requires goal.md')
      }
      if (
        work.attributes.kind === 'decision' &&
        !allowed.some((file) => file.path === paths.designIndex(goalId))
      ) {
        throw new Error('New Goal proposal with Decision Work requires design/index.md')
      }
      await publisher.publish({
        root: paths.publicationRoot,
        supportingWrites: allowed
          .filter((file) => file.path !== workFile.path)
          .map((file) => ({ ...file, expectedHash: null })),
        gateWrite: { ...workFile, expectedHash: null },
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
      if (reconciliationRead?.generation === generation) return reconciliationRead.promise
      const promise = (async () => {
        const snapshot = await publisher.snapshotTreeAtGeneration(
          paths.publicationRoot,
          paths.goalsRoot,
        )
        const candidate = publicationCandidateFromSnapshot(snapshot)
        const goalPackages = new Map<string, GoalPackage>()
        for (const goalId of goalIdsFromSnapshot(snapshot.files, paths.goalsRoot)) {
          goalPackages.set(goalId, await readAndValidateGoalPackage(candidate, paths, goalId))
        }
        if (cacheGeneration === generation || cacheGeneration === snapshot.generation) {
          alignCache(snapshot.generation)
          cachedReconciliation = goalPackages
        }
        return goalPackages
      })()
      reconciliationRead = { generation, promise }
      try {
        return await promise
      } finally {
        if (reconciliationRead?.promise === promise) reconciliationRead = null
      }
    },
    async invalidateCache() {
      alignCache(await publisher.invalidate(paths.publicationRoot))
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
          `Bootstrap may only create the missing Project AGENTS.md at ${paths.agentsPath}`,
        )
      }
      for (const write of publication.projectContextWrites ?? []) {
        if (write.path !== '.hopi/docs/repos.md') {
          throw new Error(`Project context write is unsupported: ${write.path}`)
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

function createInitialWork(
  input: CreateCanonicalGoalInput,
  acceptedInputPath: string | null,
  createdAt: string,
): WorkDocument {
  const contextRefs = mergeContextRefs([
    ...(acceptedInputPath ? [{ path: acceptedInputPath, purpose: 'Accepted Inbox input' }] : []),
    ...(input.references ?? []),
  ])
  const common = {
    id: input.firstWork.id,
    title: input.firstWork.title.trim(),
    status: 'open' as const,
    createdAt,
    notBefore: null,
    dependsOn: [...(input.firstWork.dependsOn ?? [])],
    contractRevision: 1,
    evidenceRefs: [],
    contextRefs,
    ownerMessages: [],
  }
  if (input.firstWork.kind === 'decision') {
    return {
      attributes: {
        ...common,
        kind: 'decision',
        decisionType: input.firstWork.decisionType,
        ...(input.firstWork.taskMode ? { taskMode: input.firstWork.taskMode } : {}),
      },
      body: `## Question\n\n${input.firstWork.question.trim()}\n`,
    }
  }
  return {
    attributes: {
      ...common,
      kind: 'engineering',
    },
    body: [
      '## Objective',
      '',
      input.firstWork.objective.trim(),
      '',
      '## Acceptance Criteria',
      '',
      ...input.firstWork.acceptanceCriteria.map((criterion) => `- ${criterion.trim()}`),
      '',
    ].join('\n'),
  }
}

function mergeContextRefs(references: readonly WorkContextRef[]) {
  return [...new Map(references.map((reference) => [reference.path, reference])).values()]
}

function optionalMarkdownList(title: string, values: string[] | undefined) {
  const normalized = values?.map((value) => value.trim()).filter(Boolean) ?? []
  return normalized.length > 0
    ? [`## ${title}`, '', ...normalized.map((value) => `- ${value}`), '']
    : []
}

function normalizeMarkdown(value: string) {
  return `${value.trimEnd()}\n`
}

function isDirectMarkdownPath(root: string, path: string) {
  const prefix = `${root}/`
  const remainder = path.startsWith(prefix) ? path.slice(prefix.length) : ''
  return remainder.endsWith('.md') && !remainder.slice(0, -3).includes('/')
}

function isDesignMarkdownPath(root: string, path: string) {
  return path.startsWith(`${root}/`) && path.endsWith('.md')
}
