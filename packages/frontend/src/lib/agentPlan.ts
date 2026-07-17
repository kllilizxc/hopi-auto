import type { RunAttemptEvent } from './apiTypes'

export type RunAgentPlan = Extract<RunAttemptEvent, { kind: 'plan' }>

export function latestAgentPlan(events: readonly RunAttemptEvent[]): RunAgentPlan | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.kind === 'plan') return event
  }
  return null
}
