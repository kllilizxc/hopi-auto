import { createAssistantToolCapabilityRegistry } from './assistantToolCapabilityRegistry'
import {
  type AssistantToolExecutionOptions,
  createAssistantToolExecutor,
} from './assistantToolExecutor'
import type { AssistantToolResult, AssistantTools } from './assistantToolTypes'

export type {
  AssistantToolProject,
  AssistantToolResult,
  AssistantTools,
} from './assistantToolTypes'

export function createAssistantTools(options: AssistantToolExecutionOptions): AssistantTools {
  const capabilities = createAssistantToolCapabilityRegistry()
  const executeForEvent = createAssistantToolExecutor(options)

  return {
    issue: capabilities.issue,
    revoke: capabilities.revoke,
    async execute(token, name, input): Promise<AssistantToolResult> {
      const eventId = capabilities.requireEventId(token)
      const result = await executeForEvent(eventId, name, input)
      if (result.changed) await options.onToolEffect(eventId, name, result)
      return result
    },
    executeForEvent,
  }
}
