import type { Responsibility } from './roleContextStager'

export const SOFTWARE_DELIVERY_CONCURRENCY: Readonly<Record<Responsibility, number>> = {
  planner: 3,
  generator: 5,
  reviewer: 3,
}

export function responsibilityFor(kind: 'planning' | 'engineering', stage: string) {
  if (kind === 'planning' && stage === 'plan') return 'planner' as const
  if (kind === 'engineering' && stage === 'generate') return 'generator' as const
  if (kind === 'engineering' && stage === 'review') return 'reviewer' as const
  return null
}
