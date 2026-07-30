import { describe, expect, test } from 'bun:test'
import {
  RuntimeCoordinationError,
  createRuntimeCoordination,
} from '../src/runtime/runtimeCoordination'

function fixture() {
  const calls: string[] = []
  const coordination = createRuntimeCoordination()
  const coordinator = {
    wake() {
      calls.push('wake')
    },
    protectAssistantGoal(eventId: string, projectId: string, goalId: string) {
      calls.push(`goal:${eventId}:${projectId}:${goalId}`)
    },
    protectAssistantProject(eventId: string, projectId: string) {
      calls.push(`project:${eventId}:${projectId}`)
    },
    async quiesceProject(projectId: string) {
      calls.push(`quiesce:${projectId}`)
    },
  }
  const restoreProjectEligibility = async (projectId: string) => {
    calls.push(`restore:${projectId}`)
    return { eligible: true }
  }
  return { calls, coordination, coordinator, restoreProjectEligibility }
}

describe('runtime coordination', () => {
  test('coalesces startup wake edges until the Coordinator is bound', () => {
    const state = fixture()
    state.coordination.wake()
    state.coordination.wake()

    state.coordination.bind(state)
    expect(state.calls).toEqual(['wake'])

    state.coordination.wake()
    expect(state.calls).toEqual(['wake', 'wake'])
  })

  test('fails closed for authority-bearing operations before binding and rejects rebinding', async () => {
    const state = fixture()

    expect(() => state.coordination.protectAssistantProject('EV-1', 'P-1')).toThrow(
      RuntimeCoordinationError,
    )
    await expect(
      state.coordination.runProjectMutation('P-1', async () => undefined),
    ).rejects.toBeInstanceOf(RuntimeCoordinationError)

    state.coordination.bind(state)
    expect(() => state.coordination.bind(state)).toThrow(RuntimeCoordinationError)
  })

  test('quiesces mutations and restores eligibility only after a failed operation', async () => {
    const state = fixture()
    state.coordination.bind(state)

    await expect(
      state.coordination.runProjectMutation('P-1', async () => {
        state.calls.push('mutate')
        throw new Error('failed')
      }),
    ).rejects.toThrow('failed')
    expect(state.calls).toEqual(['quiesce:P-1', 'mutate', 'restore:P-1'])
  })
})
