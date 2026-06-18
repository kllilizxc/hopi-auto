import { describe, expect, test } from 'bun:test'
import { RunningTaskRegistry } from '../src/runtime/runningTaskRegistry'

describe('RunningTaskRegistry', () => {
  test('enforces lane limits independently for the same goal', () => {
    const registry = new RunningTaskRegistry()
    const rootDir = '/tmp/workspace'
    const goalKey = 'goal-1'

    expect(
      registry.acquire({
        rootDir,
        goalKey,
        taskRef: 'T-1',
        role: 'generator',
        lane: 'in_progress',
        laneLimit: 3,
      }),
    ).toBeTruthy()
    expect(
      registry.acquire({
        rootDir,
        goalKey,
        taskRef: 'T-2',
        role: 'generator',
        lane: 'in_progress',
        laneLimit: 3,
      }),
    ).toBeTruthy()
    expect(
      registry.acquire({
        rootDir,
        goalKey,
        taskRef: 'T-3',
        role: 'planner',
        lane: 'in_progress',
        laneLimit: 3,
      }),
    ).toBeTruthy()
    expect(
      registry.acquire({
        rootDir,
        goalKey,
        taskRef: 'T-4',
        role: 'generator',
        lane: 'in_progress',
        laneLimit: 3,
      }),
    ).toBeNull()

    expect(
      registry.acquire({
        rootDir,
        goalKey,
        taskRef: 'R-1',
        role: 'reviewer',
        lane: 'in_review',
        laneLimit: 1,
      }),
    ).toBeTruthy()
    expect(
      registry.acquire({
        rootDir,
        goalKey,
        taskRef: 'R-2',
        role: 'reviewer',
        lane: 'in_review',
        laneLimit: 1,
      }),
    ).toBeNull()

    expect(
      registry.acquire({
        rootDir,
        goalKey,
        taskRef: 'M-1',
        role: 'merger',
        lane: 'merging',
        laneLimit: 1,
      }),
    ).toBeTruthy()

    expect(registry.count(rootDir, goalKey)).toBe(5)
    expect(registry.countLane(rootDir, goalKey, 'in_progress')).toBe(3)
    expect(registry.countLane(rootDir, goalKey, 'in_review')).toBe(1)
    expect(registry.countLane(rootDir, goalKey, 'merging')).toBe(1)
  })

  test('enforces a planner-only role cap inside the in_progress lane', () => {
    const registry = new RunningTaskRegistry()
    const rootDir = '/tmp/workspace'
    const goalKey = 'goal-1'

    expect(
      registry.acquire({
        rootDir,
        goalKey,
        taskRef: 'P-1',
        role: 'planner',
        lane: 'in_progress',
        laneLimit: 3,
        roleLimit: 1,
      }),
    ).toBeTruthy()

    expect(
      registry.acquire({
        rootDir,
        goalKey,
        taskRef: 'P-2',
        role: 'planner',
        lane: 'in_progress',
        laneLimit: 3,
        roleLimit: 1,
      }),
    ).toBeNull()

    expect(
      registry.acquire({
        rootDir,
        goalKey,
        taskRef: 'T-1',
        role: 'generator',
        lane: 'in_progress',
        laneLimit: 3,
      }),
    ).toBeTruthy()

    expect(registry.countLane(rootDir, goalKey, 'in_progress')).toBe(2)
    expect(registry.countRole(rootDir, goalKey, 'planner')).toBe(1)
    expect(registry.countRole(rootDir, goalKey, 'generator')).toBe(1)
  })
})
