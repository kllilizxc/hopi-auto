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
import type { PublicationCoordinator } from '../publication/publisher'
import { publicationCandidateFromSnapshot } from '../publication/snapshotCandidate'
import type {
  PublicationCandidate,
  PublicationResult,
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
  migrateLegacyGoals(): Promise<readonly { goalId: string; kind: string }[]>
  publishGoal(
    goalId: string,
    publication: {
      supportingWrites: PublicationWrite[]
      gateWrite?: PublicationWrite
      bootstrapAgentsWrite?: PublicationWrite
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
): GoalPackageStore {
  const paths = createGoalPackagePaths(projectRoot, projectId)

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
      const planning = initialPlanningWork(input, acceptedInputPath)

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
          path: paths.workDocument(goalId, planning.attributes.id),
          expectedHash: null,
          content: renderWorkDocument(planning),
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
      const prefix = `${paths.goalsRoot}/`
      return [
        ...new Set(
          snapshot.files.flatMap((file) => {
            if (!file.path.startsWith(prefix)) return []
            const goalId = file.path.slice(prefix.length).split('/')[0]
            return goalId ? [goalId] : []
          }),
        ),
      ].sort()
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
        (publication.bootstrapAgentsWrite.path !== 'AGENTS.md' ||
          publication.bootstrapAgentsWrite.expectedHash !== null)
      ) {
        throw new Error('Planner bootstrap may only create a previously missing root AGENTS.md')
      }
      return publisher.publish({
        root: paths.publicationRoot,
        supportingWrites: [
          ...publication.supportingWrites,
          ...(publication.bootstrapAgentsWrite ? [publication.bootstrapAgentsWrite] : []),
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
      '## Constraints',
      '',
      markdownList(input.constraints, 'None recorded.'),
      '',
      '## Non-Goals',
      '',
      markdownList(input.nonGoals, 'None recorded.'),
      '',
      '## Success Criteria',
      '',
      markdownList(
        input.successCriteria,
        'The desired outcome is delivered against measurable criteria recorded in design and Engineering Work.',
      ),
      '',
    ].join('\n'),
  }
}

function initialPlanningWork(
  input: CreateCanonicalGoalInput,
  acceptedInputPath: string | null,
): WorkDocument {
  return {
    attributes: {
      id: 'plan-initial',
      title: 'Clarify and plan the Goal',
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
      `Clarify and plan: ${input.objective.trim()}`,
      '',
      '## Acceptance Criteria',
      '',
      '- Material ambiguity is resolved or raised through targeted Attention.',
      '- The design documents and sparse Engineering Work DAG are current.',
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

function markdownList(values: string[] | undefined, fallback: string) {
  const normalized = values?.map((value) => value.trim()).filter(Boolean) ?? []
  return normalized.length > 0
    ? normalized.map((value) => `- ${value}`).join('\n')
    : `- ${fallback}`
}

function isDirectMarkdownPath(root: string, path: string) {
  const prefix = `${root}/`
  const remainder = path.startsWith(prefix) ? path.slice(prefix.length) : ''
  return remainder.endsWith('.md') && !remainder.slice(0, -3).includes('/')
}

function isDesignMarkdownPath(root: string, path: string) {
  return path.startsWith(`${root}/`) && path.endsWith('.md')
}
