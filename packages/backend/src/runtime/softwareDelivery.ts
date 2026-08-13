import type { Responsibility } from './roleContextStager'

export const SOFTWARE_DELIVERY_CONCURRENCY: Readonly<Record<Responsibility, number>> = {
  planner: 3,
  generator: 5,
  reviewer: 3,
}
