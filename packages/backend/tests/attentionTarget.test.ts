import { describe, expect, test } from 'bun:test'
import {
  goalAttentionTarget,
  matchGoalAttentionTarget,
  parseWorkAttentionTarget,
  projectAttentionTarget,
  workAttentionTarget,
} from '../src/domain/attentionTarget'

describe('canonical Attention targets', () => {
  test('constructs and parses one canonical Project, Goal, and Work grammar', () => {
    expect(projectAttentionTarget('P-1')).toBe('project:P-1')
    expect(goalAttentionTarget('P-1', 'G-1')).toBe('project:P-1/goal:G-1')
    const workTarget = workAttentionTarget('P-1', 'G-1', 'plan-initial')
    expect(workTarget).toBe('project:P-1/goal:G-1/work:plan-initial')
    expect(parseWorkAttentionTarget(workTarget)).toEqual({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'plan-initial',
    })
    expect(matchGoalAttentionTarget('P-1', 'G-1', workTarget)).toEqual({
      scope: 'work',
      workId: 'plan-initial',
    })
  })

  test('does not treat a canonical document path as an Attention target', () => {
    const path = '.hopi/docs/goals/G-1/work/plan-initial.md'
    expect(parseWorkAttentionTarget(path)).toBeNull()
    expect(matchGoalAttentionTarget('P-1', 'G-1', path)).toBeNull()
  })
})
