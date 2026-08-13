import assert from 'node:assert/strict'
import { verifyIntegratedClampProject } from './failingClampProject'
import {
  type BrowserHarnessContext,
  type LiveGoalDetail,
  type LiveState,
  assertAcceptedRelease,
  captureCompletionUpdate,
  type checkoutSnapshot,
  inspectKanban,
  readPendingInboxEvents,
  requestJson,
} from './liveHarness'

export interface AttemptSummary {
  projectId: string
  goalId: string
  workId: string
  runId: string
  responsibility: 'planner' | 'generator' | 'reviewer'
  status: 'queued' | 'running' | 'settled'
  termination: 'normal' | 'cancelled' | 'interrupted' | 'crashed' | 'timed_out' | null
  reportMarkdown: string | null
  candidateCommits: Array<{ repoId: string; baseCommit: string; resultCommit: string }>
}

export interface GoalDeliveryContext extends BrowserHarnessContext {
  homeRoot: string
  repoRoot: string
}

export async function verifyGoalDeliveryDomain(input: {
  context: GoalDeliveryContext
  projectId: string
  goalId: string
  integrationRoot: string
  checkoutBefore: Awaited<ReturnType<typeof checkoutSnapshot>>
  invariantViolations?: readonly string[]
}) {
  const finalState = await requestJson<LiveState>(input.context.baseUrl, '/api/state')
  const finalGoal = await requestJson<LiveGoalDetail>(
    input.context.baseUrl,
    `/api/projects/${encodeURIComponent(input.projectId)}/goals/${encodeURIComponent(input.goalId)}`,
  )
  assert.equal(finalGoal.goal.lifecycle, 'done')
  assert.equal(finalState.activeRuns.length, 0, 'Terminal state must not retain active Runs')
  assert.equal(
    finalState.attentions.filter(
      (attention) => typeof attention.target === 'string' && attention.resolvedAt === null,
    ).length,
    0,
    'Clear delivery must not retain targeted Attention',
  )
  assert.deepEqual(
    await readPendingInboxEvents(input.context.homeRoot),
    [],
    'Terminal state must not retain pending Assistant Inbox events',
  )
  assert.deepEqual(
    input.invariantViolations ?? [],
    [],
    'No sampled state invariant may be violated',
  )

  const completion = finalState.attentions.find(
    (attention) => attention.target === null && attention.goalId === input.goalId,
  )
  assert.ok(completion, 'Completed Goal must expose its targetless completion update')
  const attempts = await readAttempts(input.context, input.projectId, input.goalId, finalGoal)
  assertRealResponsibilityPath(attempts)
  const projectVerification = await verifyIntegratedClampProject(input.integrationRoot)
  const checkoutAfter = await assertAcceptedRelease(
    input.context.repoRoot,
    input.projectId,
    input.checkoutBefore,
  )

  return {
    finalState,
    finalGoal,
    completion,
    attempts,
    projectVerification,
    checkoutAfter,
  }
}

export async function captureGoalDeliveryPresentation(
  context: BrowserHarnessContext,
  projectId: string,
  goalId: string,
  completionBody: string,
) {
  const feed = await requestJson<{
    items: Array<{
      kind: string
      event?: { reply: string | null }
      completion?: {
        scope: string
        projectId?: string
        goalId?: string
        body: string
      } | null
      attention?: {
        scope: string
        projectId?: string
        goalId?: string
        body: string
      }
    }>
  }>(context.baseUrl, '/api/assistant/feed?limit=100')
  const linkedCompletion = feed.items.find(
    (item) =>
      item.completion?.scope === 'goal' &&
      item.completion.projectId === projectId &&
      item.completion.goalId === goalId,
  )
  const standaloneCompletion = feed.items.find(
    (item) =>
      item.attention?.scope === 'goal' &&
      item.attention.projectId === projectId &&
      item.attention.goalId === goalId,
  )
  const standaloneCompletionBody = standaloneCompletion?.attention?.body
  const visibleCompletionText =
    linkedCompletion?.event?.reply ??
    (standaloneCompletionBody ? readableCompletionBody(standaloneCompletionBody) : null) ??
    readableCompletionBody(completionBody)
  const completionBrowser = await captureCompletionUpdate(context, visibleCompletionText)
  const browser = await inspectKanban(context, projectId, goalId)
  return { completionBrowser, browser }
}

async function readAttempts(
  context: BrowserHarnessContext,
  projectId: string,
  goalId: string,
  goal: LiveGoalDetail,
) {
  const attempts: AttemptSummary[] = []
  for (const work of goal.works) {
    const response = await requestJson<{ attempts: AttemptSummary[] }>(
      context.baseUrl,
      `/api/projects/${encodeURIComponent(projectId)}/goals/${encodeURIComponent(goalId)}/works/${encodeURIComponent(work.id)}/attempts`,
    )
    for (const attempt of response.attempts) {
      const events = await requestJson<{
        items: Array<{ kind: string; transport?: string; entryKind?: string }>
      }>(
        context.baseUrl,
        `/api/projects/${encodeURIComponent(projectId)}/goals/${encodeURIComponent(goalId)}/works/${encodeURIComponent(work.id)}/attempts/${encodeURIComponent(attempt.runId)}/events?limit=200`,
      )
      if (attempt.status === 'settled' && attempt.termination === 'normal') {
        assert.ok(
          events.items.some((event) => event.kind === 'transcript' && event.transport),
          `${attempt.responsibility} ${attempt.runId} must contain real transport events`,
        )
      }
      attempts.push(attempt)
    }
  }
  return attempts
}

function assertRealResponsibilityPath(attempts: AttemptSummary[]) {
  assert.ok(
    attempts.some(
      (attempt) =>
        attempt.responsibility === 'generator' &&
        attempt.status === 'settled' &&
        attempt.termination === 'normal' &&
        attempt.candidateCommits.length > 0,
    ),
    'Delivery must retain one normal Generator Run and its candidate commit',
  )
}

function readableCompletionBody(body: string) {
  return body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .trim()
}
