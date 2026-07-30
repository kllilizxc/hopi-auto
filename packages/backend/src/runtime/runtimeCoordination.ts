export interface RuntimeCoordinatorControl {
  wake(): void
  protectAssistantGoal(eventId: string, projectId: string, goalId: string): void
  protectAssistantProject(eventId: string, projectId: string): void
  quiesceProject(projectId: string): Promise<void>
}

export interface RuntimeCoordination {
  wake(): void
  protectAssistantGoal(eventId: string, projectId: string, goalId: string): void
  protectAssistantProject(eventId: string, projectId: string): void
  restoreProjectEligibility(projectId: string): Promise<{ eligible: boolean; error?: string }>
  runProjectMutation<T>(projectId: string, operation: () => Promise<T>): Promise<T>
  bind(input: {
    coordinator: RuntimeCoordinatorControl
    restoreProjectEligibility(projectId: string): Promise<{ eligible: boolean; error?: string }>
  }): void
}

export class RuntimeCoordinationError extends Error {}

export function createRuntimeCoordination(): RuntimeCoordination {
  let binding:
    | {
        coordinator: RuntimeCoordinatorControl
        restoreProjectEligibility(projectId: string): Promise<{ eligible: boolean; error?: string }>
      }
    | undefined
  let wakePending = false

  const requireBinding = () => {
    if (!binding) {
      throw new RuntimeCoordinationError('Runtime coordination is not bound')
    }
    return binding
  }

  return {
    wake() {
      if (!binding) {
        wakePending = true
        return
      }
      binding.coordinator.wake()
    },

    protectAssistantGoal(eventId, projectId, goalId) {
      requireBinding().coordinator.protectAssistantGoal(eventId, projectId, goalId)
    },

    protectAssistantProject(eventId, projectId) {
      requireBinding().coordinator.protectAssistantProject(eventId, projectId)
    },

    restoreProjectEligibility(projectId) {
      return requireBinding().restoreProjectEligibility(projectId)
    },

    async runProjectMutation(projectId, operation) {
      const current = requireBinding()
      await current.coordinator.quiesceProject(projectId)
      try {
        return await operation()
      } catch (error) {
        await current.restoreProjectEligibility(projectId)
        throw error
      }
    },

    bind(input) {
      if (binding) {
        throw new RuntimeCoordinationError('Runtime coordination is already bound')
      }
      binding = input
      if (wakePending) {
        wakePending = false
        binding.coordinator.wake()
      }
    },
  }
}
