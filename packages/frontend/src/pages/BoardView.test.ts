import { describe, expect, test } from 'bun:test'
import type { RunAttemptSummary } from '../lib/api'
import {
  attemptOutcomeBreakdown,
  attemptOutcomeSummary,
  attemptModelLabel,
  attemptStatus,
  compactLaneRenderWindow,
  orderDoneWorks,
  shouldShowWorkProgress,
} from './BoardView'

const attempt: RunAttemptSummary = {
  version: 1,
  projectId: 'P-1',
  goalId: 'G-1',
  workId: 'W-1',
  runId: 'R-1',
  responsibility: 'planner',
  execution: null,
  startedAt: '2026-07-16T00:00:00.000Z',
  endedAt: '2026-07-16T00:01:00.000Z',
  status: 'finished',
  result: 'success',
  summary: 'The model completed, but its result was not applied.',
  exitCode: 0,
  application: 'stale',
}

describe('Board Attempt status', () => {
  test('shows unapplied stale authority instead of the model result', () => {
    expect(attemptStatus(attempt)).toBe('stale')
  })

  test('keeps the model result when its application is current', () => {
    expect(attemptStatus({ ...attempt, application: 'published' })).toBe('success')
  })

  test('keeps a live Attempt visibly working', () => {
    expect(
      attemptStatus({
        ...attempt,
        status: 'running',
        result: null,
        application: null,
        endedAt: null,
      }),
    ).toBe('working')
  })

  test('separates rejection, failure, and interruption in the diagnostic projection', () => {
    const attempts = [
      { ...attempt, runId: 'R-reject', result: 'reject', application: 'published' },
      { ...attempt, runId: 'R-fail', result: 'fail', application: 'operational_failure' },
      {
        ...attempt,
        runId: 'R-interrupted',
        status: 'interrupted',
        result: null,
        application: null,
      },
      { ...attempt, runId: 'R-success', application: 'integrated' },
    ] satisfies RunAttemptSummary[]

    expect(attemptOutcomeBreakdown(attempts)).toEqual({
      rejected: 1,
      failed: 1,
      interrupted: 1,
    })
    expect(attemptOutcomeSummary(attempts)).toBe('1 rejected · 1 failed · 1 interrupted')
    expect(attemptOutcomeSummary([{ ...attempt, application: 'integrated' }])).toBe(
      'Messages and tool activity',
    )
  })
})

test('Work Attempt messages reuse the shared breathing tail activity', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()

  expect(source).toContain("tailActivity={selectedAttempt.status === 'running' ? 'working' : null}")
  expect(source).toContain('<p>{outcomeSummary}</p>')
  expect(source).not.toContain('Agent is working')
  expect(source).not.toContain(':runtime-status')
})

test('Work and Attempt switches warm their message caches before changing visible content', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()

  expect(source).toContain('function prepareAttemptMessageStream(')
  expect(source).toContain('hydrateInfiniteMessageStreamSnapshot<RunAttemptEvent>')
  expect(source).toContain('prefetchInfiniteMessageStream<RunAttemptEvent>')
  expect(source).toContain('async function prepareWorkActivity(')
  expect(source).toContain('readMessageStreamSnapshot<{ attempts: RunAttemptSummary[] }>')
  expect(source).toContain('writeMessageStreamSnapshot(attemptsSnapshotKey, attemptsQuery.data)')
  expect(source).toContain('const request = ++workOpenRequest.current')
  expect(source).toContain('const request = ++attemptSelectionRequest.current')
  expect(source).toContain('const request = ++paneSelectionRequest.current')
  expect(source).toContain('if (request === workOpenRequest.current) setSelectedWork(work)')
  expect(source).toContain(
    'if (request === attemptSelectionRequest.current) setSelectedAttemptId(runId)',
  )
  expect(source).toContain('onPointerEnter={() => onWarm(attempt.runId)}')
  expect(source).toContain("onSelectionChange={(key) => selectPane(String(key) as 'activity' | 'contract')}")
})

test('Work cards keep full prose and dependencies in the detail modal', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()
  const card = source.slice(
    source.indexOf('function WorkCard'),
    source.indexOf('function WorkDetail'),
  )
  const contract = source.slice(
    source.indexOf('function WorkContract'),
    source.indexOf('function RunPromptView'),
  )

  expect(card).not.toContain('excerpt(work.body)')
  expect(card).not.toContain('work.dependsOn')
  expect(card).not.toContain('work.attempts')
  expect(card).not.toContain('work.projection.responsibility')
  expect(card).not.toContain('<span>{work.id}</span>')
  expect(contract).toContain('work.dependsOn')
  expect(contract).toContain('<pre>{workBody}</pre>')
  expect(source).toContain('queryFn: () => readWorkDocument(projectId, goalId, work.id)')
  expect(source).toContain("enabled: activePane === 'contract'")
  expect(source).toContain('<MessageFeedSkeleton density="compact" />')
})

test('Board reads the compact projection without colliding with Goal docs cache', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()

  expect(source).toContain('queryKey: goalBoardQueryKey(projectId, goalId)')
  expect(source).toContain("queryFn: () => readGoalBoard(projectId ?? '', goalId ?? '')")
  expect(source).not.toContain("queryFn: () => readGoal(projectId ?? '', goalId ?? '')")
})

test('compact Kanban mounts only the selected Lane and immediate neighbors', () => {
  expect([...compactLaneRenderWindow(null)]).toEqual(['Plan', 'Build'])
  expect([...compactLaneRenderWindow('Build')]).toEqual(['Plan', 'Build', 'Review'])
  expect([...compactLaneRenderWindow('Review')]).toEqual(['Build', 'Review', 'Done'])
  expect([...compactLaneRenderWindow('Done')]).toEqual(['Review', 'Done'])
})

test('Done Work is ordered by completion time with undated records last', () => {
  const works = [
    { id: 'undated-a', completedAt: null },
    { id: 'older', completedAt: '2026-07-18T08:00:00.000Z' },
    { id: 'invalid', completedAt: 'not-a-date' },
    { id: 'newest', completedAt: '2026-07-19T09:00:00.000Z' },
    { id: 'same-a', completedAt: '2026-07-19T08:00:00.000Z' },
    { id: 'same-b', completedAt: '2026-07-19T08:00:00.000Z' },
  ]

  expect(orderDoneWorks(works).map((work) => work.id)).toEqual([
    'newest',
    'same-a',
    'same-b',
    'older',
    'undated-a',
    'invalid',
  ])
  expect(works[0]?.id).toBe('undated-a')
})

test('progress belongs only to started non-terminal Work', () => {
  expect(
    shouldShowWorkProgress({
      stage: 'generate',
      runAttemptCount: 0,
      hasAgentPlan: false,
      running: false,
    }),
  ).toBe(false)
  expect(
    shouldShowWorkProgress({
      stage: 'done',
      runAttemptCount: 3,
      hasAgentPlan: true,
      running: true,
    }),
  ).toBe(false)
  expect(
    shouldShowWorkProgress({
      stage: 'cancelled',
      runAttemptCount: 1,
      hasAgentPlan: false,
      running: false,
    }),
  ).toBe(false)
  expect(
    shouldShowWorkProgress({
      stage: 'review',
      runAttemptCount: 1,
      hasAgentPlan: false,
      running: false,
    }),
  ).toBe(true)
  expect(
    shouldShowWorkProgress({
      stage: 'generate',
      runAttemptCount: 0,
      hasAgentPlan: false,
      running: true,
    }),
  ).toBe(true)
})

test('Work cards own the collapsible subtask projection without duplicating it in detail', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const card = source.slice(
    source.indexOf('function WorkCard'),
    source.indexOf('function WorkDetail'),
  )
  const detail = source.slice(source.indexOf('function WorkDetail'))
  const planRule = styles.match(/\.agent-plan--card\s*\{([^}]*)\}/)?.[1] ?? ''
  const triggerRule = styles.match(/\.agent-plan__trigger\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(card).toContain('<WorkProgress')
  expect(card).toContain('plan={work.agentPlan}')
  expect(card).toContain('plan.items.map((item, index)')
  expect(card).not.toContain('slice(0, 3)')
  expect(card).toContain('const total = hasSubtasks ? items.length : 1')
  expect(card).toContain('isExpanded={expanded}')
  expect(card).toContain('onExpandedChange={onExpandedChange}')
  expect(card).toContain('agent-plan__track')
  expect(card).toContain('agent-plan__segment-progress')
  expect(card).toContain('agent-plan__current-indicator')
  expect(card).not.toContain('<Check />')
  expect(planRule).toContain('pointer-events: none')
  expect(triggerRule).toContain('pointer-events: auto')
  expect(detail).not.toContain('AgentPlanChecklist')
  expect(detail).not.toContain('latestAgentPlan')
  expect(detail).not.toContain('activePlan')
})

test('Goal-local view state restores expanded cards and the compact Lane', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()

  expect(source).toContain('readGoalViewState(projectId, goalId)')
  expect(source).toContain('rememberGoalViewState(projectId, goalId, change(base))')
  expect(source).toContain('expanded={expandedWorkIds.has(work.id)}')
  expect(source).toContain('ref={kanbanRef}')
  expect(source).toContain('data-lane={column.id}')
  expect(source).toContain("const COMPACT_KANBAN_QUERY = '(max-width: 900px)'")
  expect(source).toContain('scroller.scrollLeft = column.offsetLeft - board.offsetLeft')
})

test('Work card footers show Attempt count, blockers, and Done completion time', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()
  const card = source.slice(
    source.indexOf('function WorkCard'),
    source.indexOf('function WorkDetail'),
  )

  expect(card).toContain('Attempts {work.runAttemptCount}')
  expect(card).toContain('{work.blockedBy && (')
  expect(card).toContain('Blocked by {work.blockedBy}')
  expect(card).toContain("work.stage === 'done' && work.completedAt")
  expect(card).toContain('Completed {completedAt}')
  expect(card).not.toContain('work.repos.map')
  expect(card).not.toContain('visibleBadge')
})

test('Work detail shows the execution model captured by the selected Attempt', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()
  const detail = source.slice(source.indexOf('function WorkDetail'), source.indexOf('function WorkContract'))

  expect(detail).toContain('<small>Model</small>')
  expect(detail).toContain('{attemptModelLabel(selectedAttempt)}')
  expect(detail).toContain('<AttemptDiagnosticFacts')
  expect(detail).not.toContain('<small>Stage</small>')
  expect(detail).not.toContain('<small>Responsibility</small>')
  expect(detail).not.toContain('<small>Repositories</small>')
  expect(source).toContain("if (!attempt.execution) return 'not recorded'")
  expect(
    attemptModelLabel({
      ...attempt,
      execution: {
        transport: 'codex',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'xhigh',
      },
    }),
  ).toBe('gpt-5.6-sol · xhigh')
})

test('Needs you stays out of the Board banner and belongs to the Assistant message', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()

  expect(source).not.toContain('needs-you-banner')
  expect(source).not.toContain('openAssistant(assistantAttention)')
  expect(source).toContain('assistantAttentionLabel')
})
