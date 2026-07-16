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
