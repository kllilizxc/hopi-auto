import { EXECUTION_ENVELOPE_MARKER, type ExecutionEnvelope } from '../agent/executionEnvelope'
import type { InboxEventDocument } from '../domain/assistantWorkspaceDocuments'
import type { AssistantStateReader, AssistantStateSnapshot } from './assistantState'

interface ScopedStateObservation {
  status: 'observed' | 'unavailable'
  scope: { projectId: string; goalId?: string }
  observedAt: string | null
  stateDigest: string | null
  project?: unknown
  goal?: unknown
  activeRuns?: unknown[]
  reason?: string
}

export async function observeAssistantTurn(
  state: AssistantStateReader | undefined,
  event: InboxEventDocument,
) {
  return {
    scopedState: await readScopedStateObservation(state, event),
  }
}

export function renderAssistantTurnObservation(
  observation: Awaited<ReturnType<typeof observeAssistantTurn>>,
  environment?: ExecutionEnvelope,
) {
  return [
    '[Current execution environment observation]',
    environment ? JSON.stringify(environment, null, 2) : EXECUTION_ENVELOPE_MARKER,
    ...(observation.scopedState
      ? [
          '[Current scoped HOPI state observation]',
          JSON.stringify(observation.scopedState, null, 2),
        ]
      : []),
  ].join('\n')
}

async function readScopedStateObservation(
  state: AssistantStateReader | undefined,
  event: InboxEventDocument,
): Promise<ScopedStateObservation | null> {
  const context = event.attributes.context
  if (!state || !context?.projectId) return null
  const scope = {
    projectId: context.projectId,
    ...(context.goalId ? { goalId: context.goalId } : {}),
  }
  try {
    const snapshot = await state.read({
      ...scope,
      includeEvidence: Boolean(context.goalId),
    })
    return compactScopedState(snapshot, scope)
  } catch (error) {
    return {
      status: 'unavailable',
      scope,
      observedAt: null,
      stateDigest: null,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function compactScopedState(
  snapshot: AssistantStateSnapshot,
  scope: { projectId: string; goalId?: string },
): ScopedStateObservation {
  const project = snapshot.projects
    .map(asRecord)
    .find((candidate) => candidate?.projectId === scope.projectId)
  if (!project) {
    return {
      status: 'unavailable',
      scope,
      observedAt: snapshot.observedAt,
      stateDigest: snapshot.stateDigest,
      reason: `Project not present in scoped state: ${scope.projectId}`,
    }
  }

  const goals = asRecords(project.goals)
  const goal = scope.goalId
    ? goals.find((candidate) => goalId(candidate) === scope.goalId)
    : undefined

  return {
    status: scope.goalId && !goal ? 'unavailable' : 'observed',
    scope,
    observedAt: snapshot.observedAt,
    stateDigest: snapshot.stateDigest,
    project: compactProject(project),
    ...(goal ? { goal: compactGoal(goal) } : {}),
    activeRuns: snapshot.activeRuns.filter(
      (run) => run.projectId === scope.projectId && (!scope.goalId || run.goalId === scope.goalId),
    ),
    ...(scope.goalId && !goal
      ? { reason: `Goal not present in scoped state: ${scope.goalId}` }
      : {}),
  }
}

function compactProject(project: Record<string, unknown>) {
  return {
    projectId: project.projectId,
    available: project.available,
    releaseHead: project.releaseHead,
    primaryRepoId: project.primaryRepoId,
    repos: asRecords(project.repos).map((repo) =>
      select(repo, ['repoId', 'repoPath', 'projectPath', 'integrationRoot', 'primary']),
    ),
  }
}

function compactGoal(goal: Record<string, unknown>) {
  const canonicalGoal = asRecord(goal.goal)
  const latestPlanningOutcome = asRecord(goal.latestPlanningOutcome)
  const works = asRecords(goal.works)
  const artifacts = works.flatMap((work) =>
    asRecords(work.evidence).flatMap((evidence) =>
      asRecords(evidence.artifacts).map((artifact) =>
        select(artifact, [
          'reference',
          'available',
          'fileName',
          'operatorUrl',
          'unavailableReason',
        ]),
      ),
    ),
  )
  return {
    attributes: select(asRecord(canonicalGoal?.attributes) ?? {}, [
      'id',
      'title',
      'lifecycle',
      'contractRevision',
      'priority',
      'completionAttentionId',
    ]),
    body: canonicalGoal?.body,
    nonterminalWorks: works
      .filter((work) => {
        const stage = asRecord(work.attributes)?.stage
        return stage !== 'done' && stage !== 'cancelled'
      })
      .map((work) =>
        select(asRecord(work.attributes) ?? {}, [
          'id',
          'title',
          'kind',
          'stage',
          'contractRevision',
          'dependsOn',
          'attempts',
          'notBefore',
          'repos',
        ]),
      ),
    latestPlanningOutcome: latestPlanningOutcome
      ? select(asRecord(latestPlanningOutcome.attributes) ?? {}, [
          'id',
          'title',
          'kind',
          'stage',
          'contractRevision',
          'attempts',
        ])
      : null,
    openAttentions: asRecords(goal.attentions).map((attention) => ({
      attributes: asRecord(attention.attributes),
      body: attention.body,
    })),
    artifacts,
  }
}

function goalId(goal: Record<string, unknown>) {
  return asRecord(asRecord(goal.goal)?.attributes)?.id
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((record): record is Record<string, unknown> => record !== null)
    : []
}

function select(record: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(
    keys.flatMap((key) => (record[key] === undefined ? [] : [[key, record[key]]])),
  )
}
