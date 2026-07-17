import { describe, expect, test } from 'bun:test'
import type { RunAttemptSummary } from '../lib/api'
import { attemptStatus } from './BoardView'

const attempt: RunAttemptSummary = {
  version: 1,
  projectId: 'P-1',
  goalId: 'G-1',
  workId: 'W-1',
  runId: 'R-1',
  responsibility: 'planner',
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
      attemptStatus({ ...attempt, status: 'running', result: null, application: null, endedAt: null }),
    ).toBe('working')
  })
})

test('Work Attempt messages reuse the shared breathing tail activity', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()

  expect(source).toContain(
    "tailActivity={selectedAttempt.status === 'running' ? 'working' : null}",
  )
  expect(source).not.toContain('Agent is working')
  expect(source).not.toContain(':runtime-status')
})

test('Work cards keep full prose and dependencies in the detail modal', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()
  const card = source.slice(source.indexOf('function WorkCard'), source.indexOf('function WorkDetail'))
  const contract = source.slice(source.indexOf('function WorkContract'), source.indexOf('function RunPromptView'))

  expect(card).not.toContain('excerpt(work.body)')
  expect(card).not.toContain('work.dependsOn')
  expect(card).not.toContain('work.attempts')
  expect(card).not.toContain('work.projection.responsibility')
  expect(card).not.toContain('<span>{work.id}</span>')
  expect(contract).toContain('work.dependsOn')
  expect(contract).toContain('<pre>{work.body}</pre>')
  expect(source).toContain('<MessageFeedSkeleton density="compact" />')
})

test('Work cards project the current Agent plan while Attempt detail keeps the full snapshot', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()
  const card = source.slice(source.indexOf('function WorkCard'), source.indexOf('function WorkDetail'))

  expect(card).toContain('<AgentPlanChecklist plan={work.agentPlan} compact />')
  expect(source).toContain('latestAgentPlan(eventStream.items)')
  expect(source).toContain('{plan && <AgentPlanChecklist plan={plan} />}')
  expect(source).toContain("plan.items.slice(0, 3)")
  expect(card).toContain('agent-plan__progress')
  expect(card).not.toContain('Current steps')
})

test('Needs you stays out of the Board banner and belongs to the Assistant message', async () => {
  const source = await Bun.file(new URL('./BoardView.tsx', import.meta.url)).text()

  expect(source).not.toContain('needs-you-banner')
  expect(source).not.toContain('openAssistant(assistantAttention)')
  expect(source).toContain('assistantAttentionLabel')
})
